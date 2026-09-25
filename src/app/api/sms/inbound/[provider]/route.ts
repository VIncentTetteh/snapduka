import { NextResponse } from "next/server";

import { inboundSmsProvider } from "@/lib/marketing/sms-inbound";
import { classifySmsKeyword, normalizeSmsPhone } from "@/lib/marketing/sms-keywords";
import { applySmsOptKeyword } from "@/lib/marketing/sms-opt-out";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** An MO keyword batch is tiny; anything this large is not one. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Inbound SMS replies to the shared sender: STOP-type keywords opt a number out
 * of marketing SMS from every seller, a bare START opts it back in.
 *
 *   1. The provider is looked up by path segment; each verifies its own
 *      signature over the raw body, before anything is parsed. Unconfigured
 *      providers answer 503 — never "accept and ignore", which would let a
 *      provider believe STOPs were being honoured.
 *   2. Each message is normalised to E.164 and classified. Anything that is not
 *      a keyword is dropped without being stored: a free-text reply is the
 *      buyer's words, not ours to keep.
 *   3. `sms_apply_opt_keyword` applies it, deduped on the provider's message
 *      id. A storage failure answers 500 so the provider redelivers; the dedupe
 *      makes that safe.
 *
 * Phone numbers never reach the logs.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  const provider = inboundSmsProvider(providerName);
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large." }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Too large." }, { status: 413 });
  }

  const verified = provider.verify({ headers: request.headers, rawBody, url: new URL(request.url) });
  if (verified === "not_configured") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (verified !== "ok") return NextResponse.json({ error: "Invalid signature." }, { status: 401 });

  const messages = provider.parse({ rawBody, contentType: request.headers.get("content-type") });
  if (!messages) return NextResponse.json({ error: "Unrecognised payload." }, { status: 400 });

  const admin = createAdminClient();
  let applied = 0;
  let ignored = 0;
  let duplicates = 0;

  for (const message of messages) {
    const phone = normalizeSmsPhone(message.from);
    const { action, keyword } = classifySmsKeyword(message.text);
    if (!phone || action === "ignored") {
      ignored += 1;
      continue;
    }
    const result = await applySmsOptKeyword(admin, {
      phone,
      action,
      source: "inbound_sms",
      keyword,
      provider: provider.name,
      providerMessageId: message.messageId,
    });
    if (!result.ok) {
      console.error("[sms/inbound] could not apply a keyword", { provider: provider.name, action, error: result.error });
      return NextResponse.json({ error: "Storage failed." }, { status: 500 });
    }
    if (result.duplicate) duplicates += 1;
    else applied += 1;
  }

  return NextResponse.json({ ok: true, applied, duplicates, ignored });
}
