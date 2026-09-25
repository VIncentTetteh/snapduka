import "server-only";

import { onDomainEvent } from "@/lib/events/handlers";

import { processConversation } from "./process";

/**
 * `whatsapp.inbound` → the agent. Registered from src/lib/events/register.ts.
 * Emitted by `wa_record_inbound` with {conversationId, messageId}; the work is
 * per conversation (see ./process.ts), so the message id is informational.
 */
onDomainEvent("whatsapp.inbound", async (event) => {
  const payload = event.payload;
  const conversationId =
    payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.conversationId === "string"
      ? payload.conversationId
      : event.aggregate_id;
  await processConversation(conversationId);
});
