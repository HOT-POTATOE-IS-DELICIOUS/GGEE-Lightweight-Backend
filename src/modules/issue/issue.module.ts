import { Module } from '@nestjs/common';
import { ProtectModule } from '../protect/protect.module';
import { IssueController } from './issue.controller';
import { IssueService } from './issue.service';

@Module({
  imports: [ProtectModule],
  controllers: [IssueController],
  providers: [IssueService],
})
export class IssueModule {}
