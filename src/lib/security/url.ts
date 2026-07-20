import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

import { isSafeHttpUrl } from "@/lib/catalog/video";

/**
 * a.b.c.d → true for loopback (127/8, "this network" 0/8), RFC1918 private
 * ranges, link-local (169.254/16 — this is also the cloud-metadata range),
 * and multicast/reserved (224/4 and above, including broadcast).
 */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true; // fail closed on anything unparseable
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * IPv6 loopback/unspecified/link-local/unique-local, plus IPv4-mapped
 * addresses (::ffff:a.b.c.d, in either dotted-decimal or compressed-hex
 * form — Node's URL parser normalizes `[::ffff:127.0.0.1]` to
 * `::ffff:7f00:1`) — the embedded IPv4 is extracted and re-checked against
 * the same private ranges, since this form otherwise sails straight past
 * every IPv6 pattern while still routing to the mapped address on connect.
 */
function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (/^fe80:/.test(normalized)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(?:([\d.]+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    if (mapped[1]) return isPrivateIPv4(mapped[1]);
    const hi = Number.parseInt(mapped[2], 16);
    const lo = Number.parseInt(mapped[3], 16);
    return isPrivateIPv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  return isIPv4(address) ? isPrivateIPv4(address) : isPrivateIPv6(address);
}

/**
 * True only for an http(s) URL whose hostname resolves — on every address
 * DNS returns for it, not just the first — to a real, public IP. Used
 * before storing or fetching a seller-supplied webhook URL, which is
 * otherwise a classic SSRF vector (the server itself makes the request, so
 * a URL pointing at an internal service or the cloud metadata endpoint
 * would leak infrastructure-internal data). Resolves via DNS rather than
 * checking the hostname string alone, since a public hostname's DNS record
 * can be pointed at a private address (rebinding); checks *all* returned
 * addresses because a hostname can carry both a public and a private
 * record, and a resolver may return either.
 */
export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  if (!isSafeHttpUrl(rawUrl)) return false;
  const url = new URL(rawUrl.trim());
  if (url.hostname === "localhost") return false;
  try {
    const results = await lookup(url.hostname, { all: true });
    if (results.length === 0) return false;
    return results.every((result) => !isPrivateAddress(result.address));
  } catch {
    return false;
  }
}
