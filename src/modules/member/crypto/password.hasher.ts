import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

/**
 * Port of `PasswordHasherAdapter` (Spring `BCryptPasswordEncoder`, default work factor 10).
 */
@Injectable()
export class PasswordHasher {
  private static readonly ROUNDS = 10;

  hash(rawPassword: string): Promise<string> {
    return bcrypt.hash(rawPassword, PasswordHasher.ROUNDS);
  }

  matches(rawPassword: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(rawPassword, hashed);
  }
}
