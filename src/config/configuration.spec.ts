import { parseDurationMs, parseDurationSeconds } from './configuration';

describe('parseDurationMs', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['10m', 600_000],
    ['1h', 3_600_000],
    ['7d', 604_800_000],
  ])('parses %s', (raw, expected) => {
    expect(parseDurationMs(raw, 1)).toBe(expected);
  });

  it('treats a bare number as milliseconds (Spring Duration compatible)', () => {
    expect(parseDurationMs('3600', 1)).toBe(3600);
  });

  it('falls back on undefined or unparseable input', () => {
    expect(parseDurationMs(undefined, 42)).toBe(42);
    expect(parseDurationMs('not-a-duration', 42)).toBe(42);
  });
});

describe('parseDurationSeconds', () => {
  // Regression: a bare `3600` once fell through parseDurationMs and became a 4-second TTL,
  // silently collapsing the crawler dedup window.
  it('treats a bare number as SECONDS', () => {
    expect(parseDurationSeconds('3600', 1)).toBe(3600);
  });

  it.each([
    ['1h', 3600],
    ['30m', 1800],
    ['45s', 45],
  ])('honours the unit %s', (raw, expected) => {
    expect(parseDurationSeconds(raw, 1)).toBe(expected);
  });

  it('never returns a sub-second TTL', () => {
    expect(parseDurationSeconds('10ms', 60)).toBe(1);
  });

  it('falls back on undefined or zero', () => {
    expect(parseDurationSeconds(undefined, 60)).toBe(60);
    expect(parseDurationSeconds('0', 60)).toBe(60);
  });
});
