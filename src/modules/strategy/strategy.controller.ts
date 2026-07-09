import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../../common/error/business.exception';
import { AuthUser } from '../../security/auth-user';
import { CurrentUser } from '../../security/current-user.decorator';
import {
  ChatMessageRequestDto,
  CreateRoomRequestDto,
  MessageResponse,
  RoomResponse,
} from './dto/strategy.dto';
import { StrategyService, SseWriter } from './strategy.service';

@Controller('strategy/rooms')
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  /** POST /strategy/rooms — create a room and stream the first assistant turn (SSE). */
  @Post()
  @HttpCode(HttpStatus.OK) // 200: an SSE stream, not a creation response (Nest defaults POST to 201)
  async createRoom(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRoomRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const roomId = await this.strategyService.createRoom(user.userId, dto.message);
    const write = this.openSse(res);
    // Hand-built JSON, camelCase `roomId` (byte-parity with the original); the id is a string.
    write('room_created', JSON.stringify({ roomId }));
    await this.strategyService.streamChat(user.userId, roomId, dto.message, write);
    res.end();
  }

  /** POST /strategy/rooms/:room_id/messages/stream — continue an existing chat (SSE). */
  @Post(':room_id/messages/stream')
  @HttpCode(HttpStatus.OK) // 200: an SSE stream (Nest defaults POST to 201)
  async streamMessage(
    @CurrentUser() user: AuthUser,
    @Param('room_id') roomId: string,
    @Body() dto: ChatMessageRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    // Resolve the room BEFORE any SSE headers so a miss surfaces as a plain 404, not an SSE frame.
    const room = await this.strategyService.findRoom(roomId, user.userId);
    if (!room) {
      throw new BusinessException('STRATEGY_ROOM_NOT_FOUND');
    }
    await this.strategyService.appendUserMessage(roomId, dto.message);
    const write = this.openSse(res);
    await this.strategyService.streamChat(user.userId, roomId, dto.message, write);
    res.end();
  }

  /** GET /strategy/rooms — list the user's rooms (JSON). */
  @Get()
  listRooms(@CurrentUser() user: AuthUser): Promise<RoomResponse[]> {
    return this.strategyService.listRooms(user.userId);
  }

  /** GET /strategy/rooms/:room_id/messages — list a room's messages (JSON). */
  @Get(':room_id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('room_id') roomId: string,
  ): Promise<MessageResponse[]> {
    return this.strategyService.listMessages(roomId, user.userId);
  }

  private openSse(res: Response): SseWriter {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    return (event: string, data: string) => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };
  }
}
