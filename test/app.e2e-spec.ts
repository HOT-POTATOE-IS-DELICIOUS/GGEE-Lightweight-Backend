import 'reflect-metadata';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { AiMocks, startAiMocks } from './mock-ai';
import { ensureTestDatabase, runMigrations, truncateAll } from './setup-db';

/**
 * Full-stack E2E suite: boots the real AppModule against a dedicated `ggee_test` database and
 * live mock AI/crawler servers, then drives it end-to-end with supertest (JSON) and raw http (SSE).
 *
 * The `it`s are ORDERED and share state (tokens, room id, indexing job id): the flow is
 * sequential (register → login → feature calls → refresh → logout → internal callbacks → failures).
 */

const EMAIL = 'e2e-user@bssm.hs.kr';
const PASSWORD = 'password123';
const PROTECT_TARGET = 'BSSM';
const PROTECT_INFO = '부산소프트웨어마이스터고';
const ROOM_MESSAGE = '긴급 상황 대응 전략을 자세히 알려주세요';

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

interface SseFrame {
  event: string;
  data: string;
}

function setBaseEnv(): void {
  process.env.SERVER_PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_HOST = 'localhost';
  process.env.DATABASE_PORT = '5433';
  process.env.DATABASE_USERNAME = 'root';
  process.env.DATABASE_PASSWORD = 'password';
  process.env.DATABASE_NAME = 'ggee_test';
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6380';
  process.env.JWT_ACCESS_TOKEN_ACTIVE_TIME = '3600000';
  process.env.JWT_REFRESH_TOKEN_ACTIVE_TIME = '1209600000';
  process.env.JWT_HEADER = 'Authorization';
  process.env.JWT_PREFIX = 'Bearer';
  process.env.JWT_SECRET_KEY = Buffer.from(
    'ggee-e2e-testing-hmac-secret-key-0123456789abcdef',
  ).toString('base64');
  process.env.SNOWFLAKE_WORKER_ID = '1';
  process.env.GGEE_CRAWLER_DEDUP_TTL = '1h';
  process.env.GGEE_AI_AUDIT_TIMEOUT = '10s';
  process.env.GGEE_AI_ISSUE_TIMEOUT = '10s';
  process.env.GGEE_AI_REACTION_TIMEOUT = '10s';
  process.env.GGEE_AI_STRATEGY_TIMEOUT = '30s';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';
}

function setMockEnv(m: AiMocks): void {
  process.env.GGEE_AI_AUDIT_BASE_URL = m.audit.baseUrl;
  process.env.GGEE_AI_ISSUE_BASE_URL = m.issue.baseUrl;
  process.env.GGEE_AI_REACTION_BASE_URL = m.reaction.baseUrl;
  process.env.GGEE_AI_STRATEGY_BASE_URL = m.strategy.baseUrl;
  process.env.CRAWLER_BASE_URL = m.crawler.baseUrl;
  process.env.CRAWLER_DEDUP_FORWARD_URL = m.forward.baseUrl;
}

function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
        else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
      }
      return { event, data };
    });
}

/**
 * Poll until `predicate` holds. Register dispatches to the crawler fire-and-forget, so the HTTP
 * response can beat the dispatch; asserting on the mock's inbox needs a wait, not a bare read.
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('GGEE Lightweight Backend (E2E)', () => {
  let app: INestApplication;
  let server: http.Server;
  let baseUrl: string;
  let dataSource: DataSource;
  let redisTest: Redis;
  let mocks: AiMocks;

  // Shared, mutated across the ordered flow.
  let accessToken = '';
  let refreshR1 = '';
  let indexingJobId = '';
  let roomId = '';
  let roomLastChattedBefore = '';

  const bearer = (): string => `Bearer ${accessToken}`;

  /** Raw http request (used for SSE endpoints supertest buffers awkwardly). */
  function rawRequest(
    method: string,
    path: string,
    body: unknown,
    token?: string,
  ): Promise<RawResponse> {
    return new Promise<RawResponse>((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const headers: Record<string, string | number> = {};
      let payload: string | undefined;
      if (body !== null && body !== undefined) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = http.request(url, { method, headers }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: data }),
        );
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  beforeAll(async () => {
    setBaseEnv();
    await ensureTestDatabase();
    await runMigrations();
    await truncateAll();

    mocks = await startAiMocks();
    setMockEnv(mocks);

    // Import AppModule AFTER env is set so configuration() and dotenv see our values.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);

    server = app.getHttpServer() as http.Server;
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    dataSource = app.get(DataSource);
    redisTest = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      maxRetriesPerRequest: 2,
    });
  }, 60000);

  afterAll(async () => {
    if (redisTest) await redisTest.quit().catch(() => undefined);
    if (app) await app.close();
    if (mocks) await mocks.stopAll();
  }, 30000);

  // ── health / guard / validation ────────────────────────────────────────────

  it('GET /actuator/health → 200 {status:UP}', async () => {
    const res = await request(server).get('/actuator/health').expect(200);
    expect(res.body).toEqual({ status: 'UP' });
  });

  it('GET /issues without token → 401 and empty body', async () => {
    const res = await request(server).get('/issues').expect(401);
    expect(res.text).toBe('');
  });

  it('register with a 5-char password → 400 text/plain with the length message', async () => {
    const res = await request(server)
      .post('/auth/register')
      .send({
        email: 'valid@bssm.hs.kr',
        password: '12345',
        protect_target: 'X',
        protect_target_info: 'Y',
      })
      .expect(400);
    expect(res.type).toBe('text/plain');
    expect(res.text).toBe('비밀번호는 최소 8자 이상 20자 이하여야 합니다.');
  });

  // ── register / login ─────────────────────────────────────────────────────────

  it('register → 201 with tokens and dispatches the crawler', async () => {
    const res = await request(server)
      .post('/auth/register')
      .send({
        email: EMAIL,
        password: PASSWORD,
        protect_target: PROTECT_TARGET,
        protect_target_info: PROTECT_INFO,
      })
      .expect(201);

    expect(res.body.indexing_job_id).toMatch(/^\d+$/);
    expect(typeof res.body.access_token).toBe('string');
    expect(typeof res.body.refresh_token).toBe('string');
    indexingJobId = res.body.indexing_job_id;

    await waitFor(() => mocks.crawler.requests.some((r) => r.path === '/crawl/request'));
    const crawlReq = mocks.crawler.requests.find((r) => r.path === '/crawl/request');
    expect(crawlReq!.body).toEqual({
      job_id: indexingJobId,
      keyword: PROTECT_TARGET,
      protect_target_info: PROTECT_INFO,
    });
  });

  it('register with a duplicate email → 409', async () => {
    const res = await request(server)
      .post('/auth/register')
      .send({
        email: EMAIL,
        password: PASSWORD,
        protect_target: 'X',
        protect_target_info: 'Y',
      })
      .expect(409);
    expect(res.text).toBe('이미 존재하는 이메일입니다.');
  });

  it('login → 201 and wrong password → 401', async () => {
    const ok = await request(server)
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    accessToken = ok.body.access_token;
    refreshR1 = ok.body.refresh_token;
    expect(accessToken).toBeTruthy();
    expect(refreshR1).toBeTruthy();

    const bad = await request(server)
      .post('/auth/login')
      .send({ email: EMAIL, password: 'wrongpassword' })
      .expect(401);
    expect(bad.text).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });

  // ── audit ─────────────────────────────────────────────────────────────────────

  it('POST /audit → 200 snake_case, null-coalesced, camelCase persisted', async () => {
    const res = await request(server)
      .post('/audit')
      .set('Authorization', bearer())
      .send({ text: '검수할 문장입니다' })
      .expect(200);

    expect(typeof res.body.audit_id).toBe('string');
    const reviews = res.body.reviews;
    expect(reviews).toHaveLength(2);

    expect(reviews[0].sentence).toEqual({ sentence_text: '문장', start_offset: 0, end_offset: 3 });
    expect(reviews[0].perspective_ids).toEqual(['community']);
    expect(reviews[0].perspective_labels).toEqual(['커뮤니티']);
    expect(reviews[0].suggestions[0]).toEqual({
      start_index: 0,
      end_index: 2,
      before: 'a',
      after: 'b',
      reason: 'r',
    });

    // null-coalescing on the second review
    expect(reviews[1].sentence.start_offset).toBe(0);
    expect(reviews[1].sentence.end_offset).toBe(0);
    expect(reviews[1].perspective_ids).toEqual([]);
    expect(reviews[1].suggestions).toEqual([]);

    // stored reviews_json is camelCase
    const rows = await dataSource.query(
      'SELECT reviews_json FROM audits ORDER BY "createdAt" DESC LIMIT 1',
    );
    const parsed = JSON.parse(rows[0].reviews_json);
    expect(parsed[0].sentence).toHaveProperty('sentenceText', '문장');
    expect(parsed[0].sentence).toHaveProperty('startOffset', 0);
    expect(parsed[0].sentence).toHaveProperty('endOffset', 3);
    expect(parsed[0]).toHaveProperty('perspectiveIds', ['community']);
    expect(parsed[0]).toHaveProperty('perspectiveLabels', ['커뮤니티']);
    expect(parsed[0].suggestions[0]).toHaveProperty('startIndex', 0);
    expect(parsed[0].suggestions[0]).toHaveProperty('endIndex', 2);
  });

  // ── issues ────────────────────────────────────────────────────────────────────

  it('GET /issues → 200 normalized (sorted, swapped edge, null→0, target fallback)', async () => {
    const res = await request(server).get('/issues').set('Authorization', bearer()).expect(200);

    // entity_name was null upstream → falls back to the protect target.
    expect(res.body.protect_target).toBe(PROTECT_TARGET);

    // sorted by date ASC nulls-last
    expect(res.body.issues.map((i: { id: string }) => i.id)).toEqual(['n1', 'n2', 'n3']);

    const n1 = res.body.issues.find((i: { id: string }) => i.id === 'n1');
    expect(n1.criticism).toBe(0);
    expect(n1.support).toBe(0);
    expect(n1.interest).toBe(0);

    // edge always points newest→oldest: first connection swapped to n2→n1
    expect(res.body.connections[0]).toEqual({ source_id: 'n2', target_id: 'n1', similarity: 0 });
    // second already newest→oldest, kept; null similarity would be 0 but here 0.8
    expect(res.body.connections[1]).toEqual({ source_id: 'n2', target_id: 'n1', similarity: 0.8 });
  });

  // ── news ──────────────────────────────────────────────────────────────────────

  it('GET /news/:id → 200 count recomputed, node id echoed', async () => {
    const res = await request(server)
      .get('/news/graph-node-9')
      .set('Authorization', bearer())
      .expect(200);
    expect(res.body.node_id).toBe('graph-node-9');
    expect(res.body.count).toBe(2); // upstream said 999
    expect(res.body.news).toHaveLength(2);
  });

  // ── strategy: create room (SSE) ────────────────────────────────────────────────

  it('POST /strategy/rooms → 200 SSE with room_created + relayed frames', async () => {
    const r = await rawRequest('POST', '/strategy/rooms', { message: ROOM_MESSAGE }, accessToken);
    expect(r.status).toBe(200);

    const frames = parseSse(r.text);
    expect(frames.map((f) => f.event)).toEqual([
      'room_created',
      'intent_classified',
      'content_chunk',
      'content_chunk',
      'meta',
      'done',
    ]);

    // room_created data JSON uses camelCase roomId
    expect(frames[0].data).toContain('roomId');
    const created = JSON.parse(frames[0].data);
    expect(created.roomId).toMatch(/^\d+$/);
    roomId = created.roomId;
  });

  it('GET /strategy/rooms → snake_case keys, title = first 12 chars', async () => {
    const res = await request(server)
      .get('/strategy/rooms')
      .set('Authorization', bearer())
      .expect(200);
    expect(res.body).toHaveLength(1);
    const room = res.body[0];
    expect(room.title).toBe(ROOM_MESSAGE.slice(0, 12));
    expect(Object.keys(room).sort()).toEqual([
      'created_at',
      'last_chatted_at',
      'room_id',
      'title',
    ]);
    roomLastChattedBefore = room.last_chatted_at;
  });

  it('GET /strategy/rooms/:id/messages → [USER, ASSISTANT] with accumulated turn', async () => {
    const res = await request(server)
      .get(`/strategy/rooms/${roomId}/messages`)
      .set('Authorization', bearer())
      .expect(200);

    expect(res.body.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT']);
    const assistant = res.body[1];
    expect(assistant.content).toBe('안녕하세요');
    expect(assistant.intent).toBe('CRISIS');
    expect(assistant.refined_query).toBe('정제');
    expect(assistant.meta_json).toBe('{"k":1}');
    expect(Object.keys(assistant)).not.toContain('ai_message_id');
  });

  it('POST /strategy/rooms/:id/messages/stream → 200, no room_created, 4 messages, bumped', async () => {
    await new Promise((r) => setTimeout(r, 10)); // ensure last_chatted_at changes measurably
    const r = await rawRequest(
      'POST',
      `/strategy/rooms/${roomId}/messages/stream`,
      { message: '추가 질문입니다' },
      accessToken,
    );
    expect(r.status).toBe(200);

    const events = parseSse(r.text).map((f) => f.event);
    expect(events).not.toContain('room_created');
    expect(events).toEqual(['intent_classified', 'content_chunk', 'content_chunk', 'meta', 'done']);

    const cnt = await dataSource.query(
      'SELECT COUNT(*)::int AS c FROM strategy_chat_messages WHERE room_id = $1',
      [roomId],
    );
    expect(cnt[0].c).toBe(4);

    const rows = await dataSource.query(
      'SELECT last_chatted_at FROM strategy_chat_rooms WHERE id = $1',
      [roomId],
    );
    expect(new Date(rows[0].last_chatted_at).getTime()).toBeGreaterThan(
      new Date(roomLastChattedBefore).getTime(),
    );
  });

  it('POST /strategy/rooms/:id/messages/stream on unknown room → 404 plain text (not SSE)', async () => {
    const res = await request(server)
      .post('/strategy/rooms/1/messages/stream')
      .set('Authorization', bearer())
      .send({ message: 'x' })
      .expect(404);
    expect(res.type).toBe('text/plain');
    expect(res.text).toBe('전략 채팅방을 찾을 수 없습니다.');
    expect(res.text).not.toContain('event:');
  });

  // ── refresh / logout ───────────────────────────────────────────────────────────

  it('POST /auth/refresh → 200 rotated pair; reusing the old token → 401 (CAS miss)', async () => {
    // No sleep needed: the `jti` nonce makes every minted token unique, so rotation always
    // produces a new hash even within the same wall-clock second.
    const rotated = await request(server)
      .post('/auth/refresh')
      .send({ refresh_token: refreshR1 })
      .expect(200);
    expect(rotated.body.access_token).toBeTruthy();
    expect(rotated.body.refresh_token).toBeTruthy();
    expect(rotated.body.refresh_token).not.toBe(refreshR1);

    const reuse = await request(server)
      .post('/auth/refresh')
      .send({ refresh_token: refreshR1 })
      .expect(401);
    expect(reuse.text).toBe('유효하지 않은 세션입니다.');
  });

  it('POST /auth/logout → 204; the access token is rejected immediately after', async () => {
    await request(server).post('/auth/logout').set('Authorization', bearer()).expect(204);

    const res = await request(server).get('/issues').set('Authorization', bearer()).expect(401);
    expect(res.text).toBe('');
  });

  it('re-login for the remaining authenticated tests', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    accessToken = res.body.access_token;
    expect(accessToken).toBeTruthy();
  });

  // ── crawler dedup ───────────────────────────────────────────────────────────────

  it('POST /internal/crawl/result (completed) → 202, dedup keys w/ TTL, single forward', async () => {
    const existing = await redisTest.keys('dedup:*');
    if (existing.length > 0) await redisTest.del(...existing);
    mocks.forward.requests.length = 0;

    const postUrl = 'http://example.com/post-1';
    const message = {
      jobId: 'crawl-job-1',
      timestamp: null,
      status: 'completed',
      site: 'dcinside',
      keyword: PROTECT_TARGET,
      results: [
        {
          title: 't',
          comment_count: 2,
          view_count: 0,
          recommend_count: 0,
          date: null,
          body: 'b',
          url: postUrl,
          comments: [
            { id: 101, parent_id: null, author: 'a1', date: '2024', content: 'c1', likes: 1, dislikes: 0 },
            { id: 102, parent_id: null, author: 'a2', date: '2024', content: 'c2', likes: 2, dislikes: 0 },
          ],
        },
      ],
    };

    await request(server).post('/internal/crawl/result').send(message).expect(202);

    const k1 = `dedup:101|${postUrl}`;
    const k2 = `dedup:102|${postUrl}`;
    expect(await redisTest.exists(k1)).toBe(1);
    expect(await redisTest.exists(k2)).toBe(1);

    const ttl = await redisTest.ttl(k1);
    expect(ttl).toBeGreaterThan(3500); // configured 1h = 3600s
    expect(ttl).toBeLessThanOrEqual(3600);

    expect(mocks.forward.requests.filter((r) => r.path === '/post.deduped')).toHaveLength(1);
    expect(mocks.forward.requests.filter((r) => r.path === '/comment.deduped')).toHaveLength(2);

    // Second identical delivery: everything is already known → forwards nothing new.
    await request(server).post('/internal/crawl/result').send(message).expect(202);
    expect(mocks.forward.requests.filter((r) => r.path === '/post.deduped')).toHaveLength(1);
    expect(mocks.forward.requests.filter((r) => r.path === '/comment.deduped')).toHaveLength(2);
  });

  // ── indexing completion ──────────────────────────────────────────────────────────

  it('POST /internal/crawl/result (all_done) → job COMPLETED; SSE waiter emits completed/done', async () => {
    const before = await dataSource.query(
      'SELECT status FROM indexing_jobs WHERE id = $1',
      [indexingJobId],
    );
    expect(before[0].status).not.toBe('COMPLETED');

    await request(server)
      .post('/internal/crawl/result')
      .send({ jobId: indexingJobId, status: 'all_done' })
      .expect(202);

    const after = await dataSource.query(
      'SELECT status FROM indexing_jobs WHERE id = $1',
      [indexingJobId],
    );
    expect(after[0].status).toBe('COMPLETED');

    const r = await rawRequest('GET', `/indexing/jobs/${indexingJobId}`, null, accessToken);
    expect(r.status).toBe(200);
    expect(r.text).toContain('event: completed');
    expect(r.text).toContain('data: done');
  });

  it('crawler unreachable at register → job FAILED; SSE waiter emits failed instead of hanging', async () => {
    await mocks.crawler.stop();

    const res = await request(server)
      .post('/auth/register')
      .send({
        email: 'crawler-down@example.com',
        password: PASSWORD,
        protect_target: '김철수',
        protect_target_info: 'info',
      })
      .expect(201);
    const failedJobId = res.body.indexing_job_id;

    // The dispatch is fire-and-forget, so the FAILED write lands after the response.
    let status = '';
    await waitFor(async () => {
      const rows = await dataSource.query('SELECT status FROM indexing_jobs WHERE id = $1', [
        failedJobId,
      ]);
      status = rows[0]?.status;
      return status === 'FAILED';
    });
    expect(status).toBe('FAILED');

    const r = await rawRequest('GET', `/indexing/jobs/${failedJobId}`, null, accessToken);
    expect(r.status).toBe(200);
    expect(r.text).toContain('event: failed');
    expect(r.text).toContain('data: dispatch_failed');
  });

  // ── failure paths (AI mocks stopped) ─────────────────────────────────────────────

  describe('failure paths (AI services unavailable)', () => {
    beforeAll(async () => {
      await Promise.all([
        mocks.audit.stop(),
        mocks.issue.stop(),
        mocks.reaction.stop(),
        mocks.strategy.stop(),
      ]);
      await new Promise((r) => setTimeout(r, 100));
    });

    it('POST /audit → 503', async () => {
      const res = await request(server)
        .post('/audit')
        .set('Authorization', bearer())
        .send({ text: 'x' })
        .expect(503);
      expect(res.text).toBe('입장문 검수 서버와 통신할 수 없습니다.');
    });

    it('GET /issues → 503', async () => {
      const res = await request(server).get('/issues').set('Authorization', bearer()).expect(503);
      expect(res.text).toBe('이슈 계통도 조회 서버와 통신할 수 없습니다.');
    });

    it('GET /news/:id → 503', async () => {
      const res = await request(server).get('/news/x').set('Authorization', bearer()).expect(503);
      expect(res.text).toBe('뉴스 조회 서버와 통신할 수 없습니다.');
    });

    it('POST /strategy/rooms → 200 stream containing an error frame', async () => {
      const r = await rawRequest(
        'POST',
        '/strategy/rooms',
        { message: '실패 시나리오 테스트 메시지' },
        accessToken,
      );
      expect(r.status).toBe(200);
      const frames = parseSse(r.text);
      const errorFrame = frames.find((f) => f.event === 'error');
      expect(errorFrame).toBeDefined();
      expect(JSON.parse(errorFrame!.data)).toEqual({ code: 'STRATEGY_AI_SERVICE_UNAVAILABLE' });
    });
  });
});
