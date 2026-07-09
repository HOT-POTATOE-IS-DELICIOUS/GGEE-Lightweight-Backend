import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { ProtectService } from '../protect/protect.service';
import { AuditRepository } from './repositories/audit.repository';
import { AuditEntity } from './entities/audit.entity';
import { AuditService } from './audit.service';

const config = {
  getOrThrow: (key: string) =>
    ((
      { 'ai.audit.baseUrl': 'http://audit', 'ai.audit.timeoutMs': 2000 } as Record<
        string,
        unknown
      >
    )[key]),
} as unknown as ConfigService;

const protect = {
  getByUserId: jest.fn().mockResolvedValue({
    id: '1',
    userId: '1',
    target: '백종원',
    info: '요리연구가',
  }),
} as unknown as ProtectService;

const snowflake = {
  generateId: jest.fn().mockReturnValue('7777'),
} as unknown as SnowflakeService;

const fullAiReview = {
  sentence: { sentence_text: '문장', start_offset: 3, end_offset: 9 },
  perspective_ids: ['p1'],
  perspective_labels: ['label'],
  suggestions: [
    { start_index: 1, end_index: 2, before: 'b', after: 'a', reason: 'r' },
  ],
};

describe('AuditService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts {entity_name, entity_info, text} to {baseUrl}/audit with the configured timeout', async () => {
    const postJson = jest.fn().mockResolvedValue({ reviews: [] });
    const http = { postJson } as unknown as AiHttpClient;
    const audits = { save: jest.fn() } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    await service.audit('42', '입시 자기소개서');

    expect(postJson).toHaveBeenCalledWith(
      'http://audit/audit',
      { entity_name: '백종원', entity_info: '요리연구가', text: '입시 자기소개서' },
      2000,
    );
  });

  it('coalesces null review fields to empty arrays and zero offsets', async () => {
    const postJson = jest.fn().mockResolvedValue({
      reviews: [
        {
          sentence: { sentence_text: null, start_offset: null, end_offset: null },
          perspective_ids: null,
          perspective_labels: null,
          suggestions: [{ start_index: null, end_index: null, before: null, after: null, reason: null }],
        },
      ],
    });
    const http = { postJson } as unknown as AiHttpClient;
    const audits = { save: jest.fn() } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    const result = await service.audit('42', 't');
    const review = result.reviews[0];
    expect(review.perspective_ids).toEqual([]);
    expect(review.perspective_labels).toEqual([]);
    expect(review.sentence.start_offset).toBe(0);
    expect(review.sentence.end_offset).toBe(0);
    expect(review.suggestions[0].start_index).toBe(0);
    expect(review.suggestions[0].end_index).toBe(0);
  });

  it('coalesces null suggestions list to an empty array', async () => {
    const postJson = jest.fn().mockResolvedValue({
      reviews: [
        {
          sentence: { sentence_text: 's', start_offset: 0, end_offset: 0 },
          perspective_ids: [],
          perspective_labels: [],
          suggestions: null,
        },
      ],
    });
    const http = { postJson } as unknown as AiHttpClient;
    const audits = { save: jest.fn() } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    const result = await service.audit('42', 't');
    expect(result.reviews[0].suggestions).toEqual([]);
  });

  it('returns the snowflake id as the audit_id string', async () => {
    const postJson = jest.fn().mockResolvedValue({ reviews: [] });
    const http = { postJson } as unknown as AiHttpClient;
    const audits = { save: jest.fn() } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    const result = await service.audit('42', 't');
    expect(result.audit_id).toBe('7777');
    expect(typeof result.audit_id).toBe('string');
  });

  it('persists reviews_json as a camelCase JSON string (no snake_case keys)', async () => {
    const postJson = jest.fn().mockResolvedValue({ reviews: [fullAiReview] });
    const http = { postJson } as unknown as AiHttpClient;
    const save = jest.fn();
    const audits = { save } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    await service.audit('42', 'text-body');

    const entity = save.mock.calls[0][0] as AuditEntity;
    expect(entity.reviewsJson).not.toContain('sentence_text');
    const parsed = JSON.parse(entity.reviewsJson);
    expect(parsed).toEqual([
      {
        sentence: { sentenceText: '문장', startOffset: 3, endOffset: 9 },
        perspectiveIds: ['p1'],
        perspectiveLabels: ['label'],
        suggestions: [{ startIndex: 1, endIndex: 2, before: 'b', after: 'a', reason: 'r' }],
      },
    ]);
  });

  it('persists the user id, protect target/info and text on the entity', async () => {
    const postJson = jest.fn().mockResolvedValue({ reviews: [] });
    const http = { postJson } as unknown as AiHttpClient;
    const save = jest.fn();
    const audits = { save } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    await service.audit('42', 'text-body');

    const entity = save.mock.calls[0][0] as AuditEntity;
    expect(entity.userId).toBe('42');
    expect(entity.protectTarget).toBe('백종원');
    expect(entity.protectTargetInfo).toBe('요리연구가');
    expect(entity.text).toBe('text-body');
  });

  it('maps AiHttpError to AUDIT_SERVICE_UNAVAILABLE and persists nothing', async () => {
    const postJson = jest.fn().mockRejectedValue(new AiHttpError('boom'));
    const http = { postJson } as unknown as AiHttpClient;
    const save = jest.fn();
    const audits = { save } as unknown as AuditRepository;
    const service = new AuditService(protect, http, snowflake, audits, config);

    await expect(service.audit('42', 't')).rejects.toThrow(
      expect.objectContaining({ code: 'AUDIT_SERVICE_UNAVAILABLE' }),
    );
    expect(save).not.toHaveBeenCalled();
  });
});
