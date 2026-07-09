import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

/**
 * Port of `user_sessions`. The partial unique index enforces at most one active
 * session per user (single-device login). `refresh_token_hash` is unsalted SHA-256 hex (64 chars).
 */
@Entity('user_sessions')
@Index('uniq_user_sessions_user_active', ['userId'], { unique: true, where: 'deleted = false' })
@Index('idx_user_sessions_user_id', ['userId'])
export class UserSessionEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Index('uniq_user_sessions_session_id', { unique: true })
  @Column({ name: 'session_id', type: 'varchar', length: 64 })
  sessionId!: string;

  @Column({ name: 'refresh_token_hash', type: 'char', length: 64 })
  refreshTokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;
}
