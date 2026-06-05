/** @format */

// Brute-force protection for password-protected shares.
//
// A share's password is the only thing standing between an anonymous visitor
// and the shared files, and bcrypt(10) alone is not enough to stop an
// automated guesser. We track failed password attempts and lock further
// attempts for a cooldown once a threshold is crossed.
//
// Attempts are keyed by token + client IP so a single attacker throttles only
// themselves, not every visitor of the share (avoids a trivial lock-out DoS).
// A coarser per-token backstop guards against a distributed attack from many
// IPs against one share.

const WINDOW_MS = 10 * 60 * 1000; // failures are counted within a 10-min window
const MAX_PER_CLIENT = 10; // failures per token+IP before that client is locked
const MAX_PER_TOKEN = 100; // failures per token (any IP) before the share is locked
const LOCKOUT_MS = 15 * 60 * 1000; // how long a lock lasts

// key -> { count, windowStart, lockedUntil }
const buckets = new Map();

function sweep(now) {
  for (const [key, rec] of buckets) {
    const expired =
      (!rec.lockedUntil || rec.lockedUntil <= now) && now - rec.windowStart > WINDOW_MS;
    if (expired) buckets.delete(key);
  }
}

function peek(key, now) {
  const rec = buckets.get(key);
  if (!rec) return null;
  // Reset a stale window that isn't actively locked.
  if ((!rec.lockedUntil || rec.lockedUntil <= now) && now - rec.windowStart > WINDOW_MS) {
    buckets.delete(key);
    return null;
  }
  return rec;
}

function lockState(key, now) {
  const rec = peek(key, now);
  if (rec && rec.lockedUntil && rec.lockedUntil > now) {
    return { limited: true, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { limited: false };
}

/**
 * Extract a client identifier (IP) from a request. Works for both the Web
 * `Request` used by app-router routes (headers.get) and the Node
 * `IncomingMessage` used by pages/api routes and the WS upgrade (headers object
 * + socket). Returns null when nothing usable is found.
 * @param {object} req - Web Request or Node IncomingMessage
 * @returns {string|null}
 */
export function clientIpFromHeaders(req) {
  if (!req) return null;
  const get = (name) =>
    typeof req.headers?.get === 'function' ? req.headers.get(name) : req.headers?.[name];
  const fwd = get('x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim();
  const real = get('x-real-ip');
  if (real) return String(real);
  return req.socket?.remoteAddress || null;
}

/**
 * Check whether further password attempts are currently locked.
 * @param {string} token - Share token
 * @param {string|null} clientId - Client identifier (IP); falls back to 'unknown'
 * @returns {{ limited: boolean, retryAfter?: number }}
 */
export function checkShareRateLimit(token, clientId) {
  const now = Date.now();
  const ip = clientId || 'unknown';
  const client = lockState(`${token}:${ip}`, now);
  if (client.limited) return client;
  return lockState(`${token}:*`, now);
}

function bump(key, now, threshold) {
  let rec = peek(key, now);
  if (!rec) {
    rec = { count: 0, windowStart: now, lockedUntil: 0 };
    buckets.set(key, rec);
  }
  rec.count += 1;
  if (rec.count >= threshold) {
    rec.lockedUntil = now + LOCKOUT_MS;
  }
}

/**
 * Record a failed password attempt for a share.
 * @param {string} token - Share token
 * @param {string|null} clientId - Client identifier (IP)
 */
export function recordShareFailure(token, clientId) {
  const now = Date.now();
  const ip = clientId || 'unknown';
  if (buckets.size > 5000) sweep(now);
  bump(`${token}:${ip}`, now, MAX_PER_CLIENT);
  bump(`${token}:*`, now, MAX_PER_TOKEN);
}

/**
 * Clear failure state for a client after a successful password verification.
 * The per-token backstop is intentionally left intact so a successful guess
 * mid-attack can't reset the distributed counter.
 * @param {string} token - Share token
 * @param {string|null} clientId - Client identifier (IP)
 */
export function recordShareSuccess(token, clientId) {
  const ip = clientId || 'unknown';
  buckets.delete(`${token}:${ip}`);
}
