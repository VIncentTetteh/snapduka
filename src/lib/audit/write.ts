import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

/** Derived from the factory so it tracks the real client type, not a guess. */
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Writes an audit event, and complains loudly if it cannot.
 *
 * Every call site previously did `await admin.rpc("write_audit_event", {...})`
 * and discarded the result. The RPC does work today — creator_suspended and
 * creator_reinstated are both on record — but a discarded result means the day
 * it stops working, the audit trail goes quietly empty. That is the one failure
 * mode an audit trail cannot have: it is trusted precisely because absence of a
 * record is taken to mean absence of the action.
 *
 * The write is still not allowed to fail the operation around it. Refusing to
 * suspend an abusive seller because logging is down is worse than suspending
 * them with a gap in the log — so this reports and returns rather than throwing,
 * and returns whether it succeeded for callers that want to say so in the UI.
 */
export type AuditEventInput = {
  actorType: "system" | "user" | "seller" | "admin" | "provider";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditEvent(
  admin: AdminClient,
  input: AuditEventInput,
): Promise<boolean> {
  // audit_events_actor_check requires an actor_id for anything that is not
  // 'system'. Catching it here names the problem, where the database would only
  // report a generic constraint violation.
  if (input.actorType !== "system" && !input.actorId) {
    console.error(
      `[audit] refusing to write ${input.action}: actor_type '${input.actorType}' requires an actor_id`,
    );
    return false;
  }

  const { error } = await admin.rpc("write_audit_event", {
    p_actor_type: input.actorType,
    p_actor_id: input.actorId,
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_before_data: input.before ?? null,
    p_after_data: input.after ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    console.error(
      `[audit] failed to record ${input.action} on ${input.entityType}${
        input.entityId ? ` ${input.entityId}` : ""
      }: ${error.message}`,
      { code: error.code, details: error.details },
    );
    return false;
  }

  return true;
}
