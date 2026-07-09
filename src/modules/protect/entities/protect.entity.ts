import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

/**
 * Port of `protects`. One active protect per user (partial unique index).
 */
@Entity('protects')
@Index('uniq_protects_user_active', ['userId'], { unique: true, where: 'deleted = false' })
@Index('idx_protects_user_id', ['userId'])
@Index('idx_protects_target_info_active', ['target', 'info'], { where: 'deleted = false' })
export class ProtectEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  target!: string;

  @Column({ type: 'varchar', length: 255 })
  info!: string;
}
