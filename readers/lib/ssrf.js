'use strict';
/**
 * readers/lib/ssrf.js - the address rules a reader applies to EVERY hop.
 * ---------------------------------------------------------------------------
 * A copy of api/_shared/brand-workspace-core.js assertPublicUrl() and its
 * helpers (BLOCKED_HOST_RX, isPrivateV4, v6Groups, isPrivateIp). A reader is
 * deployed with readers/ as its root directory, so it cannot require a file
 * outside it; tests/catalog-readers.spec.js runs the same list of addresses
 * through BOTH copies and fails if they disagree.
 *
 * One difference, on purpose: check() RETURNS the addresses it approved, and
 * the reader connects to exactly one of those (the socket is pinned), so a
 * name that answers a public address to the check and a private one to the
 * connect (DNS rebinding) has nowhere to go.
 *
 * Refused: non-http(s) schemes, ports other than 80/443, credentials in the
 * URL, loopback / private / link-local (cloud metadata) / CGNAT / unique-local
 * / multicast literals, *.internal / *.local / localhost style names, and any
 * name whose resolution contains such an address.
 */

const dns = require('dns');

const BLOCKED_HOST_RX = /^(localhost|.*\.localhost|.*\.internal|.*\.local|.*\.home\.arpa|metadata|metadata\.google\.internal)$/i;

function isPrivateV4(octets) {
  const [a, b] = octets;
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;                    // this-host, private, loopback
  if (a === 169 && b === 254) return true;                              // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                     // private
  if (a === 192 && b === 168) return true;                              // private
  if (a === 192 && b === 0) return true;                                // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;                    // CGNAT
  if (a >= 224) return true;                                            // multicast + reserved
  return false;
}

function v6Groups(host) {
  let h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!/^[0-9a-f:.]*$/.test(h) || h.indexOf(':') < 0) return null;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    h = h.slice(0, dotted.index) + hi + ':' + lo;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = head.concat(Array(halves.length === 2 ? fill : 0).fill('0'), tail);
  if (groups.length !== 8) return null;
  const out = [];
  for (const g of groups) {
    if (g === '') return null;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateIp(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return isPrivateV4(v4.slice(1).map(Number));
  const g = v6Groups(h);
  if (!g) return false;
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  const firstSixZero = g.slice(0, 5).every((x) => x === 0);
  if (firstSixZero && (g[5] === 0xffff || g[5] === 0)) {
    const o = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];
    if (!(o[0] === 0 && o[1] === 0 && o[2] === 0 && o[3] === 0)) return isPrivateV4(o);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateV4([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  return false;
}

function refusal(message, code) { const e = new Error(message); e.status = 400; e.code = code || 'address_refused'; return e; }

const systemResolve = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/**
 * Check one URL. Resolves to { url: URL, addresses: [{address, family}] } with
 * every address public; throws (status 400) otherwise. `resolve` is the DNS
 * lookup; only createReader's code-level test hook ever passes another one.
 */
async function check(rawUrl, resolve) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { throw refusal('That is not a valid URL.', 'bad_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw refusal('Only http and https URLs can be read.', 'bad_url');
  if (u.port && u.port !== '80' && u.port !== '443') throw refusal('Only the standard http and https ports can be read.', 'bad_url');
  if (u.username || u.password) throw refusal('A URL carrying credentials is not read.', 'bad_url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOST_RX.test(host) || isPrivateIp(host)) throw refusal('That address is on a private or internal network, so it is not read.', 'private_address');
  const literal = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ? 4 : (v6Groups(host) ? 6 : 0);
  if (literal) return { url: u, addresses: [{ address: host, family: literal }] };
  let answers;
  try { answers = await (resolve || systemResolve)(host); } catch (_) { throw refusal(`Could not resolve ${host}.`, 'unresolvable'); }
  const list = (Array.isArray(answers) ? answers : [answers]).filter((a) => a && a.address);
  if (!list.length) throw refusal(`Could not resolve ${host}.`, 'unresolvable');
  for (const a of list) if (isPrivateIp(a.address)) throw refusal('That hostname resolves to a private or internal address, so it is not read.', 'private_address');
  return { url: u, addresses: list.map((a) => ({ address: a.address, family: a.family || (a.address.includes(':') ? 6 : 4) })) };
}

module.exports = { check, isPrivateIp, isPrivateV4, v6Groups, BLOCKED_HOST_RX };
