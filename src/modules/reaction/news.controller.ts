import { Controller, Get, Param } from '@nestjs/common';
import { NewsResponse } from './dto/reaction.dto';
import { ReactionService } from './reaction.service';

/** GET /news/:node_id — recent news for a graph node (JSON, auth required). */
@Controller('news')
export class NewsController {
  constructor(private readonly reactionService: ReactionService) {}

  @Get(':node_id')
  getNews(@Param('node_id') nodeId: string): Promise<NewsResponse> {
    return this.reactionService.getNews(nodeId);
  }
}
