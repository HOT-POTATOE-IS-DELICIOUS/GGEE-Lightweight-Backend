import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

/**
 * Port of `strategy_chat_rooms`. Each row is a user's strategy chat session.
 * The `id` is a snowflake (bigint, returned as a string by the pg driver).
 */
@Entity('strategy_chat_rooms')
@Index('idx_strategy_chat_rooms_user_id', ['userId', 'createdAt'])
export class StrategyChatRoomEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  title!: string;

  @Column({ name: 'last_chatted_at', type: 'timestamp' })
  lastChattedAt!: Date;
}
