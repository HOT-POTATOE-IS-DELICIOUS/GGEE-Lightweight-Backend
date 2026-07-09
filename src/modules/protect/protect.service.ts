import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { EntityManager } from 'typeorm';
import { AiHttpClient } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { IndexingOutboxEntity, IndexingOutboxStatus } from './entities/indexing-outbox.entity';
import { ProtectEntity } from './entities/protect.entity';
import { IndexingOutboxRepository } from './repositories/indexing-outbox.repository';
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
 * synchronous HTTP call to the crawler. The outbox row is still written (it carries the
 * indexing_job_id and its COMPLETED state, polled by the indexing waiter).
 */
@Injectable()
export class ProtectService {
  private readonly logger = new Logger(ProtectService.name);
  private readonly crawlerBaseUrl: string;
  private readonly crawlerTimeoutMs = 10_000;

  constructor(
    private readonly protects: ProtectRepository,
    private readonly outbox: IndexingOutboxRepository,
    private readonly snowflake: SnowflakeService,
    private readonly http: AiHttpClient,
    config: ConfigService,
  ) {
    this.crawlerBaseUrl = config.getOrThrow<string>('crawler.baseUrl');
  }

  /**
   * Create the protect + outbox rows within the caller's transaction (register).
   * Returns the outbox id as the indexing job id. Does NOT call the crawler (that happens
   * after the transaction commits, via requestIndexing).
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

    const outbox = manager.getRepository(IndexingOutboxEntity).create({
      id: this.snowflake.generateId(),
      protectTarget: command.target,
      protectTargetInfo: command.info,
      status: IndexingOutboxStatus.PENDING,
      claimedAt: null,
      publishedAt: null,
      deleted: false,
      deletedAt: null,
    });
    await this.outbox.save(outbox, manager);

    return { protectId: protect.id, indexingJobId: outbox.id };
  }

  /**
   * Synchronous crawler dispatch (replaces publishing to the `crawl.request` Kafka topic).
   * Best-effort: failures are logged, not surfaced to the caller (register already committed).
   */
  async requestIndexing(jobId: string, keyword: string, protectTargetInfo: string): Promise<void> {
    try {
      await this.http.postJson(
        `${this.crawlerBaseUrl}/crawl/request`,
        { job_id: jobId, keyword, protect_target_info: protectTargetInfo },
        this.crawlerTimeoutMs,
      );
      await this.outbox.markPublished(jobId);
    } catch (err) {
      this.logger.warn(`Crawler dispatch failed for job ${jobId}: ${String(err)}`);
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
    await this.outbox.markCompleted(jobId);
  }

  isJobCompleted(jobId: string): Promise<boolean> {
    return this.outbox.isCompleted(jobId);
  }

  /**
   * Port of ProtectTargetRefreshScheduler: every 30 minutes re-enqueue every distinct active
   * protect target and re-request indexing. Assumes a single replica (no distributed lock).
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
        const outbox = await this.outbox.save(
          this.newPendingOutbox(snapshot.target, snapshot.info),
        );
        await this.requestIndexing(outbox.id, snapshot.target, snapshot.info);
      } catch (err) {
        this.logger.warn(`Refresh enqueue failed for ${snapshot.target}: ${String(err)}`);
      }
    }
  }

  private newPendingOutbox(target: string, info: string): IndexingOutboxEntity {
    const entity = new IndexingOutboxEntity();
    entity.id = this.snowflake.generateId();
    entity.protectTarget = target;
    entity.protectTargetInfo = info;
    entity.status = IndexingOutboxStatus.PENDING;
    entity.claimedAt = null;
    entity.publishedAt = null;
    entity.deleted = false;
    entity.deletedAt = null;
    return entity;
  }
}
