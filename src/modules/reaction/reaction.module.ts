import { Module } from '@nestjs/common';
import { ProtectModule } from '../protect/protect.module';
import { IndexingJobController } from './indexing-job.controller';
import { NewsController } from './news.controller';
import { NewsCrawlerClient } from './news-crawler.client';
import { ReactionService } from './reaction.service';

/**
 * Reaction feature: node news lookup (proxied to the reaction AI) + keyword news search
 * (proxied to the news-crawler `/search`) + indexing-completion SSE waiter
 * (polls ProtectService for the outbox job's COMPLETED state).
 */
@Module({
  imports: [ProtectModule],
  controllers: [NewsController, IndexingJobController],
  providers: [ReactionService, NewsCrawlerClient],
})
export class ReactionModule {}
