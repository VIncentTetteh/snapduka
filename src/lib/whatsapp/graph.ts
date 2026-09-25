import "server-only";

import { GRAPH_API_BASE, GRAPH_API_VERSION, type WhatsAppCloudConfig } from "./config";
import { WA_TEMPLATES, orderedTemplateParams, type WaTemplateCall } from "./templates";

/**
 * The raw Cloud API calls: POST /{phone-number-id}/messages.
 *
 * Failures come in two kinds and callers must treat them differently:
 *  - **transient** (network, 5xx, rate limits) — thrown, so the notification
 *    worker or event drain retries with backoff;
 *  - **permanent** (outside the 24h window, a template Meta does not know, a
 *    number that is not on WhatsApp) — returned, because retrying five times
 *    over a day reaches the same answer and buries the real reason.
 */

export type GraphSendResult =
  | { ok: true; wamid: string }
  | { ok: false; reason: GraphPermanentReason; detail: string };

export type GraphPermanentReason = "outside_window" | "auth_failed" | "rejected";

/** Meta error codes that mean "try again later". */
const TRANSIENT_CODES = new Set([130429, 131056, 131048, 131000, 133004]);
/** Re-engagement: the buyer's 24h window has closed. */
const OUTSIDE_WINDOW_CODE = 131047;
/** Access token expired or invalid: an operator must fix configuration. */
const AUTH_CODES = new Set([190, 10, 200]);

type GraphErrorBody = { error?: { code?: number; message?: string; error_subcode?: number } };
type GraphSuccessBody = { messages?: { id?: string }[] };

async function postMessage(config: WhatsAppCloudConfig, payload: Record<string, unknown>): Promise<GraphSendResult> {
  const url = `${GRAPH_API_BASE}/${GRAPH_API_VERSION}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Fixed message: a fetch error can echo the request, and the request
    // carries the access token.
    throw new Error("WhatsApp request failed.");
  }

  const body = (await response.json().catch(() => null)) as (GraphErrorBody & GraphSuccessBody) | null;
  if (response.ok) {
    const wamid = body?.messages?.[0]?.id;
    if (!wamid) throw new Error("WhatsApp accepted the message but returned no id.");
    return { ok: true, wamid };
  }

  const code = body?.error?.code ?? 0;
  const detail = `${response.status}/${code}`;
  if (response.status >= 500 || response.status === 429 || TRANSIENT_CODES.has(code)) {
    throw new Error(`WhatsApp is temporarily unavailable (${detail}).`);
  }
  if (code === OUTSIDE_WINDOW_CODE) return { ok: false, reason: "outside_window", detail };
  if (response.status === 401 || AUTH_CODES.has(code)) return { ok: false, reason: "auth_failed", detail };
  return { ok: false, reason: "rejected", detail };
}

/** Digits only: Graph wants the number without the leading +. */
function graphRecipient(e164: string): string {
  return e164.replace(/\D/g, "");
}

export function sendGraphText(config: WhatsAppCloudConfig, to: string, text: string): Promise<GraphSendResult> {
  return postMessage(config, {
    to: graphRecipient(to),
    type: "text",
    text: { preview_url: true, body: text.slice(0, 4096) },
  });
}

export function sendGraphTemplate(
  config: WhatsAppCloudConfig,
  to: string,
  call: WaTemplateCall,
): Promise<GraphSendResult> {
  const definition = WA_TEMPLATES[call.name];
  return postMessage(config, {
    to: graphRecipient(to),
    type: "template",
    template: {
      name: definition.name,
      language: { code: definition.language },
      components: [
        {
          type: "body",
          parameters: orderedTemplateParams(call).map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}

/**
 * The bearer token goes along on the second hop, so it only ever goes to a
 * Meta host: whatever returned the URL, the token is not handed to anyone else.
 */
function isMetaMediaHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      [".fbsbx.com", ".whatsapp.net", ".fbcdn.net", ".facebook.com"].some((suffix) => parsed.hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

/** WhatsApp caps voice notes at 16 MB; anything larger is not one. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * Download an inbound media object (a voice note for transcription). Two
 * hops: the media id resolves to a short-lived URL, which itself needs the
 * bearer token. Null on any failure — the caller answers "please type".
 */
export async function downloadGraphMedia(
  config: WhatsAppCloudConfig,
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const headers = { authorization: `Bearer ${config.accessToken}` };
  try {
    const meta = await fetch(`${GRAPH_API_BASE}/${GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!meta.ok) return null;
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url || (info.file_size ?? 0) > MAX_MEDIA_BYTES || !isMetaMediaHost(info.url)) return null;
    const media = await fetch(info.url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!media.ok) return null;
    const bytes = new Uint8Array(await media.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) return null;
    return { bytes, mimeType: info.mime_type ?? media.headers.get("content-type") ?? "audio/ogg" };
  } catch {
    return null;
  }
}
