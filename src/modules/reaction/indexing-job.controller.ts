import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IndexingJobStatus } from '../protect/entities/indexing-job.entity';
import { ProtectService } from '../protect/protect.service';

const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const CEILING_MS = 10 * 60 * 1000;

/**
 * GET /indexing/jobs/:job_id — SSE long-poll for indexing completion (pure DB poll; Kafka removed).
 * Emits `completed`/`done` when the job reaches COMPLETED, `failed`/`dispatch_failed` when the
 * crawler dispatch never landed, `heartbeat`/`ping` every 30s, and simply ends (no terminal frame)
 * after a 10-minute ceiling. `job_id` is a numeric indexing-job id.
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

    let finished = false;
    let polling = false;

    // Collected rather than held in named bindings: `close` can fire before any timer exists (the
    // status read below is awaited), and cleanup has to be safe to call at that point.
    const timers: NodeJS.Timeout[] = [];
    const cleanup = (): void => {
      // clearInterval also cancels a setTimeout handle: both are the same Node Timeout object.
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    };

    const finish = (status: IndexingJobStatus | null): void => {
      if (finished) return;
      finished = true;
      cleanup();
      if (status === IndexingJobStatus.COMPLETED) {
        res.write(`event: completed\ndata: done\n\n`);
      } else if (status === IndexingJobStatus.FAILED) {
        res.write(`event: failed\ndata: dispatch_failed\n\n`);
      }
      res.end();
    };

    /** PENDING (and an unknown id, which may simply not have committed yet) keeps us waiting. */
    const isTerminal = (status: IndexingJobStatus | null): boolean =>
      status === IndexingJobStatus.COMPLETED || status === IndexingJobStatus.FAILED;

    // Client disconnect: stop all timers, leave the (already closed) response alone. Registered
    // before the first DB read — `close` fires once and is not replayed, so a client that aborts
    // during that read would otherwise leave the timers below running until the ceiling.
    req.on('close', () => {
      if (finished) return;
      finished = true;
      cleanup();
    });

    // Immediate short-circuit if the job already settled.
    const initial = await this.protectService.getJobStatus(jobId);
    if (finished) return; // client vanished while we were reading
    if (isTerminal(initial)) {
      finish(initial);
      return;
    }

    timers.push(
      setInterval(() => {
        if (finished) return;
        res.write(`event: heartbeat\ndata: ping\n\n`);
      }, HEARTBEAT_INTERVAL_MS),
    );

    timers.push(
      setInterval(() => {
        if (finished || polling) return;
        polling = true;
        void this.protectService
          .getJobStatus(jobId)
          .then((status) => {
            if (isTerminal(status)) finish(status);
          })
          .catch(() => {
            // Swallow transient poll errors; keep waiting until the job settles or the ceiling.
          })
          .finally(() => {
            polling = false;
          });
      }, POLL_INTERVAL_MS),
      setTimeout(() => finish(null), CEILING_MS),
    );
  }
}
