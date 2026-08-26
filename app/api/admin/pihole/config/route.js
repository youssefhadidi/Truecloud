/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getConfig, patchConfig } from '@/lib/pihole';
import { piholeError, readJson } from '../respond';

// FTL's config tree also carries password hashes and TOTP secrets, so the
// response is projected down to the handful of keys this page edits rather
// than proxied wholesale. Writes are whitelisted for the same reason.

const LISTENING_MODES = new Set(['LOCAL', 'SINGLE', 'BIND', 'ALL', 'NONE']);
// An upstream is an IPv4/IPv6 address or hostname, optionally with #port.
const UPSTREAM_RE = /^[A-Za-z0-9._:[\]-]{1,253}(#\d{1,5})?$/;
// Conditional forwarding: "true,192.168.0.0/24,192.168.0.1,local"
const REV_SERVER_RE = /^[A-Za-z0-9._:,/[\]-]{1,255}$/;
// Pi-hole port syntax, e.g. "8080,[::]:8080" or "127.0.0.1:8080,[::1]:8080"
const WEBSERVER_PORT_RE = /^[A-Za-z0-9.:,[\]]{1,128}$/;

function project(config) {
  const dns = config?.config?.dns ?? config?.dns ?? {};
  const webserver = config?.config?.webserver ?? config?.webserver ?? {};
  return {
    dns: {
      upstreams: dns.upstreams ?? [],
      dnssec: Boolean(dns.dnssec),
      revServers: dns.revServers ?? [],
      listeningMode: dns.listeningMode ?? 'LOCAL',
    },
    webserver: { port: webserver.port ?? '' },
  };
}

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Build the patch payload from the request, or return an error response.
 * @returns {{ patch?: object, response?: Response }}
 */
function buildPatch(body) {
  const patch = {};

  if (body.dns !== undefined) {
    const dns = {};

    if (body.dns.upstreams !== undefined) {
      const upstreams = body.dns.upstreams;
      if (!Array.isArray(upstreams) || upstreams.length === 0) {
        return { response: badRequest('At least one upstream DNS server is required.') };
      }
      if (upstreams.length > 10) {
        return { response: badRequest('At most 10 upstream DNS servers are supported.') };
      }
      for (const entry of upstreams) {
        if (typeof entry !== 'string' || !UPSTREAM_RE.test(entry.trim())) {
          return { response: badRequest(`"${entry}" is not a valid upstream DNS server.`) };
        }
      }
      dns.upstreams = upstreams.map((u) => u.trim());
    }

    if (body.dns.dnssec !== undefined) dns.dnssec = Boolean(body.dns.dnssec);

    if (body.dns.revServers !== undefined) {
      const revServers = body.dns.revServers;
      if (!Array.isArray(revServers)) {
        return { response: badRequest('Conditional forwarding entries must be a list.') };
      }
      if (revServers.length > 10) {
        return { response: badRequest('At most 10 conditional forwarding entries are supported.') };
      }
      for (const entry of revServers) {
        if (typeof entry !== 'string' || !REV_SERVER_RE.test(entry.trim())) {
          return { response: badRequest(`"${entry}" is not a valid conditional forwarding entry.`) };
        }
      }
      dns.revServers = revServers.map((r) => r.trim());
    }

    if (body.dns.listeningMode !== undefined) {
      const mode = String(body.dns.listeningMode).toUpperCase();
      if (!LISTENING_MODES.has(mode)) {
        return { response: badRequest(`Invalid listening mode: ${body.dns.listeningMode}`) };
      }
      dns.listeningMode = mode;
    }

    if (Object.keys(dns).length > 0) patch.dns = dns;
  }

  if (body.webserver?.port !== undefined) {
    const port = String(body.webserver.port).trim();
    if (!WEBSERVER_PORT_RE.test(port)) {
      return { response: badRequest(`"${port}" is not a valid webserver port specification.`) };
    }
    patch.webserver = { port };
  }

  if (Object.keys(patch).length === 0) {
    return { response: badRequest('No supported settings were provided.') };
  }

  return { patch };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    return NextResponse.json(project(await getConfig()));
  } catch (e) {
    return piholeError(e, 'Failed to load Pi-hole configuration');
  }
}

export async function PATCH(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { body, response } = await readJson(req);
  if (response) return response;

  const { patch, response: invalid } = buildPatch(body);
  if (invalid) return invalid;

  try {
    await patchConfig(patch);
    return NextResponse.json(project(await getConfig()));
  } catch (e) {
    return piholeError(e, 'Failed to save Pi-hole configuration');
  }
}
