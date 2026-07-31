import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/** Rows claimed longer ago than this are assumed to have crashed mid-call. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Sends approved withdrawals, and recovers the ones that crashed.
 *
 * Three phases per payout — claim, call, record — because the failure that
 * matters is dying between calling Paystack and writing the result. The
 * transfer carries our own PO- reference, so Paystack dedupes a retry and the
 * sweeper below can simply ask what happened. That makes this strictly safer
 * than the subaccount creation path it is modelled on, which can only retry
 * blindly and then give up.
 *
 * Recording a transfer posts NO ledger entries. A 'pending' transfer is not
 * evidence money moved — Ghanaian bank and mobile money transfers fail
 * asynchronously — so only the transfer.success webhook settles the books.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();

  const recovered = await sweepStaleClaims(admin);
  const { sent, failed } = await sendApproved(admin);

  return NextResponse.json({ sent, failed, recovered });
}

async function sendApproved(admin: Admin) {
  const { data: approved } = await admin
    .from("payout_requests")
    .select("id")
    .eq("status", "approved")
    .order("created_at")
    .limit(20);

  let sent = 0;
  const failed: string[] = [];

  for (const row of approved ?? []) {
    // Phase 1: exclusive claim. A second worker gets zero rows and moves on.
    const { data: claimed } = await admin
      .rpc("claim_payout_for_transfer", { p_payout_id: row.id })
      .maybeSingle();
    if (!claimed) continue;

    const claim = claimed as {
      payout_id: string;
      reference: string;
      net_minor: number;
      currency: string;
      recipient_code: string | null;
    };
    if (!claim.recipient_code) {
      await admin.rpc("release_payout_claim", {
        p_payout_id: claim.payout_id,
        p_reason: "Payout destination has no provider recipient.",
      });
      failed.push(claim.payout_id);
      continue;
    }

    try {
      // Phase 2: the provider call.
      const transfer = await paystackProvider().createTransfer({
        amountMinor: claim.net_minor,
        recipientCode: claim.recipient_code,
        reference: claim.reference,
        currency: claim.currency,
      });

      // Phase 3: record what it said. Still no money movement in the ledger.
      await admin.rpc("record_payout_transfer", {
        p_payout_id: claim.payout_id,
        p_transfer_code: transfer.transferCode,
        p_transfer_id: transfer.transferId,
        p_provider_status: transfer.status,
      });

      if (transfer.status === "otp") {
        // The integration still requires per-transfer OTP confirmation. Never
        // attempt to solve it automatically — stop loudly instead, so a setting
        // changed at Paystack surfaces as a halt rather than stranded money.
        console.error(
          `[payouts] transfer ${claim.reference} requires OTP; payouts are misconfigured at Paystack`,
        );
        failed.push(claim.payout_id);
        continue;
      }
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transfer failed";
      // A network error is not evidence the transfer did not happen. Only
      // release the claim when Paystack itself refused; otherwise leave the row
      // in 'processing' for the sweeper to resolve against the provider.
      if (/insufficient|balance|invalid|recipient|not found/i.test(message)) {
        await admin.rpc("release_payout_claim", {
          p_payout_id: claim.payout_id,
          p_reason: message.slice(0, 300),
        });
      }
      console.error(`[payouts] transfer failed for ${claim.reference}: ${message}`);
      failed.push(claim.payout_id);
    }
  }

  return { sent, failed: failed.length };
}

/**
 * Resolves payouts that were claimed but have no provider transfer recorded —
 * the crash-between-call-and-write case. Asks Paystack rather than guessing.
 */
async function sweepStaleClaims(admin: Admin) {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: stale } = await admin
    .from("payout_requests")
    .select("id,reference")
    .eq("status", "processing")
    .is("provider_transfer_code", null)
    .lt("claimed_at", cutoff)
    .limit(20);

  let recovered = 0;
  for (const row of stale ?? []) {
    try {
      const transfer = await paystackProvider().verifyTransfer(row.reference);
      await admin.rpc("record_payout_transfer", {
        p_payout_id: row.id,
        p_transfer_code: transfer.transferCode,
        p_transfer_id: transfer.transferId,
        p_provider_status: transfer.status,
      });
      recovered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      // Paystack has never heard of this reference, so the transfer was never
      // created and the claim can safely go back to the queue.
      if (/not found|could not resolve/i.test(message)) {
        await admin.rpc("release_payout_claim", {
          p_payout_id: row.id,
          p_reason: "Provider has no record of this transfer; requeued.",
        });
        recovered++;
      } else {
        console.error(`[payouts] could not resolve stale transfer ${row.reference}: ${message}`);
      }
    }
  }
  return recovered;
}

export const GET = POST;
