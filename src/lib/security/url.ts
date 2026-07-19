import { lookup } from "node:dns/promises";

import { isSafeHttpUrl } from "@/lib/catalog/video";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isPrivateAddress(address: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(address));
}

/**
 * True only for an http(s) URL whose hostname resolves to a real, public
 * IP address — used before storing or fetching a seller-supplied webhook
 * URL, which is otherwise a classic SSRF vector (the server itself makes
 * the request, so a URL pointing at an internal service or the cloud
 * metadata endpoint would leak infrastructure-internal data). Resolves via
 * DNS rather than checking the hostname string alone, since a public
 * hostname's DNS record can be pointed at a private address (rebinding).
 */
export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  if (!isSafeHttpUrl(rawUrl)) return false;
  const url = new URL(rawUrl.trim());
  if (url.hostname === "localhost") return false;
  try {
    const { address } = await lookup(url.hostname);
    return !isPrivateAddress(address);
  } catch {
    return false;
  }
}
