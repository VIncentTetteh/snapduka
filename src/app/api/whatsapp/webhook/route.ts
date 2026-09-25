import { after, NextResponse } from "next/server";

import { drainDomainEvents } from "@/lib/events/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWhatsAppAppSecret, loadWhatsAppCloudConfig, loadWhatsAppVerifyToken } from "@/lib/whatsapp/config";
import { parseWebhook } from "@/lib/whatsapp/inbound";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";

export const dynamic = "force-dynamic";

/**
 * Meta's WhatsApp webhook.
 *
 * GET is the one-time subscription handshake: echo `hub.challenge` when the
 * verify token matches.
 *
 * POST carries buyer messages and delivery receipts. It must answer quickly
 * or Meta retries, so it only verifies, stores and enqueues:
 *   1. X-Hub-Signature-256 over the raw body, constant-time — this URL is
 *      public, and an unsigned request could inject "buyer" messages into any
 *      seller's inbox and spend their AI budget;
 *   2. `wa_record_inbound` per message, which dedupes on wamid and emits
 *      `whatsapp.inbound` in the same transaction;
 *   3. 200. The agent runs from the outbox; `after()` kicks the drain so the
 *      first reply does not wait for the once-a-minute cron.
 *
 * A storage failure returns 500 on purpose: Meta redelivers, and the wamid
 * dedupe makes the redelivery safe.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = await loadWhatsAppVerifyToken();
  if (
    expected &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === expected
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = await loadWhatsAppAppSecret();
  if (!secret) {
    return NextResponse.json({ error: "WhatsApp is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable: Meta will not send better next time, so 200.
    return NextResponse.json({ ok: true });
  }

  const { messages, statuses } = parseWebhook(body, (await loadWhatsAppCloudConfig())?.phoneNumberId ?? null);
  const admin = createAdminClient();
  let enqueued = 0;

  for (const message of messages) {
    const { data, error } = await admin.rpc("wa_record_inbound", {
      p_wamid: message.wamid,
      p_from: message.from,
      p_type: message.type,
      p_body: message.body,
      p_media_id: message.mediaId ?? undefined,
      p_media_mime: message.mediaMime ?? undefined,
      p_sent_at: message.sentAt ?? undefined,
    });
    if (error) {
      console.error("[whatsapp/webhook] could not record an inbound message", error.message);
      return NextResponse.json({ error: "Storage failed." }, { status: 500 });
    }
    if (data?.[0] && !data[0].duplicate) enqueued += 1;
  }

  for (const status of statuses) {
    const { error } = await admin.rpc("wa_apply_status", {
      p_wamid: status.wamid,
      p_status: status.status,
      p_error: status.error ?? undefined,
    });
    // A lost receipt only makes a tick grey; not worth a redelivery of the batch.
    if (error) console.error("[whatsapp/webhook] could not apply a status", error.message);
  }

  if (enqueued > 0) {
    after(async () => {
      try {
        await drainDomainEvents(Math.min(enqueued * 2, 20));
      } catch (error) {
        // The per-minute cron picks it up; this was only a head start.
        console.error("[whatsapp/webhook] early drain failed", error);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
