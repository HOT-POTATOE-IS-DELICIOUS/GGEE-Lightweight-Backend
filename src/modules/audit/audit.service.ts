import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { ProtectService } from '../protect/protect.service';
import { AuditEntity } from './entities/audit.entity';
import { AuditRepository } from './repositories/audit.repository';
import { AuditResponse, AuditReviewResponse } from './dto/audit.dto';

/** Raw (snake_case) shapes returned by the Audit AI service. */
interface AuditAiSentence {
  sentence_text: string | null;
  start_offset: number | null;
  end_offset: number | null;
}

interface AuditAiSuggestion {
  start_index: number | null;
  end_index: number | null;
  before: string | null;
  after: string | null;
  reason: string | null;
}

interface AuditAiReview {
  sentence: AuditAiSentence | null;
  perspective_ids: string[] | null;
  perspective_labels: string[] | null;
  suggestions: AuditAiSuggestion[] | null;
}

interface AuditAiResponse {
  reviews: AuditAiReview[] | null;
}

@Injectable()
export class AuditService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly protectService: ProtectService,
    private readonly http: AiHttpClient,
    private readonly snowflake: SnowflakeService,
    private readonly audits: AuditRepository,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('ai.audit.baseUrl');
    this.timeoutMs = config.getOrThrow<number>('ai.audit.timeoutMs');
  }

  async audit(userId: string, text: string): Promise<AuditResponse> {
    const protect = await this.protectService.getByUserId(userId);

    let aiResponse: AuditAiResponse;
    try {
      aiResponse = await this.http.postJson<AuditAiResponse>(
        `${this.baseUrl}/audit`,
        {
          entity_name: protect.target,
          entity_info: protect.info,
          text,
        },
        this.timeoutMs,
      );
    } catch (err) {
      if (err instanceof AiHttpError) {
        throw new BusinessException('AUDIT_SERVICE_UNAVAILABLE');
      }
      throw err;
    }

    const reviews = this.normalizeReviews(aiResponse);
    const auditId = this.snowflake.generateId();

    const entity = new AuditEntity();
    entity.id = auditId;
    entity.userId = userId;
    entity.protectTarget = protect.target;
    entity.protectTargetInfo = protect.info;
    entity.text = text;
    entity.reviewsJson = this.toReviewsJson(reviews);
    entity.deleted = false;
    entity.deletedAt = null;
    await this.audits.save(entity);

    return { audit_id: auditId, reviews };
  }

  private normalizeReviews(aiResponse: AuditAiResponse): AuditReviewResponse[] {
    const rawReviews = aiResponse.reviews ?? [];
    return rawReviews.map((review) => ({
      sentence: {
        sentence_text: review.sentence?.sentence_text ?? '',
        start_offset: review.sentence?.start_offset ?? 0,
        end_offset: review.sentence?.end_offset ?? 0,
      },
      perspective_ids: review.perspective_ids ?? [],
      perspective_labels: review.perspective_labels ?? [],
      suggestions: (review.suggestions ?? []).map((suggestion) => ({
        start_index: suggestion.start_index ?? 0,
        end_index: suggestion.end_index ?? 0,
        before: suggestion.before ?? '',
        after: suggestion.after ?? '',
        reason: suggestion.reason ?? '',
      })),
    }));
  }

  /** Serialize the (snake_case) reviews to a camelCase JSON string for storage. */
  private toReviewsJson(reviews: AuditReviewResponse[]): string {
    const camel = reviews.map((review) => ({
      sentence: {
        sentenceText: review.sentence.sentence_text,
        startOffset: review.sentence.start_offset,
        endOffset: review.sentence.end_offset,
      },
      perspectiveIds: review.perspective_ids,
      perspectiveLabels: review.perspective_labels,
      suggestions: review.suggestions.map((suggestion) => ({
        startIndex: suggestion.start_index,
        endIndex: suggestion.end_index,
        before: suggestion.before,
        after: suggestion.after,
        reason: suggestion.reason,
      })),
    }));
    return JSON.stringify(camel);
  }
}
