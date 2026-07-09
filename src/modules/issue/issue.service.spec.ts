import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { ProtectService } from '../protect/protect.service';
import { IssueService } from './issue.service';

const config = {
  getOrThrow: (key: string) =>
    ((
      { 'ai.issue.baseUrl': 'http://issue', 'ai.issue.timeoutMs': 1000 } as Record<
        string,
        unknown
      >
    )[key]),
} as unknown as ConfigService;

const makeProtect = (over: Partial<{ info: string | null }> = {}) =>
  ({
    getByUserId: jest.fn().mockResolvedValue({
      id: '1',
      userId: '1',
      target: '백종원',
      info: '요리연구가',
      ...over,
    }),
  }) as unknown as ProtectService;

const emptyAiResponse = {
  entity_name: '백종원',
  issues: [],
  connections: [],
};

describe('IssueService', () => {
  it('URL-encodes the entity name and appends entity_info when info is present', async () => {
    const getJson = jest.fn().mockResolvedValue(emptyAiResponse);
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    await service.getIssues('1');

    expect(getJson).toHaveBeenCalledWith(
      'http://issue/issues?entity_name=%EB%B0%B1%EC%A2%85%EC%9B%90&entity_info=%EC%9A%94%EB%A6%AC%EC%97%B0%EA%B5%AC%EA%B0%80',
      1000,
    );
  });

  it('omits entity_info when info is whitespace-only', async () => {
    const getJson = jest.fn().mockResolvedValue(emptyAiResponse);
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect({ info: '   ' }), http, config);

    await service.getIssues('1');

    const url = getJson.mock.calls[0][0] as string;
    expect(url).toBe('http://issue/issues?entity_name=%EB%B0%B1%EC%A2%85%EC%9B%90');
    expect(url).not.toContain('entity_info');
  });

  it('omits entity_info when info is null', async () => {
    const getJson = jest.fn().mockResolvedValue(emptyAiResponse);
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect({ info: null }), http, config);

    await service.getIssues('1');

    expect(getJson.mock.calls[0][0]).not.toContain('entity_info');
  });

  it('falls back to the requested target when the AI entity_name is null', async () => {
    const getJson = jest
      .fn()
      .mockResolvedValue({ entity_name: null, issues: [], connections: [] });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    const result = await service.getIssues('1');
    expect(result.protect_target).toBe('백종원');
  });

  it('coalesces null issues and connections to empty arrays', async () => {
    const getJson = jest
      .fn()
      .mockResolvedValue({ entity_name: 'x', issues: null, connections: null });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    const result = await service.getIssues('1');
    expect(result.issues).toEqual([]);
    expect(result.connections).toEqual([]);
  });

  it('coalesces null numeric fields to 0 and null string fields to empty', async () => {
    const getJson = jest.fn().mockResolvedValue({
      entity_name: 'x',
      issues: [
        {
          id: null,
          title: null,
          summary: null,
          date: null,
          criticism: null,
          support: null,
          interest: null,
        },
      ],
      connections: [{ source_id: 'a', target_id: 'b', similarity: null }],
    });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    const result = await service.getIssues('1');
    expect(result.issues[0]).toEqual({
      id: '',
      title: '',
      summary: '',
      date: null,
      criticism: 0,
      support: 0,
      interest: 0,
    });
    expect(result.connections[0].similarity).toBe(0);
  });

  it('sorts issues by date ascending with nulls last (lexicographic)', async () => {
    const node = (id: string, date: string | null) => ({
      id,
      title: '',
      summary: '',
      date,
      criticism: 0,
      support: 0,
      interest: 0,
    });
    const getJson = jest.fn().mockResolvedValue({
      entity_name: 'x',
      issues: [
        node('n1', '2021-05-01'),
        node('n2', null),
        node('n3', '2020-01-01'),
        node('n4', '2021-01-01'),
      ],
      connections: [],
    });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    const result = await service.getIssues('1');
    expect(result.issues.map((i) => i.id)).toEqual(['n3', 'n4', 'n1', 'n2']);
  });

  it('normalizes edge direction to always point newest -> oldest', async () => {
    const node = (id: string, date: string | null) => ({
      id,
      title: '',
      summary: '',
      date,
      criticism: 0,
      support: 0,
      interest: 0,
    });
    const getJson = jest.fn().mockResolvedValue({
      entity_name: 'x',
      issues: [
        node('n1', '2020-01-01'),
        node('n2', '2021-01-01'),
        node('n3', null),
      ],
      connections: [
        // source older than target -> swapped
        { source_id: 'n1', target_id: 'n2', similarity: 1 },
        // already newest -> oldest -> unchanged
        { source_id: 'n2', target_id: 'n1', similarity: 2 },
        // unknown node id -> unchanged
        { source_id: 'x', target_id: 'n1', similarity: 3 },
        // null date on one endpoint -> unchanged
        { source_id: 'n1', target_id: 'n3', similarity: 4 },
      ],
    });
    const http = { getJson } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    const result = await service.getIssues('1');
    expect(result.connections).toEqual([
      { source_id: 'n2', target_id: 'n1', similarity: 1 },
      { source_id: 'n2', target_id: 'n1', similarity: 2 },
      { source_id: 'x', target_id: 'n1', similarity: 3 },
      { source_id: 'n1', target_id: 'n3', similarity: 4 },
    ]);
  });

  it('maps AiHttpError to ISSUE_GRAPH_SERVICE_UNAVAILABLE', async () => {
    const http = {
      getJson: jest.fn().mockRejectedValue(new AiHttpError('boom')),
    } as unknown as AiHttpClient;
    const service = new IssueService(makeProtect(), http, config);

    await expect(service.getIssues('1')).rejects.toThrow(
      expect.objectContaining({ code: 'ISSUE_GRAPH_SERVICE_UNAVAILABLE' }),
    );
  });

  it('propagates a PROTECT_NOT_FOUND from the protect service unchanged', async () => {
    const protect = {
      getByUserId: jest.fn().mockRejectedValue(new BusinessException('PROTECT_NOT_FOUND')),
    } as unknown as ProtectService;
    const http = { getJson: jest.fn() } as unknown as AiHttpClient;
    const service = new IssueService(protect, http, config);

    await expect(service.getIssues('1')).rejects.toThrow(
      expect.objectContaining({ code: 'PROTECT_NOT_FOUND' }),
    );
    expect((http as unknown as { getJson: jest.Mock }).getJson).not.toHaveBeenCalled();
  });
});
