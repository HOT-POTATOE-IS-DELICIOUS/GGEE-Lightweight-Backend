import { RefreshTokenHasher } from './refresh-token.hasher';

describe('RefreshTokenHasher', () => {
  const hasher = new RefreshTokenHasher();

  it('produces a 64-char lowercase-hex SHA-256 digest', () => {
    const digest = hasher.hash('some-refresh-token');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known SHA-256 vector for "abc"', () => {
    expect(hasher.hash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic: the same input yields the same digest', () => {
    expect(hasher.hash('repeat-me')).toBe(hasher.hash('repeat-me'));
  });

  it('yields different digests for different inputs', () => {
    expect(hasher.hash('token-a')).not.toBe(hasher.hash('token-b'));
  });
});
