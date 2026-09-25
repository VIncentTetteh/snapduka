import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { handlersFor, type DomainEvent } from "./handlers";
import "./register";

export type DrainResult = { claimed: number; processed: number; failed: number };

/**
 * Claim one bounded batch of outbox events and run their handlers. A handler
 * failure releases the event for a later attempt (claim_domain_events stops
 * after 10); other events in the batch are unaffected.
 */
export async function drainDomainEvents(batch = 50): Promise<DrainResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_domain_events", { p_batch: batch });
  if (error) throw new Error(`claim_domain_events failed: ${error.message}`);

  const events = (data ?? []) as DomainEvent[];
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    let failure: string | null = null;
    try {
      for (const handler of handlersFor(event.event_type)) await handler(event);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      console.error(`[events] ${event.event_type}#${event.id} failed (attempt ${event.attempts})`, err);
    }
    const { error: completeError } = await admin.rpc("complete_domain_event", {
      p_id: event.id,
      p_error: failure ?? undefined,
    });
    if (completeError) {
      console.error(`[events] could not complete #${event.id}`, completeError);
    }
    if (failure) failed += 1;
    else processed += 1;
  }
  return { claimed: events.length, processed, failed };
}
