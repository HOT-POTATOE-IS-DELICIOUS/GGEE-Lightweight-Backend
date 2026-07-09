import { PasswordHasher } from './password.hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('returns a bcrypt hash with cost factor 10', async () => {
    const hashed = await hasher.hash('pw12345');
    expect(hashed).toMatch(/^\$2[aby]\$10\$/);
  }, 15_000);

  it('produces a different hash each call (random salt)', async () => {
    const [a, b] = await Promise.all([hasher.hash('pw12345'), hasher.hash('pw12345')]);
    expect(a).not.toBe(b);
  }, 15_000);

  it('matches returns true for the correct password', async () => {
    const hashed = await hasher.hash('pw12345');
    expect(await hasher.matches('pw12345', hashed)).toBe(true);
  }, 15_000);

  it('matches returns false for a wrong password', async () => {
    const hashed = await hasher.hash('pw12345');
    expect(await hasher.matches('wrong-pw', hashed)).toBe(false);
  }, 15_000);
});
