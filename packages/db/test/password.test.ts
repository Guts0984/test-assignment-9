import { describe, expect, it } from 'vitest';
import { dummyHash, hashPassword, verifyPassword } from '../src/password';

describe('password hashing', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
    expect(await verifyPassword('CORRECT HORSE BATTERY STAPLE', h)).toBe(false);
  });
  it('uses a fresh salt every time and never stores the plaintext', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(a).not.toContain('same');
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });
  it('handles unicode, emoji and the 128-char maximum', async () => {
    for (const pw of ['пароль-Ґ-ї-є', '🔑🔑🔑', 'x'.repeat(128), 'with\u0000nul']) {
      const h = await hashPassword(pw);
      expect(await verifyPassword(pw, h)).toBe(true);
      expect(await verifyPassword(pw + 'a', h)).toBe(false);
    }
  });
  it('normalises unicode (NFKC) so visually equal passwords match', async () => {
    const h = await hashPassword('ﬁsh'); // ligature
    expect(await verifyPassword('fish', h)).toBe(true);
  });
  it('returns false (never throws) for malformed or hostile stored hashes', async () => {
    const good = await hashPassword('pw');
    const [, n, r, p, salt, hash] = good.split('$') as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const bad = [
      '',
      'scrypt',
      'plaintext',
      '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345', // bcrypt, not ours
      `scrypt$${n}$${r}$${p}$${salt}`, // missing part
      `scrypt$${n}$${r}$${p}$${salt}$${hash}$extra`,
      `scrypt$abc$${r}$${p}$${salt}$${hash}`,
      `scrypt$0$${r}$${p}$${salt}$${hash}`,
      `scrypt$-16$${r}$${p}$${salt}$${hash}`,
      `scrypt$1000$${r}$${p}$${salt}$${hash}`, // not a power of two
      `scrypt$${2 ** 30}$${r}$${p}$${salt}$${hash}`, // would allocate gigabytes
      `scrypt$${n}$9999$${p}$${salt}$${hash}`,
      `scrypt$${n}$${r}$9999$${salt}$${hash}`,
      `scrypt$${n}$${r}$${p}$$${hash}`, // empty salt
      `scrypt$${n}$${r}$${p}$${salt}$`, // empty hash
      'scrypt$1; drop table users;--$1$1$a$b',
    ];
    for (const stored of bad) {
      await expect(verifyPassword('pw', stored)).resolves.toBe(false);
    }
  });
  it('a tampered hash does not verify', async () => {
    const h = await hashPassword('pw');
    const parts = h.split('$');
    const flipped = Buffer.from(parts[5]!, 'base64');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    parts[5] = flipped.toString('base64');
    expect(await verifyPassword('pw', parts.join('$'))).toBe(false);
  });
  it('dummyHash exists so unknown users cost the same as known ones', async () => {
    const h = await dummyHash;
    expect(await verifyPassword('anything', h)).toBe(false);
  });
});
