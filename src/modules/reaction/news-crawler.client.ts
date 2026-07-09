import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { NewsSearchQueryDto, NewsSearchResponse } from './dto/news-search.dto';

/** Raw shape returned by news-crawler's `GET /search` (already snake_case, matches the wire contract). */
interface NewsCrawlerSearchResponse {
  total: number | null;
  hits:
    | {
        id: string;
        title: string | null;
        description: string | null;
        link: string;
        published_at: string;
      }[]
    | null;
}

/** Client for the news-crawler search API (`GGEE-NEWS-CRAWLER`, `GET /search`). */
@Injectable()
export class NewsCrawlerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: AiHttpClient,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('newsCrawler.baseUrl');
    this.timeoutMs = config.getOrThrow<number>('newsCrawler.timeoutMs');
  }

  async search(query: NewsSearchQueryDto): Promise<NewsSearchResponse> {
    const params = new URLSearchParams({ q: query.q });
    if (query.size !== undefined) params.set('size', String(query.size));
    if (query.from !== undefined) params.set('from', String(query.from));
    if (query.sort !== undefined) params.set('sort', query.sort);
    if (query.source !== undefined) params.set('source', query.source);
    if (query.category !== undefined) params.set('category', query.category);
    if (query.from_date !== undefined) params.set('from_date', query.from_date);
    if (query.to_date !== undefined) params.set('to_date', query.to_date);

    let result: NewsCrawlerSearchResponse;
    try {
      result = await this.http.getJson<NewsCrawlerSearchResponse>(
        `${this.baseUrl}/search?${params.toString()}`,
        this.timeoutMs,
      );
    } catch (err) {
      if (err instanceof AiHttpError) {
        throw new BusinessException('NEWS_SERVICE_UNAVAILABLE');
      }
      throw err;
    }

    const hits = (result.hits ?? []).map((hit) => ({
      id: hit.id,
      title: hit.title ?? '',
      description: hit.description ?? '',
      link: hit.link,
      published_at: hit.published_at,
    }));

    return { total: result.total ?? hits.length, hits };
  }
}
