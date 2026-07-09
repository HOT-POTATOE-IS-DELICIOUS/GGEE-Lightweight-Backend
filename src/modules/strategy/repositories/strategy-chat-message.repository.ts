import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { StrategyChatMessageEntity } from '../entities/strategy-chat-message.entity';

@Injectable()
export class StrategyChatMessageRepository {
  constructor(
    @InjectRepository(StrategyChatMessageEntity)
    private readonly repo: Repository<StrategyChatMessageEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<StrategyChatMessageEntity> {
    return manager ? manager.getRepository(StrategyChatMessageEntity) : this.repo;
  }

  save(
    message: StrategyChatMessageEntity,
    manager?: EntityManager,
  ): Promise<StrategyChatMessageEntity> {
    return this.scoped(manager).save(message);
  }

  findAllByRoomId(roomId: string): Promise<StrategyChatMessageEntity[]> {
    return this.repo.find({
      where: { roomId, deleted: false },
      order: { createdAt: 'ASC' },
    });
  }
}
