import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AiHttpClient } from '../../common/http/ai-http.client';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { ProtectService } from '../protect/protect.service';
import {
  CrawlPostMessage,
  CrawlResultMessage,
  DeduplicatedCommentMessage,
  DeduplicatedPostMessage,
} from './crawler.types';

/**
 * Port of the Kafka-Streams comment-dedup topology (`CommentDeduplicationProcessor`) using Redis.
 *
 * Dedup key      : `dedup:{commentId}|{postUrl}`
 * Sliding TTL    : `GGEE_CRAWLER_DEDUP_TTL` seconds — every sighting refreshes the expiry, so
 *                  Redis native key-expiry replaces both the `< cutoff` check and the original
 *                  cleanup punctuator. A comment is NEW iff its key did not already exist.
 *
 * Also drives indexing-job completion: a result with status `all_done` marks the job COMPLETED
 * (was the `crawl.community.result` -> completion-events stream).
 */
@Injectable()
export class CrawlerDedupService {
  private readonly logger = new Logger(CrawlerDedupService.name);
  private readonly ttlSeconds: number;
  private readonly forwardUrl: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly snowflake: SnowflakeService,
    private readonly http: AiHttpClient,
    private readonly protect: ProtectService,
    config: ConfigService,
  ) {
    this.ttlSeconds = config.getOrThrow<number>('crawler.dedupTtlSeconds');
    this.forwardUrl = config.getOrThrow<string>('crawler.dedupForwardUrl');
  }

  async handleCrawlResult(message: CrawlResultMessage): Promise<void> {
    const status = message.status?.toLowerCase();

    // Completion signal: mark the indexing job COMPLETED.
    if (status === 'all_done' && message.jobId) {
      await this.protect.markJobCompleted(String(message.jobId));
    }

    // Dedup only processes fully-crawled results.
    if (status !== 'completed' || !message.results) {
      return;
    }

    const eventTimestampMs = this.parseTimestampMs(message.timestamp);
    const crawledAt = this.parseCrawledAt(message.timestamp, eventTimestampMs);

    for (const post of message.results) {
      await this.processPost(post, message, eventTimestampMs, crawledAt);
    }
  }

  private async processPost(
    post: CrawlPostMessage,
    message: CrawlResultMessage,
    eventTimestampMs: number,
    crawledAt: string,
  ): Promise<void> {
    const url = post.url?.trim();
    if (!url || !post.comments || post.comments.length === 0) {
      return;
    }

    const newComments = await this.filterNewComments(post, url);
    if (newComments.length === 0) {
      return;
    }

    const postId = this.snowflake.generateId();

    const postMessage: DeduplicatedPostMessage = {
      post_id: postId,
      site: message.site,
      keyword: message.keyword,
      crawled_at: crawledAt,
      event_timestamp_ms: eventTimestampMs,
      post_url: url,
      post_title: post.title ?? null,
    };
    const commentMessages: DeduplicatedCommentMessage[] = newComments.map((c) => ({
      post_id: postId,
      id: c.id,
      parent_id: c.parent_id,
      author: c.author,
      date: c.date,
      content: c.content,
      likes: c.likes,
      dislikes: c.dislikes,
    }));

    await this.forward(postMessage, commentMessages);
  }

  private async filterNewComments(post: CrawlPostMessage, postUrl: string) {
    const result = [];
    for (const comment of post.comments ?? []) {
      if (!comment || comment.id === null || comment.id === undefined) continue;
      const key = `dedup:${comment.id}|${postUrl}`;
      // SET the sliding TTL unconditionally; NEW iff the key did not exist before.
      const existed = await this.redis.exists(key);
      await this.redis.set(key, Date.now().toString(), 'EX', this.ttlSeconds);
      if (existed === 0) {
        result.push(comment);
      }
    }
    return result;
  }

  private async forward(
    post: DeduplicatedPostMessage,
    comments: DeduplicatedCommentMessage[],
  ): Promise<void> {
    if (!this.forwardUrl) {
      this.logger.log(
        `Deduped post ${post.post_id} with ${comments.length} new comment(s) (no forward URL configured)`,
      );
      return;
    }
    try {
      await this.http.postJson(`${this.forwardUrl}/post.deduped`, post, this.crawlerTimeoutMs);
      for (const comment of comments) {
        await this.http.postJson(
          `${this.forwardUrl}/comment.deduped`,
          comment,
          this.crawlerTimeoutMs,
        );
      }
    } catch (err) {
      this.logger.warn(`Forward failed for post ${post.post_id}: ${String(err)}`);
    }
  }

  private readonly crawlerTimeoutMs = 10_000;

  private parseTimestampMs(timestamp: string | null): number {
    if (timestamp) {
      const ms = Date.parse(timestamp);
      if (!Number.isNaN(ms)) return ms;
    }
    return Date.now();
  }

  private parseCrawledAt(timestamp: string | null, fallbackMs: number): string {
    if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
      return timestamp;
    }
    return new Date(fallbackMs).toISOString();
  }
}
