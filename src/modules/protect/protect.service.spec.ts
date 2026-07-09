import { ConfigService } from '@nestjs/config';
import { AiHttpClient } from '../../common/http/ai-http.client';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { IndexingJobStatus } from './entities/indexing-job.entity';
import { ProtectService } from './protect.service';
import { IndexingJobRepository } from './repositories/indexing-job.repository';
import { ProtectRepository } from './repositories/protect.repository';

const makeConfig = () =>
  ({ getOrThrow: () => 'http://crawler' }) as unknown as ConfigService;

const makeJobs = () =>
  ({
    save: jest.fn(async (job) => job),
    markCompleted: jest.fn(async () => undefined),
    markFailed: jest.fn(async () => undefined),
    findStatus: jest.fn(async () => null),
  }) as unknown as jest.Mocked<IndexingJobRepository>;

describe('ProtectService.requestIndexing', () => {
  const snowflake = { generateId: () => '1' } as unknown as SnowflakeService;
  const protects = {} as ProtectRepository;

  it('leaves the job PENDING when the crawler accepts the dispatch', async () => {
    const jobs = makeJobs();
    const http = { postJson: jest.fn(async () => ({})) } as unknown as AiHttpClient;
    const service = new ProtectService(protects, jobs, snowflake, http, makeConfig());

    await service.requestIndexing('42', '홍길동', 'info');

    expect(http.postJson).toHaveBeenCalledWith(
      'http://crawler/crawl/request',
      { job_id: '42', keyword: '홍길동', protect_target_info: 'info' },
      expect.any(Number),
    );
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });

  it('marks the job FAILED when the dispatch throws, so the waiter reports it', async () => {
    const jobs = makeJobs();
    const http = {
      postJson: jest.fn(async () => {
        throw new Error('crawler down');
      }),
    } as unknown as AiHttpClient;
    const service = new ProtectService(protects, jobs, snowflake, http, makeConfig());

    await expect(service.requestIndexing('42', '홍길동', 'info')).resolves.toBeUndefined();

    expect(jobs.markFailed).toHaveBeenCalledWith('42');
  });

  it('swallows a bookkeeping failure: register already committed', async () => {
    const jobs = makeJobs();
    jobs.markFailed.mockRejectedValueOnce(new Error('db down'));
    const http = {
      postJson: jest.fn(async () => {
        throw new Error('crawler down');
      }),
    } as unknown as AiHttpClient;
    const service = new ProtectService(protects, jobs, snowflake, http, makeConfig());

    await expect(service.requestIndexing('42', '홍길동', 'info')).resolves.toBeUndefined();
  });
});

describe('ProtectService.scheduleIndexing', () => {
  const snowflake = { generateId: () => '1' } as unknown as SnowflakeService;
  const protects = {} as ProtectRepository;

  /** A dispatch that only settles when we say so, so we can observe the in-flight window. */
  const deferredHttp = () => {
    let release!: () => void;
    const landed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const postJson = jest.fn(async () => {
      await landed;
      return {};
    });
    return { http: { postJson } as unknown as AiHttpClient, release, postJson };
  };

  it('returns before the crawler responds', async () => {
    const { http, release, postJson } = deferredHttp();
    const service = new ProtectService(protects, makeJobs(), snowflake, http, makeConfig());

    service.scheduleIndexing('42', '홍길동', 'info');

    expect(postJson).toHaveBeenCalled();
    release();
    await service.onModuleDestroy();
  });

  it('onModuleDestroy waits for an in-flight dispatch to land', async () => {
    const { http, release } = deferredHttp();
    const service = new ProtectService(protects, makeJobs(), snowflake, http, makeConfig());

    service.scheduleIndexing('42', '홍길동', 'info');

    let drained = false;
    const drain = service.onModuleDestroy().then(() => {
      drained = true;
    });

    await new Promise((r) => setImmediate(r));
    expect(drained).toBe(false); // still blocked on the dispatch

    release();
    await drain;
    expect(drained).toBe(true);
  });

  it('onModuleDestroy resolves even when the dispatch failed', async () => {
    const jobs = makeJobs();
    const http = {
      postJson: jest.fn(async () => {
        throw new Error('crawler down');
      }),
    } as unknown as AiHttpClient;
    const service = new ProtectService(protects, jobs, snowflake, http, makeConfig());

    service.scheduleIndexing('42', '홍길동', 'info');

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(jobs.markFailed).toHaveBeenCalledWith('42');
  });
});

describe('ProtectService.getJobStatus', () => {
  it('passes the repository status straight through', async () => {
    const jobs = makeJobs();
    jobs.findStatus.mockResolvedValueOnce(IndexingJobStatus.FAILED);
    const service = new ProtectService(
      {} as ProtectRepository,
      jobs,
      { generateId: () => '1' } as unknown as SnowflakeService,
      { postJson: jest.fn() } as unknown as AiHttpClient,
      makeConfig(),
    );

    await expect(service.getJobStatus('42')).resolves.toBe(IndexingJobStatus.FAILED);
  });
});
