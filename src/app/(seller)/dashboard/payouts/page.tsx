import { PayoutRequestForm } from "@/components/seller/payout-request-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import {
  calculateAvailableBalance,
  type PayoutRecord,
} from "@/lib/payouts/balance";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const PAYOUT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Awaiting approval", tone: "warn" },
  approved: { label: "Processing", tone: "neutral" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

export default async function PayoutsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();

  const [{ data: paidOrders }, { data: payouts }, { data: settlement }, { data: pendingOrders }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("total_minor,currency")
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("payment_status", "paid"),
      supabase
        .from("payout_requests")
        .select("id,reference,amount_minor,fee_minor,currency,status,review_reason,created_at")
        .eq("seller_account_id", actor.sellerAccountId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("settlement_profiles")
        .select("bank_name,account_last4,status")
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("provider", "paystack")
        .maybeSingle(),
      supabase
        .from("orders")
        .select("total_minor")
        .eq("seller_account_id", actor.sellerAccountId)
        .in("payment_status", ["pending", "offline_due"]),
    ]);

  const currency = (paidOrders?.[0]?.currency ??
    (actor.country === "NG" ? "NGN" : actor.country === "CI" ? "XOF" : "GHS")) as CurrencyCode;
  const available = calculateAvailableBalance({
    paidOrdersTotalMinor: paidOrders?.reduce((sum, order) => sum + order.total_minor, 0) ?? 0,
    payouts: (payouts ?? []).map(
      (payout): PayoutRecord => ({
        amountMinor: payout.amount_minor,
        feeMinor: payout.fee_minor,
        status: payout.status as PayoutRecord["status"],
      }),
    ),
  });
  const pendingSettlement = pendingOrders?.reduce((sum, order) => sum + order.total_minor, 0) ?? 0;
  const destinationLabel = settlement
    ? `${settlement.bank_name} •••${settlement.account_last4}`
    : null;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Balance & payouts"
        sub="What you've earned, what's pending, and where it goes."
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-4">
          {/* Balance card */}
          <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper">
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,152,111,0.22)_0%,transparent_55%)]"
            />
            <div className="relative">
              <p className="mb-1.5 text-[12.5px] font-semibold text-[#B8AEA1]">Available balance</p>
              <p className="font-serif text-[clamp(32px,4vw,40px)] font-medium tracking-[-0.01em]">
                {formatMoney(available, currency)}
              </p>
              {pendingSettlement > 0 ? (
                <p className="mt-2 text-[12.5px] text-[#B8AEA1]">
                  + {formatMoney(pendingSettlement, currency)} pending settlement
                </p>
              ) : null}
              <p className="mt-3 text-[12px] text-[#B8AEA1]">
                {destinationLabel
                  ? `Payouts go to ${destinationLabel}${settlement?.status === "active" ? " · Verified" : ""}`
                  : "Add settlement details in onboarding to receive payouts."}
              </p>
            </div>
          </div>

          {/* Request payout */}
          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Request a payout</h2>
            <PayoutRequestForm
              availableMinor={available}
              currency={currency}
              destinationLabel={destinationLabel}
            />
          </Panel>
        </div>

        {/* History */}
        <Panel className="overflow-hidden">
          <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
            Payout history
          </h2>
          {!payouts?.length ? (
            <p className="px-4.5 py-8 text-center text-[13px] text-ink-soft">
              No payouts yet — your requests will appear here.
            </p>
          ) : (
            payouts.map((payout) => {
              const spec = PAYOUT_STATUS[payout.status] ?? {
                label: payout.status,
                tone: "neutral" as BadgeTone,
              };
              return (
                <div
                  key={payout.id}
                  className="border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[12.5px] font-semibold text-ink-soft">
                      {payout.reference}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[13.5px] font-bold text-ink">
                        {formatMoney(payout.amount_minor, payout.currency as CurrencyCode)}
                      </span>
                      <Badge tone={spec.tone}>{spec.label}</Badge>
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">
                    {new Date(payout.created_at).toLocaleDateString()}
                    {payout.status === "rejected" && payout.review_reason
                      ? ` · ${payout.review_reason}`
                      : ""}
                  </p>
                </div>
              );
            })
          )}
        </Panel>
      </div>
    </main>
  );
}
