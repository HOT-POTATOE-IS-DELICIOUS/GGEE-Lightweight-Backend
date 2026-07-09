import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../error/business.exception';
import { SnowflakeService } from './snowflake.service';

const EPOCH = 1767225600000n; // 2026-01-01T00:00:00Z
const configWithWorker = (workerId: number): ConfigService =>
  ({ get: () => workerId }) as unknown as ConfigService;

describe('SnowflakeService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a worker id outside 0..31', () => {
    expect(() => new SnowflakeService(configWithWorker(32))).toThrow(BusinessException);
    expect(() => new SnowflakeService(configWithWorker(-1))).toThrow(BusinessException);
    expect(() => new SnowflakeService(configWithWorker(0))).not.toThrow();
    expect(() => new SnowflakeService(configWithWorker(31))).not.toThrow();
  });

  it('returns a decimal string (ids exceed Number.MAX_SAFE_INTEGER over time)', () => {
    const id = new SnowflakeService(configWithWorker(1)).generateId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^\d+$/);
  });

  it('packs timestamp, worker id and sequence per the original bit layout', () => {
    const now = Number(EPOCH) + 5_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const id = BigInt(new SnowflakeService(configWithWorker(7)).generateId());

    expect(id >> 17n).toBe(5000n); // timestamp delta from the custom epoch
    expect((id >> 12n) & 0x1fn).toBe(7n); // 5 worker bits
    expect(id & 0xfffn).toBe(0n); // 12 sequence bits, first id in the ms
  });

  it('increments the sequence within the same millisecond', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Number(EPOCH) + 1);
    const snowflake = new SnowflakeService(configWithWorker(1));

    const first = BigInt(snowflake.generateId());
    const second = BigInt(snowflake.generateId());

    expect(second - first).toBe(1n);
    expect(second & 0xfffn).toBe(1n);
  });

  it('produces strictly increasing, unique ids', () => {
    const snowflake = new SnowflakeService(configWithWorker(1));
    const ids = Array.from({ length: 5000 }, () => BigInt(snowflake.generateId()));

    expect(new Set(ids.map(String)).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it('throws when the clock moves backwards', () => {
    const snowflake = new SnowflakeService(configWithWorker(1));
    jest.spyOn(Date, 'now').mockReturnValue(Number(EPOCH) + 1000);
    snowflake.generateId();

    jest.spyOn(Date, 'now').mockReturnValue(Number(EPOCH) + 999);
    expect(() => snowflake.generateId()).toThrow(
      expect.objectContaining({ code: 'CLOCK_MOVED_BACKWARDS' }),
    );
  });

  it('waits for the next millisecond when the sequence overflows', () => {
    const snowflake = new SnowflakeService(configWithWorker(1));
    const base = Number(EPOCH) + 10;
    // 4096 ids exhaust the 12-bit sequence; the 4097th must roll into the next ms.
    const spy = jest.spyOn(Date, 'now').mockReturnValue(base);
    for (let i = 0; i < 4096; i++) snowflake.generateId();

    spy.mockReturnValue(base + 1);
    const rolled = BigInt(snowflake.generateId());

    expect(rolled >> 17n).toBe(BigInt(base) - EPOCH + 1n);
    expect(rolled & 0xfffn).toBe(0n);
  });
});
