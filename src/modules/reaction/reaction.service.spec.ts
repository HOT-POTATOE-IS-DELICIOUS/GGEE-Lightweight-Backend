import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { ReactionService } from './reaction.service';

const config = {
  getOrThrow: (key: string) =>
    (
      ({ 'ai.reaction.baseUrl': 'http://reaction', 'ai.reaction.timeoutMs': 1500 }) as Record<
        string,
        unknown
      >
    )[key],
} as unknown as ConfigService;

const newsItem = (n: number) => ({
  title: `t${n}`,
  summary: `s${n}`,
  link: `l${n}`,
});

describe('ReactionService', () => {
  it('GETs {baseUrl}/news/{node_id} with the node id URL-encoded', async () => {
    const getJson = jest.fn().mockResolvedValue({ node_id: 'up', count: 0, news: [] });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new ReactionService(http, config);

    await service.getNews('a b/c');

    expect(getJson).toHaveBeenCalledWith('http://reaction/news/a%20b%2Fc', 1500);
  });

  it('recomputes count from the list, ignoring the upstream count', async () => {
    const getJson = jest
      .fn()
      .mockResolvedValue({ node_id: 'up', count: 999, news: [newsItem(1), newsItem(2)] });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new ReactionService(http, config);

    const result = await service.getNews('node1');
    expect(result.count).toBe(2);
    expect(result.news).toHaveLength(2);
  });

  it('echoes the requested node id, not the upstream one', async () => {
    const getJson = jest.fn().mockResolvedValue({ node_id: 'upstream-id', count: 0, news: [] });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new ReactionService(http, config);

    const result = await service.getNews('requested-id');
    expect(result.node_id).toBe('requested-id');
  });

  it('coalesces null news to an empty list with count 0', async () => {
    const getJson = jest.fn().mockResolvedValue({ node_id: 'up', count: 5, news: null });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new ReactionService(http, config);

    const result = await service.getNews('node1');
    expect(result.news).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('maps AiHttpError to NEWS_SERVICE_UNAVAILABLE', async () => {
    const getJson = jest.fn().mockRejectedValue(new AiHttpError('boom'));
    const http = { getJson } as unknown as AiHttpClient;
    const service = new ReactionService(http, config);

    await expect(service.getNews('node1')).rejects.toThrow(
      expect.objectContaining({ code: 'NEWS_SERVICE_UNAVAILABLE' }),
    );
  });
});
