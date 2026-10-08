import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { DomainError } from '../errors';

/**
 * Spec §79 + SSRF defense for URL ingestion. Every address a hostname resolves to is checked *at connect
 * time* (custom `lookup`), so DNS rebinding between a check and the request cannot reach internal hosts.
 * Redirects are followed manually and re-checked.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) must be judged as the IPv4 address it maps to.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mapped) return isPublicAddress(mapped);
    return !blocked.check(address, 'ipv6');
  }
  return !blocked.check(address, 'ipv4');
}

const refuse = (message: string) => new DomainError('invalid', 'URL_NOT_ALLOWED', message);

export function assertFetchableUrl(raw: string, ports: string[] = ['80', '443']): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refuse('Enter a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refuse('Only http and https URLs are allowed');
  if (url.username || url.password) throw refuse('URLs with credentials are not allowed');
  if (url.port && !ports.includes(url.port)) throw refuse('Only the standard web ports are allowed');
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw refuse('That address is not reachable from here');
  }
  return url;
}

export type Lookup = typeof dnsLookup;

/** A `lookup` for http.request that refuses private destinations. Exported for tests. */
export function guardedLookup(resolve: Lookup = dnsLookup): Lookup {
  return ((hostname: string, options: object, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '');
      const list = addresses as LookupAddress[];
      const bad = list.find((a) => !isPublicAddress(a.address));
      if (bad || list.length === 0) return callback(refuse('That address is not reachable from here'), '');
      if ((options as { all?: boolean }).all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  }) as Lookup;
}

export interface FetchedPage {
  url: string;
  contentType: string;
  body: Buffer;
}

interface RequestOpts {
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
  lookup: Lookup;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Keep the first maxBytes of an oversized response instead of failing (webhook responses are only logged). */
  truncate?: boolean;
}

function requestOnce(url: URL, opts: RequestOpts) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: opts.method ?? 'GET',
        lookup: opts.lookup,
        timeout: opts.timeoutMs,
        headers: { 'user-agent': opts.userAgent, accept: 'text/html,text/plain;q=0.9,*/*;q=0.1', ...opts.headers },
      },
      (res) => {
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > opts.maxBytes && !opts.truncate) {
          res.destroy();
          return reject(new DomainError('invalid', 'URL_TOO_LARGE', 'The page is too large to import'));
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            if (opts.truncate) resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) });
            else reject(new DomainError('invalid', 'URL_TOO_LARGE', 'The page is too large to import'));
          } else parts.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new DomainError('upstream', 'URL_TIMEOUT', 'The page took too long to respond')));
    req.on('error', (err) => reject(err instanceof DomainError ? err : new DomainError('upstream', 'URL_FETCH_FAILED', `Could not fetch the page: ${err.message}`)));
    req.end(opts.body);
  });
}

export async function safeFetch(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; userAgent?: string; lookup?: Lookup; ports?: string[] } = {},
): Promise<FetchedPage> {
  const o = {
    maxBytes: opts.maxBytes ?? 2 * 1_048_576,
    timeoutMs: opts.timeoutMs ?? 10_000,
    userAgent: opts.userAgent ?? 'LeadoraBot/1.0 (+knowledge base import)',
    lookup: opts.lookup ?? guardedLookup(),
  };
  let url = assertFetchableUrl(raw, opts.ports);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const res = await requestOnce(url, o);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = assertFetchableUrl(new URL(res.headers.location, url).toString(), opts.ports);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new DomainError('upstream', 'URL_FETCH_FAILED', `The page returned HTTP ${res.status}`);
    return { url: url.toString(), contentType: String(res.headers['content-type'] ?? ''), body: res.body };
  }
  throw new DomainError('upstream', 'URL_FETCH_FAILED', 'Too many redirects');
}

/**
 * SSRF-safe POST for outbound webhooks: same address checks as safeFetch, redirects are not followed
 * (a webhook that redirects is a failed delivery), and only the start of the response is kept.
 */
export async function safePost(
  raw: string,
  body: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; lookup?: Lookup; ports?: string[] } = {},
): Promise<{ status: number; body: string }> {
  const url = assertFetchableUrl(raw, opts.ports);
  const res = await requestOnce(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...opts.headers },
    maxBytes: 2048,
    truncate: true,
    timeoutMs: opts.timeoutMs ?? 10_000,
    userAgent: 'Leadora-Webhooks/1.0',
    lookup: opts.lookup ?? guardedLookup(),
  });
  return { status: res.status, body: res.body.toString('utf8') };
}

/** Minimal robots.txt check for our user agent or "*" (spec §79: respect robots where applicable). */
export function robotsAllows(robotsTxt: string, path: string, agent = 'leadorabot'): boolean {
  let applies = false;
  let matchedSpecific = false;
  const rules: { allow: boolean; prefix: string }[] = [];
  const specific: typeof rules = [];
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, field, value] = m;
    const f = field!.toLowerCase();
    if (f === 'user-agent') {
      const ua = value!.toLowerCase();
      applies = ua === '*' || agent.startsWith(ua);
      if (applies && ua !== '*') matchedSpecific = true;
      continue;
    }
    if (!applies || (f !== 'allow' && f !== 'disallow') || (f === 'disallow' && !value)) continue;
    (matchedSpecific ? specific : rules).push({ allow: f === 'allow', prefix: value! });
  }
  const active = specific.length ? specific : rules;
  // Longest matching prefix wins, as in Google's and the RFC 9309 interpretation.
  const match = active.filter((r) => path.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match ? match.allow : true;
}
