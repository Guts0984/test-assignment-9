/**
 * CSRF defence for cookie auth, on top of SameSite=Lax: unsafe methods must come from an allowed origin.
 * Requests without an Origin header (curl, server-to-server) are not browser-driven cross-site
 * requests, and they cannot carry the victim's cookie, so they are allowed.
 */
export type OriginCheck = {
  method: string;
  origin: string | undefined;
  secFetchSite: string | undefined;
  host: string | undefined;
  allowedOrigins: readonly string[];
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isOriginAllowed = (c: OriginCheck): boolean => {
  if (SAFE.has(c.method.toUpperCase())) return true;
  if (c.origin === undefined) return c.secFetchSite !== 'cross-site';
  if (c.origin === 'null') return false;
  if (c.allowedOrigins.includes(c.origin)) return true;
  if (c.secFetchSite === 'cross-site') return false;
  try {
    return new URL(c.origin).host === c.host; // same-origin: Origin's host equals the Host header
  } catch {
    return false;
  }
};
