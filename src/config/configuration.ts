/**
 * Typed application configuration loaded from environment variables.
 * Mirrors the original Spring `application.yaml` surface, minus Kafka/schema-registry.
 */

/** Parse a Spring-style duration ("30s", "10s", "1h", "500ms") or bare number(ms) into milliseconds. */
export function parseDurationMs(raw: string | undefined, fallbackMs: number): number {
  if (!raw) return fallbackMs;
  const trimmed = raw.trim();
  const match = /^(\d+)\s*(ms|s|m|h)?$/.exec(trimmed);
  if (!match) return fallbackMs;
  const value = Number(match[1]);
  switch (match[2]) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    default:
      return value; // bare number == milliseconds
  }
}

/**
 * Parse a duration into whole seconds (used for the Redis dedup TTL).
 * A bare number is read as SECONDS here (this setting is seconds-valued) — unlike
 * parseDurationMs, where a bare number is milliseconds. Units ("1h", "10m") are honoured.
 */
export function parseDurationSeconds(raw: string | undefined, fallbackSeconds: number): number {
  if (!raw) return fallbackSeconds;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : fallbackSeconds;
  }
  return Math.max(1, Math.round(parseDurationMs(trimmed, fallbackSeconds * 1000) / 1000));
}

function splitCsv(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw === null || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface AiClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface AppConfig {
  server: { port: number };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  redis: { host: string; port: number };
  cors: {
    pathPattern: string;
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    allowCredentials: boolean;
    maxAge: number;
  };
  jwt: {
    accessTokenActiveTimeMs: number;
    refreshTokenActiveTimeMs: number;
    header: string;
    prefix: string;
    secretKeyBase64: string;
  };
  snowflake: { workerId: number };
  ai: {
    audit: AiClientConfig;
    issue: AiClientConfig;
    reaction: AiClientConfig;
    strategy: AiClientConfig;
  };
  crawler: {
    baseUrl: string;
    dedupTtlSeconds: number;
    dedupForwardUrl: string;
  };
  newsCrawler: AiClientConfig;
}

export default (): AppConfig => ({
  server: {
    port: Number(process.env.SERVER_PORT ?? 8080),
  },
  database: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USERNAME ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? 'password',
    database: process.env.DATABASE_NAME ?? 'ggee',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  cors: {
    pathPattern: process.env.CORS_PATH_PATTERN ?? '/**',
    allowedOrigins: splitCsv(process.env.CORS_ALLOWED_ORIGINS, ['http://localhost:3000']),
    allowedMethods: splitCsv(process.env.CORS_ALLOWED_METHODS, [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ]),
    allowedHeaders: splitCsv(process.env.CORS_ALLOWED_HEADERS, ['*']),
    allowCredentials: (process.env.CORS_ALLOW_CREDENTIALS ?? 'true') === 'true',
    maxAge: Number(process.env.CORS_MAX_AGE ?? 3600),
  },
  jwt: {
    accessTokenActiveTimeMs: Number(process.env.JWT_ACCESS_TOKEN_ACTIVE_TIME ?? 3_600_000),
    refreshTokenActiveTimeMs: Number(process.env.JWT_REFRESH_TOKEN_ACTIVE_TIME ?? 1_209_600_000),
    header: process.env.JWT_HEADER ?? 'Authorization',
    prefix: process.env.JWT_PREFIX ?? 'Bearer',
    secretKeyBase64: process.env.JWT_SECRET_KEY ?? '',
  },
  snowflake: {
    workerId: Number(process.env.SNOWFLAKE_WORKER_ID ?? 1),
  },
  ai: {
    audit: {
      baseUrl: process.env.GGEE_AI_AUDIT_BASE_URL ?? 'http://localhost:9001',
      timeoutMs: parseDurationMs(process.env.GGEE_AI_AUDIT_TIMEOUT, 10_000),
    },
    issue: {
      baseUrl: process.env.GGEE_AI_ISSUE_BASE_URL ?? 'http://localhost:9002',
      timeoutMs: parseDurationMs(process.env.GGEE_AI_ISSUE_TIMEOUT, 10_000),
    },
    reaction: {
      baseUrl: process.env.GGEE_AI_REACTION_BASE_URL ?? 'http://localhost:9003',
      timeoutMs: parseDurationMs(process.env.GGEE_AI_REACTION_TIMEOUT, 10_000),
    },
    strategy: {
      baseUrl: process.env.GGEE_AI_STRATEGY_BASE_URL ?? 'http://localhost:9004',
      timeoutMs: parseDurationMs(process.env.GGEE_AI_STRATEGY_TIMEOUT, 30_000),
    },
  },
  crawler: {
    baseUrl: process.env.CRAWLER_BASE_URL ?? 'http://localhost:9005',
    dedupTtlSeconds: parseDurationSeconds(process.env.GGEE_CRAWLER_DEDUP_TTL, 3600),
    dedupForwardUrl: process.env.CRAWLER_DEDUP_FORWARD_URL ?? '',
  },
  newsCrawler: {
    baseUrl: process.env.NEWS_CRAWLER_BASE_URL ?? 'http://localhost:4000',
    timeoutMs: parseDurationMs(process.env.NEWS_CRAWLER_TIMEOUT, 10_000),
  },
});
