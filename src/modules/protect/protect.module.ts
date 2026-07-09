import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrawlerController } from '../crawler/crawler.controller';
import { CrawlerDedupService } from '../crawler/crawler-dedup.service';
import { IndexingJobEntity } from './entities/indexing-job.entity';
import { ProtectEntity } from './entities/protect.entity';
import { ProtectService } from './protect.service';
import { IndexingJobRepository } from './repositories/indexing-job.repository';
import { ProtectRepository } from './repositories/protect.repository';

/**
 * Protect indexing + crawler dedup ingress. ProtectService is exported so member (register),
 * audit, issue, strategy (getByUserId) and reaction (indexing waiter) can use it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProtectEntity, IndexingJobEntity])],
  controllers: [CrawlerController],
  providers: [ProtectService, ProtectRepository, IndexingJobRepository, CrawlerDedupService],
  exports: [ProtectService],
})
export class ProtectModule {}
