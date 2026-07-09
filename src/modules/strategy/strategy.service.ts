import { Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { ProtectService } from '../protect/protect.service';
import { MessageResponse, RoomResponse } from './dto/strategy.dto';
import { MessageRole, StrategyChatMessageEntity } from './entities/strategy-chat-message.entity';
import { StrategyChatRoomEntity } from './entities/strategy-chat-room.entity';
import { StrategyAiClient } from './strategy-ai.client';
import { StrategyChatMessageRepository } from './repositories/strategy-chat-message.repository';
import { StrategyChatRoomRepository } from './repositories/strategy-chat-room.repository';

/** Writes a single SSE frame (`event: <name>\ndata: <data>\n\n`) to the client. */
export type SseWriter = (event: string, data: string) => void;

/** Mutable accumulation state for the assistant turn, built up as the AI stream is consumed. */
interface StreamState {
  buffer: string;
  intent: string | null;
  refinedQuery: string | null;
  metaJson: string | null;
  saved: boolean;
}

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    private readonly rooms: StrategyChatRoomRepository,
    private readonly messages: StrategyChatMessageRepository,
    private readonly aiClient: StrategyAiClient,
    private readonly protectService: ProtectService,
    private readonly snowflake: SnowflakeService,
  ) {}

  /** Create a room (title = first 12 chars of message) + persist the user's message. Returns the room id. */
  async createRoom(userId: string, message: string): Promise<string> {
    const room = new StrategyChatRoomEntity();
    room.id = this.snowflake.generateId();
    room.userId = userId;
    room.title = message.slice(0, 12);
    room.lastChattedAt = new Date();
    room.deleted = false;
    room.deletedAt = null;
    await this.rooms.save(room);

    await this.messages.save(this.buildUserMessage(room.id, message));
    return room.id;
  }

  findRoom(roomId: string, userId: string): Promise<StrategyChatRoomEntity | null> {
    return this.rooms.findByIdAndUserId(roomId, userId);
  }

  /** Persist the user message on an existing room and bump last_chatted_at. */
  async appendUserMessage(roomId: string, message: string): Promise<void> {
    await this.messages.save(this.buildUserMessage(roomId, message));
    await this.rooms.updateLastChattedAt(roomId, new Date());
  }

  async listRooms(userId: string): Promise<RoomResponse[]> {
    const rooms = await this.rooms.findAllByUserId(userId);
    return rooms.map((r) => ({
      room_id: r.id,
      title: r.title,
      last_chatted_at: r.lastChattedAt,
      created_at: r.createdAt,
    }));
  }

  async listMessages(roomId: string, userId: string): Promise<MessageResponse[]> {
    const room = await this.rooms.findByIdAndUserId(roomId, userId);
    if (!room) {
      throw new BusinessException('STRATEGY_ROOM_NOT_FOUND');
    }
    const messages = await this.messages.findAllByRoomId(roomId);
    return messages.map((m) => ({
      message_id: m.id,
      role: m.role,
      content: m.content,
      intent: m.intent,
      refined_query: m.refinedQuery,
      meta_json: m.metaJson,
      created_at: m.createdAt,
    }));
  }

  /**
   * Resolve the user's protect target, stream the AI response to the client (verbatim frames),
   * accumulate the assistant turn, and persist it. On any error after the stream begins, emit an
   * `error` frame. Never rethrows — the caller ends the response afterwards.
   */
  async streamChat(
    userId: string,
    roomId: string,
    message: string,
    write: SseWriter,
  ): Promise<void> {
    const state: StreamState = {
      buffer: '',
      intent: null,
      refinedQuery: null,
      metaJson: null,
      saved: false,
    };

    try {
      const protect = await this.protectService.getByUserId(userId);
      for await (const evt of this.aiClient.stream(message, protect.target, protect.info)) {
        write(evt.event, evt.data);
        await this.accumulate(state, roomId, evt.event, evt.data);
      }
    } catch (err) {
      const code = err instanceof BusinessException ? err.code : 'INTERNAL_SERVER_ERROR';
      write('error', JSON.stringify({ code }));
    } finally {
      // Completion / error / client-disconnect: persist a partial assistant turn if `done`
      // never arrived but content was produced.
      if (!state.saved && state.buffer.length > 0) {
        try {
          await this.persistAssistant(roomId, state, null);
        } catch (err) {
          this.logger.warn(`Partial assistant persist failed for room ${roomId}: ${String(err)}`);
        }
      }
    }
  }

  private async accumulate(
    state: StreamState,
    roomId: string,
    event: string,
    data: string,
  ): Promise<void> {
    try {
      switch (event) {
        case 'content_chunk': {
          const parsed = JSON.parse(data) as { delta?: string };
          state.buffer += parsed.delta ?? '';
          break;
        }
        case 'intent_classified': {
          const parsed = JSON.parse(data) as { intent?: string; refined_query?: string };
          state.intent = parsed.intent ?? null;
          state.refinedQuery = parsed.refined_query ?? null;
          break;
        }
        case 'meta': {
          state.metaJson = data;
          break;
        }
        case 'done': {
          const parsed = JSON.parse(data) as { message_id?: string };
          await this.persistAssistant(roomId, state, parsed.message_id ?? null);
          state.saved = true;
          break;
        }
        default:
          break;
      }
    } catch (err) {
      // Swallow JSON parse (and done-persist) errors; a partial turn is persisted in finally.
      this.logger.debug(`Accumulate skipped ${event} for room ${roomId}: ${String(err)}`);
    }
  }

  private async persistAssistant(
    roomId: string,
    state: StreamState,
    aiMessageId: string | null,
  ): Promise<void> {
    const entity = new StrategyChatMessageEntity();
    entity.id = this.snowflake.generateId();
    entity.roomId = roomId;
    entity.role = MessageRole.ASSISTANT;
    entity.content = state.buffer;
    entity.intent = state.intent;
    entity.refinedQuery = state.refinedQuery;
    entity.metaJson = state.metaJson;
    entity.aiMessageId = aiMessageId;
    entity.deleted = false;
    entity.deletedAt = null;
    await this.messages.save(entity);
  }

  private buildUserMessage(roomId: string, content: string): StrategyChatMessageEntity {
    const entity = new StrategyChatMessageEntity();
    entity.id = this.snowflake.generateId();
    entity.roomId = roomId;
    entity.role = MessageRole.USER;
    entity.content = content;
    entity.intent = null;
    entity.refinedQuery = null;
    entity.metaJson = null;
    entity.aiMessageId = null;
    entity.deleted = false;
    entity.deletedAt = null;
    return entity;
  }
}
