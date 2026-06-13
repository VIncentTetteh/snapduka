import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/notifications/email";
import { nextAttemptAt } from "@/lib/notifications/outbox";
import { orderUpdateTemplate } from "@/lib/notifications/templates";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!process.env.INTERNAL_JOB_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INTERNAL_JOB_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("notifications").select("*")
    .in("status", ["pending","failed"]).lte("available_at", new Date().toISOString()).order("created_at").limit(20);
  let processed = 0;
  for (const job of jobs ?? []) {
    const { data: claimed } = await admin.from("notifications").update({ status: "queued", claimed_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id).eq("attempts", job.attempts).select("*").maybeSingle();
    if (!claimed) continue;
    try {
      if (claimed.channel === "email") {
        const template = orderUpdateTemplate({
          reference: String(claimed.payload.reference),
          status: String(claimed.payload.status),
          trackingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${claimed.payload.trackingToken}`,
        });
        const result = await sendEmail(claimed.recipient, template.subject, template.text);
        if (!result.delivered) throw new Error(result.reason);
      }
      await admin.from("notifications").update({ status: "sent", last_error: null }).eq("id", claimed.id);
      await admin.from("notification_attempts").insert({ notification_id: claimed.id, attempt: claimed.attempts, outcome: "sent" });
      processed++;
    } catch (error) {
      const retryAt = nextAttemptAt(new Date(), claimed.attempts);
      await admin.from("notifications").update({
        status: "failed", available_at: retryAt?.toISOString() ?? claimed.available_at,
        last_error: error instanceof Error ? error.message.slice(0,500) : "Unknown provider failure",
      }).eq("id", claimed.id);
      await admin.from("notification_attempts").insert({ notification_id: claimed.id, attempt: claimed.attempts, outcome: retryAt ? "retry" : "dead_letter", error: error instanceof Error ? error.message.slice(0,500) : "Unknown" });
    }
  }
  return NextResponse.json({ processed });
}
