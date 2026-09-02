import { NextResponse } from "next/server";

import { evaluateAutomation } from "@/lib/automation/engine";
import { asJson } from "@/lib/db/json";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";

type EventEnvelope = { data: Record<string, unknown>; depth: number; type: string };

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: runs } = await admin.from("automation_runs").select("id,seller_account_id,result,automation_rules(event_type,conditions,action)").eq("state", "pending").order("created_at").limit(50);
  let completed = 0;
  for (const run of runs ?? []) {
    const rule = run.automation_rules as unknown as { action: { type?: string; value?: string }; conditions: Record<string, string | number | boolean>; event_type: string };
    const event = (run.result as unknown as { event?: EventEnvelope })?.event;
    if (!event || !evaluateAutomation({ action: { type: rule.action.type ?? "" }, conditions: rule.conditions, event: rule.event_type }, event)) {
      await admin.from("automation_runs").update({ result: { reason: "conditions_not_met" }, state: "skipped" }).eq("id", run.id).eq("state", "pending");
      continue;
    }
    try {
      if (rule.action.type === "notify") {
        await admin.from("notifications").insert({ channel: "in_app", payload: asJson({ reference: event.data.reference ?? "Order", status: rule.action.value || event.type }), recipient: run.seller_account_id, seller_account_id: run.seller_account_id, template: "seller_order_update" });
      } else if (rule.action.type === "tag_customer") {
        const customerId = String(event.data.customerId ?? "");
        if (!customerId) throw new Error("Event has no customer.");
        await admin.from("customer_tags").upsert({ customer_id: customerId, seller_account_id: run.seller_account_id, tag: (rule.action.value || "automated").slice(0, 80) }, { onConflict: "customer_id,tag" });
      } else {
        throw new Error("Unsupported automation action.");
      }
      await admin.from("automation_runs").update({ result: { action: rule.action.type }, state: "completed" }).eq("id", run.id).eq("state", "pending");
      completed++;
    } catch (error) {
      await admin.from("automation_runs").update({ result: { error: error instanceof Error ? error.message : "Automation failed" }, state: "failed" }).eq("id", run.id).eq("state", "pending");
    }
  }
  return NextResponse.json({ completed, processed: runs?.length ?? 0 });
}

export const GET = POST;
