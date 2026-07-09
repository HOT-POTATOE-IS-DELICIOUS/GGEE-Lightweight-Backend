import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProtectModule } from '../protect/protect.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditEntity } from './entities/audit.entity';
import { AuditRepository } from './repositories/audit.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AuditEntity]), ProtectModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
})
export class AuditModule {}
