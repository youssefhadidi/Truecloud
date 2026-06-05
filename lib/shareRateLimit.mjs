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

// Number of trusted reverse-proxy hops sitting in front of the app.
//   1 (default) — the standard deployment: a single trusted reverse proxy
//     (nginx) in front. The real client IP is read from X-Forwarded-For by
//     counting back past our own hop. SAFE ONLY IF the app's port is not
//     directly reachable (firewall :3000 or bind nginx upstream to localhost);
//     otherwise a direct request can forge X-Forwarded-For.
//   0           — the app is reached directly (no proxy). Forwarded headers are
//     attacker-controlled and ignored; the TCP socket address is used instead.
//   N>1         — N trusted proxies in the chain.
const TRUSTED_PROXY_HOPS = (() => {
  const v = process.env.TRUST_PROXY;
  if (v === undefined || v === '') return 1; // default: single reverse proxy
  if (v === 'false' || v === '0') return 0;
  if (v === 'true') return 1;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

/**
 * Extract a client identifier (IP) from a request. Works for both the Web
 * `Request` used by app-router routes (headers.get) and the Node
 * `IncomingMessage` used by pages/api routes and the WS upgrade (headers object
 * + socket). Returns null when nothing usable is found.
 *
 * Forwarded headers are only consulted when TRUST_PROXY says there is at least
 * one trusted proxy, and even then the value is read from the RIGHT of
 * X-Forwarded-For: each trusted proxy appends the address it received the
 * request from, so the rightmost entries are the ones our own infrastructure
 * added. A client can only prepend forged values to the left, so counting back
 * `TRUSTED_PROXY_HOPS` from the end yields a spoof-resistant client IP.
 * @param {object} req - Web Request or Node IncomingMessage
 * @returns {string|null}
 */
export function clientIpFromHeaders(req) {
  if (!req) return null;
  const get = (name) =>
    typeof req.headers?.get === 'function' ? req.headers.get(name) : req.headers?.[name];

  const socketIp = req.socket?.remoteAddress || null;

  if (TRUSTED_PROXY_HOPS > 0) {
    const fwd = get('x-forwarded-for');
    if (fwd) {
      const parts = String(fwd)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // The entry our outermost trusted proxy appended is at length - hops.
      const idx = parts.length - TRUSTED_PROXY_HOPS;
      if (idx >= 0 && parts[idx]) return parts[idx];
      // Header shorter than the configured hop count — misconfiguration or a
      // request that didn't traverse the full proxy chain. Don't trust it.
    }
    // X-Real-IP is set (overwritten) by the proxy, so it's usable for a single
    // hop when X-Forwarded-For is absent.
    const real = get('x-real-ip');
    if (real) return String(real).trim();
  }

  return socketIp;
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
