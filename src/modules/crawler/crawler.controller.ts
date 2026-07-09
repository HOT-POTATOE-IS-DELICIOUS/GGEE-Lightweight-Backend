import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../../security/public.decorator';
import { CrawlerDedupService } from './crawler-dedup.service';
import { CrawlResultMessage } from './crawler.types';

/**
 * Internal ingress from the crawler (replaces the `crawl.community.result` Kafka topic).
 * Public (service-to-service; not a user-facing JWT route).
 */
@Controller('internal/crawl')
export class CrawlerController {
  constructor(private readonly dedup: CrawlerDedupService) {}

  @Public()
  @Post('result')
  @HttpCode(HttpStatus.ACCEPTED)
  async result(@Body() message: CrawlResultMessage): Promise<void> {
    await this.dedup.handleCrawlResult(message);
  }
}
