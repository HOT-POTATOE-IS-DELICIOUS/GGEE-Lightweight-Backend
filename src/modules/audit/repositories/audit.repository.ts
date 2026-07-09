import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEntity } from '../entities/audit.entity';

@Injectable()
export class AuditRepository {
  constructor(
    @InjectRepository(AuditEntity)
    private readonly repo: Repository<AuditEntity>,
  ) {}

  save(audit: AuditEntity): Promise<AuditEntity> {
    return this.repo.save(audit);
  }
}
