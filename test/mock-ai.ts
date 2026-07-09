import * as http from 'http';
import type { AddressInfo } from 'net';

/**
 * Lightweight stand-ins for the external AI / crawler services. Each mock is a real Node
 * http.Server bound to an ephemeral port (listen on 0), records every request it receives, and
 * can be stopped mid-suite to exercise the `*_SERVICE_UNAVAILABLE` failure paths.
 */

export interface RecordedRequest {
  method: string;
  /** Request path without the query string. */
  path: string;
  headers: http.IncomingHttpHeaders;
  /** Parsed JSON body when the payload was JSON, else the raw string (or '' for no body). */
  body: unknown;
}

export interface MockHandle {
  baseUrl: string;
  port: number;
  requests: RecordedRequest[];
  /** Close the server + all live (keep-alive) sockets so subsequent calls fail fast. */
  stop: () => Promise<void>;
}

type MockHandler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function startMock(handler: MockHandler): Promise<MockHandle> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      requests.push({
        method: req.method ?? '',
        path: (req.url ?? '').split('?')[0],
        headers: req.headers,
        body,
      });
      handler(req, res, body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        // Destroy live keep-alive sockets first so pooled undici connections error immediately.
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ── Canned upstream responses ────────────────────────────────────────────────

const AUDIT_RESPONSE = {
  reviews: [
    {
      sentence: { sentence_text: '문장', start_offset: 0, end_offset: 3 },
      perspective_ids: ['community'],
      perspective_labels: ['커뮤니티'],
      suggestions: [{ start_index: 0, end_index: 2, before: 'a', after: 'b', reason: 'r' }],
    },
    {
      sentence: { sentence_text: '둘', start_offset: null, end_offset: null },
      perspective_ids: null,
      perspective_labels: null,
      suggestions: null,
    },
  ],
};

const ISSUE_RESPONSE = {
  entity_name: null,
  issues: [
    { id: 'n2', title: 't2', summary: 's2', date: '2024-06-01', criticism: 5, support: 6, interest: 7 },
    {
      id: 'n1',
      title: 't1',
      summary: 's1',
      date: '2024-03-15',
      criticism: null,
      support: null,
      interest: null,
    },
    { id: 'n3', title: 't3', summary: 's3', date: null, criticism: 1, support: 2, interest: 3 },
  ],
  connections: [
    { source_id: 'n1', target_id: 'n2', similarity: null },
    { source_id: 'n2', target_id: 'n1', similarity: 0.8 },
  ],
};

const REACTION_RESPONSE = {
  node_id: 'IGNORED',
  count: 999,
  news: [
    { title: 't1', summary: 's1', link: 'l1' },
    { title: 't2', summary: 's2', link: 'l2' },
  ],
};

const STRATEGY_FRAMES =
  'event: intent_classified\ndata: {"intent":"CRISIS","refined_query":"정제"}\n\n' +
  'event: content_chunk\ndata: {"delta":"안녕"}\n\n' +
  'event: content_chunk\ndata: {"delta":"하세요"}\n\n' +
  'event: meta\ndata: {"k":1}\n\n' +
  'event: done\ndata: {"message_id":"ai-msg-001"}\n\n';

// ── Individual mock factories ────────────────────────────────────────────────

export function startAuditMock(): Promise<MockHandle> {
  return startMock((_req, res) => sendJson(res, 200, AUDIT_RESPONSE));
}

export function startIssueMock(): Promise<MockHandle> {
  return startMock((_req, res) => sendJson(res, 200, ISSUE_RESPONSE));
}

export function startReactionMock(): Promise<MockHandle> {
  return startMock((_req, res) => sendJson(res, 200, REACTION_RESPONSE));
}

export function startStrategyMock(): Promise<MockHandle> {
  return startMock((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(STRATEGY_FRAMES);
    res.end();
  });
}

export function startCrawlerMock(): Promise<MockHandle> {
  return startMock((_req, res) => sendJson(res, 200, { ok: true }));
}

export function startForwardMock(): Promise<MockHandle> {
  return startMock((_req, res) => sendJson(res, 200, { ok: true }));
}

// ── Bundle ───────────────────────────────────────────────────────────────────

export interface AiMocks {
  audit: MockHandle;
  issue: MockHandle;
  reaction: MockHandle;
  strategy: MockHandle;
  crawler: MockHandle;
  forward: MockHandle;
  stopAll: () => Promise<void>;
}

export async function startAiMocks(): Promise<AiMocks> {
  const [audit, issue, reaction, strategy, crawler, forward] = await Promise.all([
    startAuditMock(),
    startIssueMock(),
    startReactionMock(),
    startStrategyMock(),
    startCrawlerMock(),
    startForwardMock(),
  ]);

  return {
    audit,
    issue,
    reaction,
    strategy,
    crawler,
    forward,
    stopAll: async () => {
      await Promise.all([
        audit.stop(),
        issue.stop(),
        reaction.stop(),
        strategy.stop(),
        crawler.stop(),
        forward.stop(),
      ]);
    },
  };
}
