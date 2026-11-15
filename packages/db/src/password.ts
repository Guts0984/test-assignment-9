import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * scrypt password hashing (node:crypto, no native dependencies).
 * Stored format: `scrypt$N$r$p$saltBase64$hashBase64` so parameters can change without breaking old hashes.
 */
const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LEN = 32;
const SALT_LEN = 16;
// Parameters read from a stored hash are bounded so a corrupted row can't make us allocate GBs.
const MAX_N = 1 << 17;
const MAX_R = 16;
const MAX_P = 4;

const derive = (
  password: string,
  salt: Buffer,
  keyLen: number,
  opts: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLen, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

const options = (N: number, r: number, p: number): ScryptOptions => ({
  N,
  r,
  p,
  maxmem: 256 * N * r,
});

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, KEY_LEN, options(PARAMS.N, PARAMS.r, PARAMS.p));
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
};

/** A throwaway hash used to spend the same time when the user does not exist (no timing oracle). */
export const dummyHash = hashPassword('dummy-password-for-timing');

/** Returns false (never throws) for malformed or hostile stored hashes. */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const validParams =
    Number.isInteger(N) &&
    Number.isInteger(r) &&
    Number.isInteger(p) &&
    N >= 2 &&
    (N & (N - 1)) === 0 &&
    N <= MAX_N &&
    r >= 1 &&
    r <= MAX_R &&
    p >= 1 &&
    p <= MAX_P;
  if (!validParams) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await derive(password, salt, expected.length, options(N, r, p));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};
