import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

/**
 * Port of `audits`. Write-only record of an entrance-statement audit (there is no read path).
 * `reviews_json` stores the reviews as a camelCase JSON string.
 */
@Entity('audits')
@Index('idx_audits_user_id_created_at', ['userId', 'createdAt'])
export class AuditEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({ name: 'protect_target', type: 'varchar', length: 255 })
  protectTarget!: string;

  @Column({ name: 'protect_target_info', type: 'varchar', length: 255 })
  protectTargetInfo!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ name: 'reviews_json', type: 'text' })
  reviewsJson!: string;
}
