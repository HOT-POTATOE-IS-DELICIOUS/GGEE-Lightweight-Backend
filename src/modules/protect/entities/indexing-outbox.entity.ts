import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

export enum IndexingOutboxStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  PUBLISHED = 'PUBLISHED',
  COMPLETED = 'COMPLETED',
}

/**
 * Port of `protect_target_indexing_outbox`. Retained (even though Kafka is removed) because it
 * tracks the indexing job id returned from /auth/register and its COMPLETED state, which the
 * `GET /indexing/jobs/:job_id` waiter polls. The `id` doubles as the indexing_job_id.
 */
@Entity('protect_target_indexing_outbox')
@Index('idx_protect_target_indexing_outbox_status_created_at', ['status', 'createdAt'])
export class IndexingOutboxEntity extends BaseEntity {
  @Column({ name: 'protect_target', type: 'varchar', length: 255 })
  protectTarget!: string;

  @Column({ name: 'protect_target_info', type: 'varchar', length: 255 })
  protectTargetInfo!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: IndexingOutboxStatus;

  @Column({ name: 'claimed_at', type: 'timestamp', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt!: Date | null;
}
