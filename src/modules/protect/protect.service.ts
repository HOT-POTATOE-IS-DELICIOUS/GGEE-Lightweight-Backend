import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { EntityManager } from 'typeorm';
import { AiHttpClient } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { IndexingJobEntity, IndexingJobStatus } from './entities/indexing-job.entity';
import { ProtectEntity } from './entities/protect.entity';
import { IndexingJobRepository } from './repositories/indexing-job.repository';
import { ProtectRepository } from './repositories/protect.repository';

export interface Protect {
  id: string;
  userId: string;
  target: string;
  info: string;
}

export interface IndexProtectCommand {
  userId: string;
  target: string;
  info: string;
}

export interface IndexProtectResult {
  protectId: string;
  indexingJobId: string;
}

/**
 * Protect indexing. The original Kafka publish + outbox-dispatch scheduler is replaced by a
 * synchronous HTTP call to the crawler; the job row carries the indexing_job_id and its terminal
 * state, which the indexing waiter polls. Because nothing retries a failed dispatch, the failure
 * is recorded (FAILED) rather than left pending for a sweeper that no longer exists.
 */
@Injectable()
export class ProtectService implements OnModuleDestroy {
  private readonly logger = new Logger(ProtectService.name);
  private readonly crawlerBaseUrl: string;
  private readonly crawlerTimeoutMs = 10_000;
  private readonly inFlightDispatches = new Set<Promise<void>>();
  private readonly jobRetentionMs: number;

  constructor(
    private readonly protects: ProtectRepository,
    private readonly jobs: IndexingJobRepository,
    private readonly snowflake: SnowflakeService,
    private readonly http: AiHttpClient,
    config: ConfigService,
  ) {
    this.crawlerBaseUrl = config.getOrThrow<string>('crawler.baseUrl');
    this.jobRetentionMs = config.getOrThrow<number>('indexing.jobRetentionMs');
  }

  /**
   * Create the protect + indexing-job rows within the caller's transaction (register).
   * Returns the job id. Does NOT call the crawler (that happens after the transaction commits,
   * via requestIndexing).
   */
  async index(command: IndexProtectCommand, manager: EntityManager): Promise<IndexProtectResult> {
    const protect = manager.getRepository(ProtectEntity).create({
      id: this.snowflake.generateId(),
      userId: command.userId,
      target: command.target,
      info: command.info,
      deleted: false,
      deletedAt: null,
    });
    await this.protects.save(protect, manager);

    const job = this.newPendingJob(command.target, command.info);
    await this.jobs.save(job, manager);

    return { protectId: protect.id, indexingJobId: job.id };
  }

  /**
   * Fire-and-forget dispatch for register: the caller has already committed and cannot act on the
   * outcome, so making the HTTP response wait on a 10s crawler timeout buys nothing. Failures land
   * in the job row, which the waiter is already polling.
   */
  scheduleIndexing(jobId: string, keyword: string, protectTargetInfo: string): void {
    const dispatch = this.requestIndexing(jobId, keyword, protectTargetInfo);
    this.inFlightDispatches.add(dispatch);
    void dispatch.finally(() => this.inFlightDispatches.delete(dispatch));
  }

  /**
   * Let in-flight dispatches finish before the process exits. Without this, a rolling restart drops
   * them and — since no dispatcher retries PENDING rows anymore — strands those jobs forever.
   */
  async onModuleDestroy(): Promise<void> {
    // requestIndexing never rejects, so this cannot reject either.
    await Promise.all([...this.inFlightDispatches]);
  }

  /**
   * One crawler dispatch (replaces publishing to the `crawl.request` Kafka topic). Never throws:
   * a failure is recorded as FAILED so the waiter reports it instead of hanging until its ceiling.
   */
  async requestIndexing(jobId: string, keyword: string, protectTargetInfo: string): Promise<void> {
    try {
      await this.http.postJson(
        `${this.crawlerBaseUrl}/crawl/request`,
        { job_id: jobId, keyword, protect_target_info: protectTargetInfo },
        this.crawlerTimeoutMs,
      );
    } catch (err) {
      this.logger.warn(`Crawler dispatch failed for job ${jobId}: ${String(err)}`);
      try {
        await this.jobs.markFailed(jobId);
      } catch (markErr) {
        // register() already committed; never let bookkeeping turn a warning into a 500.
        this.logger.warn(`Could not mark job ${jobId} FAILED: ${String(markErr)}`);
      }
    }
  }

  /** Resolve the authenticated user's protect target (used by audit/issue/strategy). */
  async getByUserId(userId: string): Promise<Protect> {
    const entity = await this.protects.findByUserId(userId);
    if (!entity) {
      throw new BusinessException('PROTECT_NOT_FOUND');
    }
    return { id: entity.id, userId: entity.userId, target: entity.target, info: entity.info };
  }

  /** Mark an indexing job COMPLETED (called by the crawler result callback on status=all_done). */
  async markJobCompleted(jobId: string): Promise<void> {
    await this.jobs.markCompleted(jobId);
  }

  /** Current job state for the SSE waiter; null for an unknown or malformed job id. */
  getJobStatus(jobId: string): Promise<IndexingJobStatus | null> {
    return this.jobs.findStatus(jobId);
  }

  /**
   * Port of ProtectTargetRefreshScheduler: every 30 minutes re-enqueue every distinct active
   * protect target and re-request indexing. Assumes a single replica (no distributed lock).
   *
   * Dispatches are awaited one at a time here, unlike register's fire-and-forget: this loop can
   * span every protect target in the table, and firing them all at once would stampede the crawler.
   */
  @Interval('protect-target-refresh', 30 * 60 * 1000)
  async refreshAll(): Promise<void> {
    let snapshots;
    try {
      snapshots = await this.protects.findActiveDistinctTargets();
    } catch (err) {
      this.logger.warn(`Refresh scan failed: ${String(err)}`);
      return;
    }
    for (const snapshot of snapshots) {
      try {
        const job = await this.jobs.save(this.newPendingJob(snapshot.target, snapshot.info));
        await this.requestIndexing(job.id, snapshot.target, snapshot.info);
      } catch (err) {
        this.logger.warn(`Refresh enqueue failed for ${snapshot.target}: ${String(err)}`);
      }
    }
  }

  /**
   * Bound the growth `refreshAll` causes: it inserts one job per protect target every 30 minutes
   * and nothing ever removed them. Runs hourly; a sweep that fails is retried on the next tick.
   */
  @Interval('indexing-job-retention', 60 * 60 * 1000)
  async sweepExpiredJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - this.jobRetentionMs);
    try {
      const removed = await this.jobs.deleteOlderThan(cutoff);
      if (removed > 0) {
        this.logger.log(`Removed ${removed} indexing job(s) older than ${cutoff.toISOString()}`);
      }
    } catch (err) {
      this.logger.warn(`Indexing-job retention sweep failed: ${String(err)}`);
    }
  }

  private newPendingJob(target: string, info: string): IndexingJobEntity {
    const entity = new IndexingJobEntity();
    entity.id = this.snowflake.generateId();
    entity.protectTarget = target;
    entity.protectTargetInfo = info;
    entity.status = IndexingJobStatus.PENDING;
    entity.deleted = false;
    entity.deletedAt = null;
    return entity;
  }
}
