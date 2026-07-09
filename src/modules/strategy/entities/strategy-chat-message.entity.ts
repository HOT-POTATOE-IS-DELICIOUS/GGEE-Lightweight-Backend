import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';

export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

/**
 * Port of `strategy_chat_messages`. A single USER or ASSISTANT turn in a room.
 *
 * `metaJson` is treated by the domain as an opaque JSON *string*: the column is `jsonb`
 * with a pass-through transformer, so on write the raw JSON string is parsed into the
 * stored jsonb value and on read the stored value is re-serialised back to a string.
 */
@Entity('strategy_chat_messages')
@Index('idx_strategy_chat_messages_room_id', ['roomId', 'createdAt'])
export class StrategyChatMessageEntity extends BaseEntity {
  @Column({ name: 'room_id', type: 'bigint' })
  roomId!: string;

  @Column({ type: 'varchar', length: 16 })
  role!: MessageRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', nullable: true })
  intent!: string | null;

  @Column({ name: 'refined_query', type: 'varchar', length: 512, nullable: true })
  refinedQuery!: string | null;

  @Column({
    name: 'meta_json',
    type: 'jsonb',
    nullable: true,
    transformer: {
      to: (value: string | null): unknown => (value == null ? null : JSON.parse(value)),
      from: (value: unknown): string | null => (value == null ? null : JSON.stringify(value)),
    },
  })
  metaJson!: string | null;

  @Column({ name: 'ai_message_id', type: 'varchar', length: 32, nullable: true })
  aiMessageId!: string | null;
}
