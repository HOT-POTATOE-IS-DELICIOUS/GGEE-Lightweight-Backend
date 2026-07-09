import { Injectable, Logger } from '@nestjs/common';
import { createParser, type EventSourceMessage } from 'eventsource-parser';

export interface SseEvent {
  /** SSE `event:` name (defaults to 'message' when the upstream omits it). */
  event: string;
  /** SSE `data:` payload (raw string, typically JSON). */
  data: string;
}

/** Thrown when an AI HTTP call errors, times out, or returns a non-2xx status. */
export class AiHttpError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiHttpError';
  }
}

/**
 * Shared outbound HTTP helper for the external AI services, replacing Spring's WebClient.
 *
 *  - getJson / postJson    : one-shot JSON with a total timeout (AbortSignal.timeout).
 *  - streamSse             : consumes an upstream `text/event-stream`, yielding {event,data}
 *                            with an *idle* timeout (mirrors WebClient `.timeout(...)` on a Flux:
 *                            error if no event arrives within the window) so long streams are
 *                            not killed by a socket read timeout.
 *
 * Callers map AiHttpError to the appropriate `*_SERVICE_UNAVAILABLE` BusinessException.
 */
@Injectable()
export class AiHttpClient {
  private readonly logger = new Logger(AiHttpClient.name);

  async getJson<T>(url: string, timeoutMs: number): Promise<T> {
    return this.requestJson<T>('GET', url, undefined, timeoutMs);
  }

  async postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
    return this.requestJson<T>('POST', url, body, timeoutMs);
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new AiHttpError(`${method} ${url} -> HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AiHttpError) throw err;
      this.logger.warn(`AI call failed: ${method} ${url}: ${String(err)}`);
      throw new AiHttpError(`${method} ${url} failed`, err);
    }
  }

  /**
   * POST a JSON body and consume the upstream SSE response, yielding each event.
   * `idleTimeoutMs` aborts the stream if no event is received within the window.
   */
  async *streamSse(url: string, body: unknown, idleTimeoutMs: number): AsyncGenerator<SseEvent> {
    const controller = new AbortController();
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    };

    let res: Response;
    try {
      resetIdle();
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (idleTimer) clearTimeout(idleTimer);
      this.logger.warn(`AI stream connect failed: POST ${url}: ${String(err)}`);
      throw new AiHttpError(`POST ${url} stream failed`, err);
    }

    if (!res.ok || !res.body) {
      if (idleTimer) clearTimeout(idleTimer);
      throw new AiHttpError(`POST ${url} stream -> HTTP ${res.status}`);
    }

    const queue: SseEvent[] = [];
    const parser = createParser({
      onEvent: (msg: EventSourceMessage) => {
        queue.push({ event: msg.event ?? 'message', data: msg.data });
      },
    });

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        parser.feed(decoder.decode(value, { stream: true }));
        while (queue.length > 0) {
          yield queue.shift() as SseEvent;
        }
      }
      while (queue.length > 0) {
        yield queue.shift() as SseEvent;
      }
    } catch (err) {
      this.logger.warn(`AI stream read failed: POST ${url}: ${String(err)}`);
      throw new AiHttpError(`POST ${url} stream read failed`, err);
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      reader.releaseLock();
    }
  }
}
