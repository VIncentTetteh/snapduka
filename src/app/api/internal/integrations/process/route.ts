import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { isSafeWebhookUrl } from "@/lib/security/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { signWebhook } from "@/lib/webhooks/signing";

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("webhook_deliveries").select("id,payload,attempt_count,outbound_webhooks(url,secret_encrypted)").in("state", ["queued", "retry"]).lte("next_attempt_at", new Date().toISOString()).limit(25);
  let delivered = 0;
  for (const job of jobs ?? []) {
    const hook = job.outbound_webhooks as unknown as { secret_encrypted: string; url: string };
    if (!(await isSafeWebhookUrl(hook.url))) {
      const attempts = job.attempt_count + 1;
      await admin.from("webhook_deliveries").update({ attempt_count: attempts, last_error: "Webhook URL failed safety check (blocked host or private IP).", next_attempt_at: new Date(Date.now() + Math.min(86_400_000, 2 ** attempts * 60_000)).toISOString(), state: attempts >= 8 ? "dead_letter" : "retry" }).eq("id", job.id);
      continue;
    }
    const body = JSON.stringify(job.payload);
    try {
      const response = await fetch(hook.url, { body, headers: { "content-type": "application/json", "x-snapduka-signature": signWebhook(body, hook.secret_encrypted) }, method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      // redirect: "manual" surfaces a 3xx as an opaqueredirect response (type
      // "opaqueredirect", status 0) instead of following it — a followed
      // redirect would resolve and connect to a brand-new host that never
      // passed isSafeWebhookUrl, reopening the SSRF hole this route just closed.
      if (response.type === "opaqueredirect") throw new Error("Webhook responded with a redirect, which is not followed.");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await admin.from("webhook_deliveries").update({ attempt_count: job.attempt_count + 1, delivered_at: new Date().toISOString(), state: "delivered" }).eq("id", job.id);
      delivered++;
    } catch (error) {
      const attempts = job.attempt_count + 1;
      await admin.from("webhook_deliveries").update({ attempt_count: attempts, last_error: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed", next_attempt_at: new Date(Date.now() + Math.min(86_400_000, 2 ** attempts * 60_000)).toISOString(), state: attempts >= 8 ? "dead_letter" : "retry" }).eq("id", job.id);
    }
  }
  return NextResponse.json({ delivered, processed: jobs?.length ?? 0 });
}

export const GET = POST;
