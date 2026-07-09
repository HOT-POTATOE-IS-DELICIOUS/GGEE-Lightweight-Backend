import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ProtectEntity } from '../entities/protect.entity';

export interface ProtectTargetSnapshot {
  target: string;
  info: string;
}

@Injectable()
export class ProtectRepository {
  constructor(
    @InjectRepository(ProtectEntity)
    private readonly repo: Repository<ProtectEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<ProtectEntity> {
    return manager ? manager.getRepository(ProtectEntity) : this.repo;
  }

  save(protect: ProtectEntity, manager?: EntityManager): Promise<ProtectEntity> {
    return this.scoped(manager).save(protect);
  }

  findByUserId(userId: string): Promise<ProtectEntity | null> {
    return this.repo.findOne({ where: { userId, deleted: false } });
  }

  /** DISTINCT (target, info) across active protects — used by the 30-min refresh. */
  async findActiveDistinctTargets(): Promise<ProtectTargetSnapshot[]> {
    const rows = await this.repo
      .createQueryBuilder('p')
      .select('DISTINCT p.target', 'target')
      .addSelect('p.info', 'info')
      .where('p.deleted = false')
      .getRawMany<ProtectTargetSnapshot>();
    return rows;
  }
}
