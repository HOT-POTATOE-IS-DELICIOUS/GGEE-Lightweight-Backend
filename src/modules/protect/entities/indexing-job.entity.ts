import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

export enum IndexingJobStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * An indexing job: created alongside the protect row, dispatched to the crawler over HTTP, and
 * resolved by the crawler's `all_done` callback. The `id` is the `indexing_job_id` handed back
 * from /auth/register and polled by `GET /indexing/jobs/:job_id`.
 *
 * This descends from the original `protect_target_indexing_outbox`, but it is no longer an outbox:
 * the transactional-outbox pattern needs a dispatcher that claims and retries PENDING rows, and
 * this port dispatches synchronously instead. PENDING therefore means "dispatch in flight", not
 * "awaiting pickup", and a dispatch failure lands in FAILED rather than waiting for a sweeper.
 */
@Entity('indexing_jobs')
@Index('idx_indexing_jobs_created_at', ['createdAt']) // retention sweep
export class IndexingJobEntity extends BaseEntity {
  @Column({ name: 'protect_target', type: 'varchar', length: 255 })
  protectTarget!: string;

  @Column({ name: 'protect_target_info', type: 'varchar', length: 255 })
  protectTargetInfo!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: IndexingJobStatus;
}
