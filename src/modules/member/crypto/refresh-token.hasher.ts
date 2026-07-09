import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Port of `RefreshTokenHasherAdapter`: unsalted SHA-256, hex-encoded (64 chars).
 * Deterministic — enables the compare-and-swap lookup on refresh.
 */
@Injectable()
export class RefreshTokenHasher {
  hash(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
}
