/** Deterministic PRNG (mulberry32) so every seed run produces the same data. Not for security. */
export type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  chance: (p: number) => boolean;
  shuffle: <T>(xs: readonly T[]) => T[];
  uuid: () => string;
};

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => {
    const x = xs[int(0, xs.length - 1)];
    if (x === undefined) throw new Error('pick from empty array');
    return x;
  };
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  const hex = (n: number): string =>
    Array.from({ length: n }, () => int(0, 15).toString(16)).join('');
  const uuid = (): string =>
    `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[int(0, 3)]}${hex(3)}-${hex(12)}`;
  return { next, int, pick, chance: (p) => next() < p, shuffle, uuid };
};
