import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/db/json";

export async function enqueueIntegrationEvent(input: {
  data: Record<string, unknown>;
  depth?: number;
  eventId: string;
  eventType: "order.created" | "order.completed";
  sellerAccountId: string;
}) {
  const admin = createAdminClient();
  const payload = { data: input.data, depth: input.depth ?? 0, id: input.eventId, occurredAt: new Date().toISOString(), type: input.eventType };
  const [{ data: hooks }, { data: rules }] = await Promise.all([
    admin.from("outbound_webhooks").select("id").eq("seller_account_id", input.sellerAccountId).eq("active", true).contains("event_types", [input.eventType]),
    admin.from("automation_rules").select("id").eq("seller_account_id", input.sellerAccountId).eq("event_type", input.eventType).eq("active", true),
  ]);
  if (hooks?.length) {
    await admin.from("webhook_deliveries").upsert(hooks.map((hook) => ({ event_id: input.eventId, payload: asJson(payload), seller_account_id: input.sellerAccountId, webhook_id: hook.id })), { onConflict: "webhook_id,event_id", ignoreDuplicates: true });
  }
  if (rules?.length) {
    await admin.from("automation_runs").upsert(rules.map((rule) => ({ depth: input.depth ?? 0, event_id: input.eventId, result: asJson({ event: payload }), rule_id: rule.id, seller_account_id: input.sellerAccountId, state: "pending" })), { onConflict: "rule_id,event_id", ignoreDuplicates: true });
  }
}
