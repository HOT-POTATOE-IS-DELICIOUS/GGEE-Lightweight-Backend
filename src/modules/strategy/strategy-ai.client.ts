import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError, SseEvent } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';

/**
 * Client for the strategy AI service SSE endpoint. Relays the upstream event stream
 * verbatim. Upstream event vocabulary:
 *   - intent_classified : {intent, refined_query}
 *   - content_chunk     : {delta}
 *   - meta              : arbitrary JSON object (kept as a raw string)
 *   - done              : {message_id}
 *
 * AiHttpError (connect/read failure, timeout, non-2xx) maps to STRATEGY_AI_SERVICE_UNAVAILABLE.
 */
@Injectable()
export class StrategyAiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: AiHttpClient,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('ai.strategy.baseUrl');
    this.timeoutMs = config.getOrThrow<number>('ai.strategy.timeoutMs');
  }

  async *stream(message: string, entityName: string, entityInfo: string): AsyncGenerator<SseEvent> {
    try {
      yield* this.http.streamSse(
        `${this.baseUrl}/strategy/stream`,
        { message, entity_name: entityName, entity_info: entityInfo },
        this.timeoutMs,
      );
    } catch (err) {
      if (err instanceof AiHttpError) {
        throw new BusinessException('STRATEGY_AI_SERVICE_UNAVAILABLE');
      }
      throw err;
    }
  }
}
