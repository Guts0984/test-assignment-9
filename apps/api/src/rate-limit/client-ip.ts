import { isIPv4, isIPv6 } from 'node:net';

/** Expands an IPv6 address into 8 hextet strings. Returns undefined if it is not valid IPv6. */
const expandIPv6 = (ip: string): string[] | undefined => {
  if (!isIPv6(ip)) return undefined;
  const clean = ip.split('%')[0] ?? ip; // drop zone id
  const [head = '', tail] = clean.split('::');
  const h = head === '' ? [] : head.split(':');
  const t = tail === undefined || tail === '' ? [] : tail.split(':');
  // An embedded IPv4 tail (::ffff:1.2.3.4) counts as two hextets.
  const fix = (parts: string[]): string[] =>
    parts.flatMap((p) => {
      if (!p.includes('.')) return [p];
      const o = p.split('.').map(Number);
      return [
        (((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16),
        (((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16),
      ];
    });
  const hh = fix(h);
  const tt = fix(t);
  if (tail === undefined) return hh.length === 8 ? hh : undefined;
  const missing = 8 - hh.length - tt.length;
  if (missing < 0) return undefined;
  return [...hh, ...Array<string>(missing).fill('0'), ...tt];
};

/**
 * Key used to rate-limit a client:
 *  - IPv4-mapped IPv6 (::ffff:1.2.3.4) is treated as the IPv4 address;
 *  - IPv6 is reduced to its /64 prefix, because one subscriber usually owns a whole /64 and could
 *    otherwise rotate through billions of addresses to dodge the limiter.
 */
export const clientKey = (ip: string | undefined): string => {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
  if (isIPv4(ip)) return ip;
  const parts = expandIPv6(ip);
  if (!parts) return `raw:${ip.slice(0, 64)}`;
  return `${parts
    .slice(0, 4)
    .map((p) => p.toLowerCase().padStart(4, '0'))
    .join(':')}::/64`;
};
