/**
 * Internal crawler message contracts (formerly Kafka topics). Field names mirror the original
 * Java DTOs (`CrawlResultMessage` / `CrawlPostMessage` / `CrawlCommentMessage`).
 */

export interface CrawlCommentMessage {
  id: number | null;
  parent_id: number | null;
  author: string | null;
  date: string | null;
  content: string | null;
  likes: string | number | null;
  dislikes: string | number | null;
}

export interface CrawlPostMessage {
  title: string | null;
  comment_count: number | null;
  view_count: number | null;
  recommend_count: number | null;
  date: string | null;
  body: string | null;
  comments: CrawlCommentMessage[] | null;
  url: string | null;
}

export interface CrawlResultMessage {
  jobId: string;
  timestamp: string | null;
  status: string | null;
  site: string | null;
  keyword: string | null;
  results: CrawlPostMessage[] | null;
}

/** Output: forwarded to the downstream (was `crawl.community.post.deduped`). */
export interface DeduplicatedPostMessage {
  post_id: string;
  site: string | null;
  keyword: string | null;
  crawled_at: string;
  event_timestamp_ms: number;
  post_url: string;
  post_title: string | null;
}

/** Output: one per new comment (was `crawl.community.comment.deduped`). */
export interface DeduplicatedCommentMessage {
  post_id: string;
  id: number | null;
  parent_id: number | null;
  author: string | null;
  date: string | null;
  content: string | null;
  likes: string | number | null;
  dislikes: string | number | null;
}
