import { timingSafeEqual } from "node:crypto";
import "server-only";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function isInternalJobRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;
  const secrets = [process.env.INTERNAL_JOB_SECRET, process.env.CRON_SECRET].filter((secret): secret is string => Boolean(secret));
  return secrets.length > 0 && secrets.some((secret) => safeEqual(authorization, `Bearer ${secret}`));
}
