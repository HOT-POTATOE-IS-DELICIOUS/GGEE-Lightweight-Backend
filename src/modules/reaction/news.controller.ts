import { Controller, Get, Param, Query } from '@nestjs/common';
import { NewsResponse } from './dto/reaction.dto';
import { NewsSearchQueryDto, NewsSearchResponse } from './dto/news-search.dto';
import { NewsCrawlerClient } from './news-crawler.client';
import { ReactionService } from './reaction.service';

/**
 * GET /news       — keyword search, proxied to the news-crawler (`GGEE-NEWS-CRAWLER`) `/search`.
 * GET /news/:node_id — recent news for a graph node, proxied to the reaction AI.
 * Both auth required.
 */
@Controller('news')
export class NewsController {
  constructor(
    private readonly reactionService: ReactionService,
    private readonly newsCrawlerClient: NewsCrawlerClient,
  ) {}

  @Get()
  searchNews(@Query() query: NewsSearchQueryDto): Promise<NewsSearchResponse> {
    return this.newsCrawlerClient.search(query);
  }

  @Get(':node_id')
  getNews(@Param('node_id') nodeId: string): Promise<NewsResponse> {
    return this.reactionService.getNews(nodeId);
  }
}
