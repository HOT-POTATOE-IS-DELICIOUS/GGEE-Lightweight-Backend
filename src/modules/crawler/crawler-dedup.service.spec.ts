import type Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { AiHttpClient } from '../../common/http/ai-http.client';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { ProtectService } from '../protect/protect.service';
import { CrawlerDedupService } from './crawler-dedup.service';
import { CrawlCommentMessage, CrawlPostMessage, CrawlResultMessage } from './crawler.types';

const makeConfig = (forwardUrl = 'http://downstream') =>
  ({
    getOrThrow: (key: string) =>
      (
        ({
          'crawler.dedupTtlSeconds': 3600,
          'crawler.dedupForwardUrl': forwardUrl,
        }) as Record<string, unknown>
      )[key],
  }) as unknown as ConfigService;

const comment = (over: Partial<CrawlCommentMessage> = {}): CrawlCommentMessage => ({
  id: 1,
  parent_id: null,
  author: 'a',
  date: '2026-01-01',
  content: 'c',
  likes: 0,
  dislikes: 0,
  ...over,
});

const post = (over: Partial<CrawlPostMessage> = {}): CrawlPostMessage => ({
  title: 'title',
  comment_count: 1,
  view_count: 0,
  recommend_count: 0,
  date: '2026-01-01',
  body: 'body',
  comments: [comment()],
  url: 'http://forum/post/1',
  ...over,
});

const result = (over: Partial<CrawlResultMessage> = {}): CrawlResultMessage => ({
  jobId: 'job-1',
  timestamp: '2026-01-01T00:00:00Z',
  status: 'completed',
  site: 'site',
  keyword: 'kw',
  results: [post()],
  ...over,
});

interface Harness {
  service: CrawlerDedupService;
  exists: jest.Mock;
  set: jest.Mock;
  postJson: jest.Mock;
  markJobCompleted: jest.Mock;
  generateId: jest.Mock;
}

function build(
  opts: { existsReturn?: number | ((key: string) => number); forwardUrl?: string } = {},
): Harness {
  const existsImpl = opts.existsReturn ?? 0;
  const exists = jest.fn((key: string) =>
    Promise.resolve(typeof existsImpl === 'function' ? existsImpl(key) : existsImpl),
  );
  const set = jest.fn().mockResolvedValue('OK');
  const redis = { exists, set } as unknown as Redis;
  const generateId = jest.fn().mockReturnValue('POST_ID');
  const snowflake = { generateId } as unknown as SnowflakeService;
  const postJson = jest.fn().mockResolvedValue(undefined);
  const http = { postJson } as unknown as AiHttpClient;
  const markJobCompleted = jest.fn().mockResolvedValue(undefined);
  const protect = { markJobCompleted } as unknown as ProtectService;
  const service = new CrawlerDedupService(
    redis,
    snowflake,
    http,
    protect,
    makeConfig(opts.forwardUrl),
  );
  return { service, exists, set, postJson, markJobCompleted, generateId };
}

describe('CrawlerDedupService', () => {
  it('marks the job completed on all_done and performs no dedup', async () => {
    const h = build();
    await h.service.handleCrawlResult(result({ status: 'all_done', jobId: 'job-9' }));

    expect(h.markJobCompleted).toHaveBeenCalledWith('job-9');
    expect(h.exists).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.postJson).not.toHaveBeenCalled();
  });

  it('is a no-op for a status other than completed / all_done', async () => {
    const h = build();
    await h.service.handleCrawlResult(result({ status: 'in_progress' }));

    expect(h.markJobCompleted).not.toHaveBeenCalled();
    expect(h.exists).not.toHaveBeenCalled();
    expect(h.postJson).not.toHaveBeenCalled();
  });

  it('uses the dedup:{commentId}|{postUrl} key and refreshes the TTL on every sighting (even already-seen)', async () => {
    const h = build({ existsReturn: 1 }); // already seen
    await h.service.handleCrawlResult(
      result({ results: [post({ url: 'http://forum/p', comments: [comment({ id: 42 })] })] }),
    );

    expect(h.set).toHaveBeenCalledWith('dedup:42|http://forum/p', expect.any(String), 'EX', 3600);
    // already-seen -> not forwarded
    expect(h.postJson).not.toHaveBeenCalled();
  });

  it('forwards only comments whose key did not already exist', async () => {
    // comment id 1 already exists, id 2 is new
    const h = build({ existsReturn: (key: string) => (key.includes('dedup:1|') ? 1 : 0) });
    await h.service.handleCrawlResult(
      result({
        results: [post({ comments: [comment({ id: 1 }), comment({ id: 2 })] })],
      }),
    );

    const commentPosts = h.postJson.mock.calls.filter((c) =>
      String(c[0]).endsWith('/comment.deduped'),
    );
    expect(commentPosts).toHaveLength(1);
    expect((commentPosts[0][1] as { id: number }).id).toBe(2);
  });

  it('emits exactly one post.deduped and N comment.deduped sharing the generated post_id', async () => {
    const h = build({ existsReturn: 0 });
    await h.service.handleCrawlResult(
      result({
        results: [post({ comments: [comment({ id: 1 }), comment({ id: 2 })] })],
      }),
    );

    const postCalls = h.postJson.mock.calls.filter((c) => String(c[0]).endsWith('/post.deduped'));
    const commentCalls = h.postJson.mock.calls.filter((c) =>
      String(c[0]).endsWith('/comment.deduped'),
    );
    expect(postCalls).toHaveLength(1);
    expect(commentCalls).toHaveLength(2);

    expect((postCalls[0][1] as { post_id: string }).post_id).toBe('POST_ID');
    for (const c of commentCalls) {
      expect((c[1] as { post_id: string }).post_id).toBe('POST_ID');
    }
    expect(h.generateId).toHaveBeenCalledTimes(1);
  });

  it('skips posts with a blank/missing url or with no comments', async () => {
    const h = build({ existsReturn: 0 });
    await h.service.handleCrawlResult(
      result({
        results: [
          post({ url: '   ', comments: [comment({ id: 1 })] }),
          post({ url: null, comments: [comment({ id: 2 })] }),
          post({ url: 'http://forum/p', comments: [] }),
          post({ url: 'http://forum/p', comments: null }),
        ],
      }),
    );

    expect(h.exists).not.toHaveBeenCalled();
    expect(h.postJson).not.toHaveBeenCalled();
  });

  it('skips comments with a null id', async () => {
    const h = build({ existsReturn: 0 });
    await h.service.handleCrawlResult(
      result({
        results: [post({ comments: [comment({ id: null }), comment({ id: 5 })] })],
      }),
    );

    // only the valid comment is keyed and forwarded
    expect(h.exists).toHaveBeenCalledTimes(1);
    const commentCalls = h.postJson.mock.calls.filter((c) =>
      String(c[0]).endsWith('/comment.deduped'),
    );
    expect(commentCalls).toHaveLength(1);
    expect((commentCalls[0][1] as { id: number }).id).toBe(5);
  });

  it('POSTs nothing when the forward URL is empty (logs only)', async () => {
    const h = build({ existsReturn: 0, forwardUrl: '' });
    await h.service.handleCrawlResult(
      result({ results: [post({ comments: [comment({ id: 1 })] })] }),
    );

    // dedup still runs (key is set) but nothing is forwarded downstream
    expect(h.set).toHaveBeenCalled();
    expect(h.postJson).not.toHaveBeenCalled();
  });
});
