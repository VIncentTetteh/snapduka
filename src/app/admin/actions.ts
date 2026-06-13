"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { canTransitionCase, type CaseState } from "@/lib/support/transitions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveCaseAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const caseId = String(formData.get("caseId"));
  const next = String(formData.get("status")) as CaseState;
  const resolution = String(formData.get("resolution") ?? "").trim();
  const admin = createAdminClient();
  const { data: current } = await admin.from("support_cases").select("status,order_id").eq("id",caseId).maybeSingle();
  if (!current || !canTransitionCase(current.status,next) || (next === "resolved" && !resolution)) return;
  await admin.from("support_cases").update({ status: next, resolution: resolution || null }).eq("id",caseId);
  await admin.from("orders").update({ dispute_status: next }).eq("id",current.order_id);
  await admin.from("case_messages").insert({ case_id: caseId, actor_type: "admin", actor_id: actor.userId, body: resolution || `Case moved to ${next}`, operator_only: false });
  revalidatePath(`/admin/cases/${caseId}`); revalidatePath("/admin/cases");
}

export async function applyRiskAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator" || formData.get("confirm") !== "yes") return;
  const sellerId = String(formData.get("sellerId"));
  const caseId = String(formData.get("caseId") ?? "") || null;
  const action = String(formData.get("riskAction"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason || !["warning","require_verification","restrict_payments","suspend","remove"].includes(action)) return;
  const admin = createAdminClient();
  await admin.from("risk_actions").insert({ seller_account_id: sellerId, case_id: caseId, operator_user_id: actor.userId, action, reason });
  if (action === "restrict_payments") await admin.from("payment_subaccounts").update({ status: "restricted" }).eq("seller_account_id",sellerId);
  if (action === "suspend") await admin.from("seller_accounts").update({ status: "suspended", is_active: false }).eq("id",sellerId);
  if (action === "remove") await admin.from("seller_accounts").update({ status: "closed", is_active: false }).eq("id",sellerId);
  await admin.rpc("write_audit_event", { p_actor_type:"admin",p_actor_id:actor.userId,p_action:`risk_${action}`,p_entity_type:"seller_account",p_entity_id:sellerId,p_before_data:null,p_after_data:{ action, reason },p_metadata:{ caseId } });
  revalidatePath(`/admin/sellers/${sellerId}`);
}
