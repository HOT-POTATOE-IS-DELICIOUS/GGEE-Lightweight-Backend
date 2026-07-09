import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { NewsCrawlerClient } from './news-crawler.client';

const config = {
  getOrThrow: (key: string) =>
    (
      ({
        'newsCrawler.baseUrl': 'http://news-crawler',
        'newsCrawler.timeoutMs': 2000,
      }) as Record<string, unknown>
    )[key],
} as unknown as ConfigService;

describe('NewsCrawlerClient', () => {
  it('GETs {baseUrl}/search with only the provided query params', async () => {
    const getJson = jest.fn().mockResolvedValue({ total: 0, hits: [] });
    const http = { getJson } as unknown as AiHttpClient;
    const client = new NewsCrawlerClient(http, config);

    await client.search({ q: '트럼프' });

    expect(getJson).toHaveBeenCalledWith(
      `http://news-crawler/search?q=${encodeURIComponent('트럼프')}`,
      2000,
    );
  });

  it('forwards optional params verbatim', async () => {
    const getJson = jest.fn().mockResolvedValue({ total: 0, hits: [] });
    const http = { getJson } as unknown as AiHttpClient;
    const client = new NewsCrawlerClient(http, config);

    await client.search({
      q: 'AI',
      size: 20,
      from: 10,
      sort: 'date',
      source: '연합뉴스',
      category: '정치',
      from_date: '2026-01-01',
      to_date: '2026-12-31',
    });

    const url = getJson.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('size')).toBe('20');
    expect(params.get('from')).toBe('10');
    expect(params.get('sort')).toBe('date');
    expect(params.get('source')).toBe('연합뉴스');
    expect(params.get('category')).toBe('정치');
    expect(params.get('from_date')).toBe('2026-01-01');
    expect(params.get('to_date')).toBe('2026-12-31');
  });

  it('passes through total/hits from the upstream response', async () => {
    const getJson = jest.fn().mockResolvedValue({
      total: 2,
      hits: [
        { id: 'a', title: 'T1', description: 'D1', link: 'L1', published_at: 'P1' },
        { id: 'b', title: null, description: null, link: 'L2', published_at: 'P2' },
      ],
    });
    const http = { getJson } as unknown as AiHttpClient;
    const client = new NewsCrawlerClient(http, config);

    const result = await client.search({ q: 'x' });
    expect(result.total).toBe(2);
    expect(result.hits).toEqual([
      { id: 'a', title: 'T1', description: 'D1', link: 'L1', published_at: 'P1' },
      { id: 'b', title: '', description: '', link: 'L2', published_at: 'P2' },
    ]);
  });

  it('coalesces a null hits list to empty with total 0', async () => {
    const getJson = jest.fn().mockResolvedValue({ total: null, hits: null });
    const http = { getJson } as unknown as AiHttpClient;
    const client = new NewsCrawlerClient(http, config);

    const result = await client.search({ q: 'x' });
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('maps AiHttpError to NEWS_SERVICE_UNAVAILABLE', async () => {
    const getJson = jest.fn().mockRejectedValue(new AiHttpError('boom'));
    const http = { getJson } as unknown as AiHttpClient;
    const client = new NewsCrawlerClient(http, config);

    await expect(client.search({ q: 'x' })).rejects.toThrow(
      expect.objectContaining({ code: 'NEWS_SERVICE_UNAVAILABLE' }),
    );
  });
});
