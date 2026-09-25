import { z } from "zod";

import { toE164 } from "./phone";

/**
 * Parse Meta's webhook payload into the two things SnapDuka acts on: buyer
 * messages and delivery receipts for our own messages.
 *
 * Deliberately lenient: Meta adds fields and message types without notice, and
 * a strict schema would turn every such change into a 400 that Meta retries
 * for days. Unknown types become `unsupported` (stored, shown in the inbox,
 * answered with a polite "text only"), and anything unparseable is skipped
 * rather than failing the whole batch.
 */

const mediaSchema = z.object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() });

const messageSchema = z.object({
  from: z.string(),
  id: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: mediaSchema.optional(),
  video: mediaSchema.optional(),
  document: mediaSchema.extend({ filename: z.string().optional() }).optional(),
  sticker: mediaSchema.optional(),
  audio: mediaSchema.extend({ voice: z.boolean().optional() }).optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() })
    .optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
  reaction: z.object({ emoji: z.string().optional(), message_id: z.string().optional() }).optional(),
});

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

const payloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.object({
                metadata: z.object({ phone_number_id: z.string() }).optional(),
                messages: z.array(z.unknown()).optional(),
                statuses: z.array(z.unknown()).optional(),
              }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export type InboundMessageType =
  | "text"
  | "image"
  | "audio"
  | "voice"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "interactive"
  | "button"
  | "reaction"
  | "unsupported";

export type InboundMessage = {
  wamid: string;
  from: string;
  type: InboundMessageType;
  body: string;
  mediaId: string | null;
  mediaMime: string | null;
  sentAt: string | null;
};

export type InboundStatus = {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  error: string | null;
};

export type ParsedWebhook = { messages: InboundMessage[]; statuses: InboundStatus[] };

function normalizeMessage(raw: unknown): InboundMessage | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data;
  const from = toE164(message.from);
  if (!from) return null;
  const sentAt =
    message.timestamp && /^\d+$/.test(message.timestamp)
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : null;
  const base = { wamid: message.id, from, sentAt, mediaId: null, mediaMime: null };

  switch (message.type) {
    case "text":
      return { ...base, type: "text", body: message.text?.body ?? "" };
    case "image":
    case "video":
    case "document":
    case "sticker": {
      const media = message[message.type];
      return {
        ...base,
        type: message.type,
        body: media?.caption ?? "",
        mediaId: media?.id ?? null,
        mediaMime: media?.mime_type ?? null,
      };
    }
    case "audio":
      return {
        ...base,
        type: message.audio?.voice ? "voice" : "audio",
        body: "",
        mediaId: message.audio?.id ?? null,
        mediaMime: message.audio?.mime_type ?? null,
      };
    case "location": {
      const location = message.location;
      const label = [location?.name, location?.address].filter(Boolean).join(", ");
      return { ...base, type: "location", body: label || `${location?.latitude},${location?.longitude}` };
    }
    case "interactive":
      return {
        ...base,
        type: "interactive",
        body: message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "",
      };
    case "button":
      return { ...base, type: "button", body: message.button?.text ?? "" };
    case "reaction":
      return { ...base, type: "reaction", body: message.reaction?.emoji ?? "" };
    default:
      return { ...base, type: "unsupported", body: "" };
  }
}

const STATUSES: readonly InboundStatus["status"][] = ["sent", "delivered", "read", "failed"];

function isStatus(value: string): value is InboundStatus["status"] {
  return (STATUSES as readonly string[]).includes(value);
}

function normalizeStatus(raw: unknown): InboundStatus | null {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { status } = parsed.data;
  if (!isStatus(status)) return null;
  const first = parsed.data.errors?.[0];
  return {
    wamid: parsed.data.id,
    status,
    error: first ? `${first.code ?? ""} ${first.title ?? ""}`.trim() : null,
  };
}

/**
 * @param phoneNumberId only changes for this number are taken; a WhatsApp
 *   Business Account can hold several numbers, and a message to another one is
 *   not a message to SnapDuka.
 */
export function parseWebhook(body: unknown, phoneNumberId: string | null): ParsedWebhook {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return { messages: [], statuses: [] };

  const messages: InboundMessage[] = [];
  const statuses: InboundStatus[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const numberId = change.value.metadata?.phone_number_id;
      if (phoneNumberId && numberId && numberId !== phoneNumberId) continue;
      for (const raw of change.value.messages ?? []) {
        const message = normalizeMessage(raw);
        if (message) messages.push(message);
      }
      for (const raw of change.value.statuses ?? []) {
        const status = normalizeStatus(raw);
        if (status) statuses.push(status);
      }
    }
  }
  return { messages, statuses };
}
