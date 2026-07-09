import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { BusinessException } from '../../common/error/business.exception';
import { ProtectService } from '../protect/protect.service';
import { StrategyAiClient } from './strategy-ai.client';
import { StrategyChatMessageRepository } from './repositories/strategy-chat-message.repository';
import { StrategyChatRoomRepository } from './repositories/strategy-chat-room.repository';
import {
  MessageRole,
  StrategyChatMessageEntity,
} from './entities/strategy-chat-message.entity';
import { StrategyChatRoomEntity } from './entities/strategy-chat-room.entity';
import { SseWriter, StrategyService } from './strategy.service';

interface Evt {
  event: string;
  data: string;
}

async function* streamOf(events: Evt[], throwAtEnd?: unknown): AsyncGenerator<Evt> {
  for (const e of events) yield e;
  if (throwAtEnd) throw throwAtEnd;
}

const protect = {
  getByUserId: jest.fn().mockResolvedValue({
    id: '1',
    userId: '1',
    target: '백종원',
    info: '요리연구가',
  }),
} as unknown as ProtectService;

function makeSnowflake(): SnowflakeService {
  let n = 0;
  return { generateId: jest.fn(() => `id${++n}`) } as unknown as SnowflakeService;
}

function collectingWriter(): { write: SseWriter; frames: Evt[] } {
  const frames: Evt[] = [];
  return { frames, write: (event, data) => frames.push({ event, data }) };
}

describe('StrategyService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createRoom', () => {
    it('sets the title to the first 12 characters of the message and persists room + user message', async () => {
      const rooms = { save: jest.fn() } as unknown as StrategyChatRoomRepository;
      const messages = { save: jest.fn() } as unknown as StrategyChatMessageRepository;
      const aiClient = { stream: jest.fn() } as unknown as StrategyAiClient;
      const service = new StrategyService(rooms, messages, aiClient, protect, makeSnowflake());

      const message = '가나다라마바사아자차카타파하'; // 15 Korean chars
      const roomId = await service.createRoom('99', message);

      const savedRoom = (rooms.save as jest.Mock).mock.calls[0][0] as StrategyChatRoomEntity;
      expect(savedRoom.title).toBe('가나다라마바사아자차카타');
      expect(savedRoom.title.length).toBe(12);
      expect(savedRoom.userId).toBe('99');
      expect(roomId).toBe(savedRoom.id);

      const savedMsg = (messages.save as jest.Mock).mock.calls[0][0] as StrategyChatMessageEntity;
      expect(savedMsg.role).toBe(MessageRole.USER);
      expect(savedMsg.content).toBe(message);
      expect(savedMsg.roomId).toBe(savedRoom.id);
    });
  });

  describe('streamChat', () => {
    it('writes every event verbatim and persists the assembled assistant turn', async () => {
      const events: Evt[] = [
        {
          event: 'intent_classified',
          data: JSON.stringify({ intent: 'ask', refined_query: '무엇' }),
        },
        { event: 'content_chunk', data: JSON.stringify({ delta: '안녕' }) },
        { event: 'content_chunk', data: JSON.stringify({ delta: '하세요' }) },
        { event: 'meta', data: '{"sources":["a","b"]}' },
        { event: 'done', data: JSON.stringify({ message_id: 'm1' }) },
      ];
      const rooms = {} as unknown as StrategyChatRoomRepository;
      const save = jest.fn();
      const messages = { save } as unknown as StrategyChatMessageRepository;
      const aiClient = { stream: jest.fn(() => streamOf(events)) } as unknown as StrategyAiClient;
      const service = new StrategyService(rooms, messages, aiClient, protect, makeSnowflake());

      const { write, frames } = collectingWriter();
      await service.streamChat('u1', 'room1', 'hi', write);

      expect(frames).toEqual(events);

      expect(save).toHaveBeenCalledTimes(1);
      const saved = save.mock.calls[0][0] as StrategyChatMessageEntity;
      expect(saved.role).toBe(MessageRole.ASSISTANT);
      expect(saved.content).toBe('안녕하세요');
      expect(saved.intent).toBe('ask');
      expect(saved.refinedQuery).toBe('무엇');
      expect(saved.metaJson).toBe('{"sources":["a","b"]}');
      expect(saved.aiMessageId).toBe('m1');
    });

    it('swallows malformed JSON in a content_chunk and keeps streaming', async () => {
      const events: Evt[] = [
        { event: 'content_chunk', data: 'not-json' },
        { event: 'content_chunk', data: JSON.stringify({ delta: 'ok' }) },
        { event: 'done', data: JSON.stringify({ message_id: 'm2' }) },
      ];
      const save = jest.fn();
      const messages = { save } as unknown as StrategyChatMessageRepository;
      const aiClient = { stream: jest.fn(() => streamOf(events)) } as unknown as StrategyAiClient;
      const service = new StrategyService(
        {} as unknown as StrategyChatRoomRepository,
        messages,
        aiClient,
        protect,
        makeSnowflake(),
      );

      const { write, frames } = collectingWriter();
      await expect(service.streamChat('u1', 'room1', 'hi', write)).resolves.toBeUndefined();
      expect(frames).toHaveLength(3);
      const saved = save.mock.calls[0][0] as StrategyChatMessageEntity;
      expect(saved.content).toBe('ok');
    });

    it('persists a partial assistant turn with aiMessageId null when done never arrives', async () => {
      const events: Evt[] = [
        { event: 'content_chunk', data: JSON.stringify({ delta: '부분' }) },
      ];
      const save = jest.fn();
      const messages = { save } as unknown as StrategyChatMessageRepository;
      const aiClient = { stream: jest.fn(() => streamOf(events)) } as unknown as StrategyAiClient;
      const service = new StrategyService(
        {} as unknown as StrategyChatRoomRepository,
        messages,
        aiClient,
        protect,
        makeSnowflake(),
      );

      const { write } = collectingWriter();
      await service.streamChat('u1', 'room1', 'hi', write);

      expect(save).toHaveBeenCalledTimes(1);
      const saved = save.mock.calls[0][0] as StrategyChatMessageEntity;
      expect(saved.content).toBe('부분');
      expect(saved.aiMessageId).toBeNull();
    });

    it('does not persist a second time when done already saved', async () => {
      const events: Evt[] = [
        { event: 'content_chunk', data: JSON.stringify({ delta: 'x' }) },
        { event: 'done', data: JSON.stringify({ message_id: 'm3' }) },
      ];
      const save = jest.fn();
      const messages = { save } as unknown as StrategyChatMessageRepository;
      const aiClient = { stream: jest.fn(() => streamOf(events)) } as unknown as StrategyAiClient;
      const service = new StrategyService(
        {} as unknown as StrategyChatRoomRepository,
        messages,
        aiClient,
        protect,
        makeSnowflake(),
      );

      const { write } = collectingWriter();
      await service.streamChat('u1', 'room1', 'hi', write);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('writes a STRATEGY_AI_SERVICE_UNAVAILABLE error frame on a BusinessException and does not rethrow', async () => {
      const err = new BusinessException('STRATEGY_AI_SERVICE_UNAVAILABLE');
      const aiClient = {
        stream: jest.fn(() => streamOf([], err)),
      } as unknown as StrategyAiClient;
      const service = new StrategyService(
        {} as unknown as StrategyChatRoomRepository,
        { save: jest.fn() } as unknown as StrategyChatMessageRepository,
        aiClient,
        protect,
        makeSnowflake(),
      );

      const { write, frames } = collectingWriter();
      await expect(service.streamChat('u1', 'room1', 'hi', write)).resolves.toBeUndefined();
      expect(frames).toEqual([
        { event: 'error', data: JSON.stringify({ code: 'STRATEGY_AI_SERVICE_UNAVAILABLE' }) },
      ]);
    });

    it('writes an INTERNAL_SERVER_ERROR error frame on a non-BusinessException', async () => {
      const aiClient = {
        stream: jest.fn(() => streamOf([], new Error('kaboom'))),
      } as unknown as StrategyAiClient;
      const service = new StrategyService(
        {} as unknown as StrategyChatRoomRepository,
        { save: jest.fn() } as unknown as StrategyChatMessageRepository,
        aiClient,
        protect,
        makeSnowflake(),
      );

      const { write, frames } = collectingWriter();
      await service.streamChat('u1', 'room1', 'hi', write);
      expect(frames).toEqual([
        { event: 'error', data: JSON.stringify({ code: 'INTERNAL_SERVER_ERROR' }) },
      ]);
    });
  });

  describe('listMessages', () => {
    it('throws STRATEGY_ROOM_NOT_FOUND when the room is not owned by the user', async () => {
      const rooms = {
        findByIdAndUserId: jest.fn().mockResolvedValue(null),
      } as unknown as StrategyChatRoomRepository;
      const service = new StrategyService(
        rooms,
        { findAllByRoomId: jest.fn() } as unknown as StrategyChatMessageRepository,
        {} as unknown as StrategyAiClient,
        protect,
        makeSnowflake(),
      );

      await expect(service.listMessages('room1', 'u1')).rejects.toThrow(
        expect.objectContaining({ code: 'STRATEGY_ROOM_NOT_FOUND' }),
      );
    });
  });
});
