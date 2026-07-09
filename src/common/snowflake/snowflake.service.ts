import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../error/business.exception';

/**
 * Port of `team.hotpotato.infrastructure.snowflake.Snowflake`.
 *
 * Layout (64-bit): ((now - EPOCH) << 17) | (workerId << 12) | seq
 *   - EPOCH      = 1767225600000 (2026-01-01T00:00:00Z)
 *   - worker id  = 5 bits (0..31)
 *   - sequence   = 12 bits (0..4095)
 *
 * IDs exceed Number.MAX_SAFE_INTEGER, so computation uses BigInt and the value is
 * returned as a decimal string. Node is single-threaded, so the original `synchronized`
 * mutex is naturally satisfied for the synchronous critical section below.
 */
@Injectable()
export class SnowflakeService {
  private static readonly EPOCH = 1767225600000n;
  private static readonly WORKER_BITS = 5n;
  private static readonly SEQ_BITS = 12n;
  private static readonly MAX_WORKER_ID = 31n;
  private static readonly SEQ_MASK = (1n << SnowflakeService.SEQ_BITS) - 1n; // 0xFFF
  private static readonly WORKER_SHIFT = SnowflakeService.SEQ_BITS; // 12
  private static readonly TIME_SHIFT = SnowflakeService.SEQ_BITS + SnowflakeService.WORKER_BITS; // 17

  private readonly logger = new Logger(SnowflakeService.name);
  private readonly workerId: bigint;
  private lastTime = -1n;
  private sequence = 0n;

  constructor(config: ConfigService) {
    const workerId = BigInt(config.get<number>('snowflake.workerId') ?? 1);
    if (workerId < 0n || workerId > SnowflakeService.MAX_WORKER_ID) {
      throw new BusinessException('INVALID_WORKER_ID');
    }
    this.workerId = workerId;
  }

  /** Generate the next id as a decimal string. */
  generateId(): string {
    return this.nextId().toString();
  }

  private nextId(): bigint {
    let now = BigInt(Date.now());

    if (now < this.lastTime) {
      throw new BusinessException('CLOCK_MOVED_BACKWARDS');
    }

    if (now === this.lastTime) {
      this.sequence = (this.sequence + 1n) & SnowflakeService.SEQ_MASK;
      if (this.sequence === 0n) {
        now = this.waitNextMillis(now);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTime = now;
    return (
      ((now - SnowflakeService.EPOCH) << SnowflakeService.TIME_SHIFT) |
      (this.workerId << SnowflakeService.WORKER_SHIFT) |
      this.sequence
    );
  }

  private waitNextMillis(now: bigint): bigint {
    let current = now;
    while (current <= this.lastTime) {
      current = BigInt(Date.now());
    }
    return current;
  }
}
