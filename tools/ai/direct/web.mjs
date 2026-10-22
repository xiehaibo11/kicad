// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { bad, required, ok, DirectError } from './utils.mjs';
export function publicIP(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
  }
  if (net.isIPv6(address)) {
    address = address.toLowerCase();
    if (address.startsWith('::ffff:')) return publicIP(address.slice(7));
    // Global unicast only. Documentation, NAT64 and local networks are excluded.
    return /^[23]/.test(address) && !address.startsWith('2001:db8:') && !address.startsWith('2001:0:') && !address.startsWith('2001:2:') && !address.startsWith('2002:');
  }
  return false;
}
// Clash-style fake-IP DNS is not a public destination. Resolve that specific
// synthetic range through a pinned, TLS-validated public resolver instead of
// connecting to it or exempting it from the SSRF checks.
export async function publicAddresses(host, options = {}, lookup = dns.lookup, fetchDNS = fetchPublic) {
  let addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true });
  const fake = a => net.isIPv4(a.address) && /^198\.(18|19)\./.test(a.address) || net.isIPv6(a.address) && a.address.toLowerCase().startsWith('2001:2:');
  if (!net.isIP(host) && addresses.length && addresses.every(fake)) {
    const response = await fetchDNS('https://1.1.1.1/dns-query?name=' + encodeURIComponent(host) + '&type=A', { ...options, accept: 'application/dns-json' });
    const answer = JSON.parse(response.buffer.toString('utf8'));
    if (answer.Status !== 0) throw new DirectError('DNS_FAILED', 'Public DNS resolution failed');
    addresses = (answer.Answer ?? []).filter(a => a.type === 1).map(a => ({ address: a.data, family: 4 }));
  }
  if (!addresses.length || addresses.some(a => !publicIP(a.address))) bad('Private, local and reserved network destinations are not allowed');
  return addresses;
}
export async function fetchPublic(url, { signal, timeoutMs = 30000, redirects = 0, accept = 'text/html,application/pdf,text/plain' } = {}) {
  const u = new URL(url);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || redirects > 5 || u.port && !['80', '443'].includes(u.port)) bad('Only public HTTP(S) URLs on standard ports are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, ''), addresses = await publicAddresses(host, {signal, timeoutMs});
  const chosen = addresses[0];
  const response = await new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).get(u, { signal, timeout: timeoutMs, headers: { 'User-Agent': 'KiCad-Direct/1.0', Accept: accept }, lookup: (_host, opts, callback) => opts.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family) }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 16 * 1024 * 1024) res.destroy(new DirectError('OUTPUT_LIMIT', 'HTTP response exceeds 16 MiB')); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) })); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new DirectError('TIMEOUT', 'HTTP request timed out'))); req.on('error', reject);
  });
  if (response.status >= 300 && response.status < 400 && response.headers.location) return fetchPublic(new URL(response.headers.location, u).href, { signal, timeoutMs, redirects: redirects + 1, accept });
  if (response.status !== 200) throw new DirectError('HTTP_FAILED', 'HTTP status ' + response.status);
  return { ...response, url: u.href };
}
const plain = s => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export async function web(action, p, options) {
  const searching = action === 'web.search', limit = p.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) bad('limit must be 1..10');
  const response = await fetchPublic(searching ? 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(required(p, 'query')) : required(p, 'url'), { ...options, timeoutMs: p.timeoutMs ?? 30000 });
  if (searching) {
    const text = response.buffer.toString('utf8'), results = [...text.matchAll(/<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, limit).map(m => { const u = new URL(m[1].replaceAll('&amp;', '&'), response.url); return { title: plain(m[2]), url: u.searchParams.get('uddg') ?? u.href }; });
    return ok(action, { query: p.query, results, source: response.url, untrustedContent: true });
  }
  const pdf = response.buffer.subarray(0, 5).toString() === '%PDF-';
  if (p.output) fs.writeFileSync(p.output, response.buffer, { flag: 'wx', mode: 0o600 });
  return ok(action, { url: response.url, contentType: response.headers['content-type'], bytes: response.buffer.length, untrustedContent: true, ...(pdf ? { format: 'pdf', ...(p.output ? {} : { message: 'Pass output to save the PDF for inspection' }) } : { text: plain(response.buffer.toString('utf8')).slice(0, 200000) }) }, p.output ? [p.output] : []);
}
