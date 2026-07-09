import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { StrategyChatRoomEntity } from '../entities/strategy-chat-room.entity';

@Injectable()
export class StrategyChatRoomRepository {
  constructor(
    @InjectRepository(StrategyChatRoomEntity)
    private readonly repo: Repository<StrategyChatRoomEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<StrategyChatRoomEntity> {
    return manager ? manager.getRepository(StrategyChatRoomEntity) : this.repo;
  }

  save(room: StrategyChatRoomEntity, manager?: EntityManager): Promise<StrategyChatRoomEntity> {
    return this.scoped(manager).save(room);
  }

  findByIdAndUserId(id: string, userId: string): Promise<StrategyChatRoomEntity | null> {
    return this.repo.findOne({ where: { id, userId, deleted: false } });
  }

  findAllByUserId(userId: string): Promise<StrategyChatRoomEntity[]> {
    return this.repo.find({
      where: { userId, deleted: false },
      order: { createdAt: 'DESC' },
    });
  }

  async updateLastChattedAt(roomId: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(StrategyChatRoomEntity)
      .set({ lastChattedAt: at })
      .where('id = :id AND deleted = false', { id: roomId })
      .execute();
  }
}
