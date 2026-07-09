import { Module } from '@nestjs/common';
import { ProtectModule } from '../protect/protect.module';
import { IndexingJobController } from './indexing-job.controller';
import { NewsController } from './news.controller';
import { ReactionService } from './reaction.service';

/**
 * Reaction feature: news lookup (proxied to the reaction AI) + indexing-completion SSE waiter
 * (polls ProtectService for the outbox job's COMPLETED state).
 */
@Module({
  imports: [ProtectModule],
  controllers: [NewsController, IndexingJobController],
  providers: [ReactionService],
})
export class ReactionModule {}
