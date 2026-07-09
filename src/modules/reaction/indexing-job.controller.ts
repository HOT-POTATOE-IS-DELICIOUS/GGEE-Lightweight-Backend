import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProtectService } from '../protect/protect.service';

const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const CEILING_MS = 10 * 60 * 1000;

/**
 * GET /indexing/jobs/:job_id — SSE long-poll for indexing completion (pure DB poll; Kafka removed).
 * Emits `completed`/`done` when the outbox job reaches COMPLETED, `heartbeat`/`ping` every 30s,
 * and simply ends (no completed frame) after a 10-minute ceiling. `job_id` is a numeric outbox id.
 */
@Controller('indexing/jobs')
export class IndexingJobController {
  constructor(private readonly protectService: ProtectService) {}

  @Get(':job_id')
  async wait(
    @Param('job_id') jobId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Immediate short-circuit if the job is already done.
    if (await this.protectService.isJobCompleted(jobId)) {
      res.write(`event: completed\ndata: done\n\n`);
      res.end();
      return;
    }

    let finished = false;
    let polling = false;
    let pollTimer: NodeJS.Timeout | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let ceilingTimer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (ceilingTimer) clearTimeout(ceilingTimer);
    };

    const finish = (completed: boolean): void => {
      if (finished) return;
      finished = true;
      cleanup();
      if (completed) {
        res.write(`event: completed\ndata: done\n\n`);
      }
      res.end();
    };

    // Client disconnect: stop all timers, leave the (already closed) response alone.
    req.on('close', () => {
      if (finished) return;
      finished = true;
      cleanup();
    });

    heartbeatTimer = setInterval(() => {
      if (finished) return;
      res.write(`event: heartbeat\ndata: ping\n\n`);
    }, HEARTBEAT_INTERVAL_MS);

    pollTimer = setInterval(() => {
      if (finished || polling) return;
      polling = true;
      void this.protectService
        .isJobCompleted(jobId)
        .then((done) => {
          if (done) finish(true);
        })
        .catch(() => {
          // Swallow transient poll errors; keep waiting until completion or the ceiling.
        })
        .finally(() => {
          polling = false;
        });
    }, POLL_INTERVAL_MS);

    ceilingTimer = setTimeout(() => finish(false), CEILING_MS);
  }
}
