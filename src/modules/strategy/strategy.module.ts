import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProtectModule } from '../protect/protect.module';
import { StrategyChatMessageEntity } from './entities/strategy-chat-message.entity';
import { StrategyChatRoomEntity } from './entities/strategy-chat-room.entity';
import { StrategyChatMessageRepository } from './repositories/strategy-chat-message.repository';
import { StrategyChatRoomRepository } from './repositories/strategy-chat-room.repository';
import { StrategyAiClient } from './strategy-ai.client';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StrategyChatRoomEntity, StrategyChatMessageEntity]),
    ProtectModule,
  ],
  controllers: [StrategyController],
  providers: [
    StrategyService,
    StrategyAiClient,
    StrategyChatRoomRepository,
    StrategyChatMessageRepository,
  ],
})
export class StrategyModule {}
