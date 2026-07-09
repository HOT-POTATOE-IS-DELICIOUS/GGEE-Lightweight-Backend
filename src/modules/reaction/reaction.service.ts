import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { NewsResponse } from './dto/reaction.dto';

/** Shape of the upstream reaction AI `/news/{node_id}` JSON (snake_case). */
interface AiNewsResponse {
  node_id: string;
  count: number;
  news: { title: string; summary: string; link: string }[] | null;
}

@Injectable()
export class ReactionService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: AiHttpClient,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('ai.reaction.baseUrl');
    this.timeoutMs = config.getOrThrow<number>('ai.reaction.timeoutMs');
  }

  async getNews(nodeId: string): Promise<NewsResponse> {
    let result: AiNewsResponse;
    try {
      result = await this.http.getJson<AiNewsResponse>(
        `${this.baseUrl}/news/${encodeURIComponent(nodeId)}`,
        this.timeoutMs,
      );
    } catch (err) {
      if (err instanceof AiHttpError) {
        throw new BusinessException('NEWS_SERVICE_UNAVAILABLE');
      }
      throw err;
    }

    const news = (result.news ?? []).map((n) => ({
      title: n.title,
      summary: n.summary,
      link: n.link,
    }));
    // Recompute count from the coalesced list; ignore the upstream count.
    return { node_id: nodeId, count: news.length, news };
  }
}
