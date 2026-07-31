import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { summariseEarnings } from "@/lib/payouts/balance";
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

  const [{ data: orders }, { data: payouts }, { data: settlement }] = await Promise.all([
    supabase
      .from("orders")
      .select("total_minor,currency,payment_method,payment_status")
      .eq("seller_account_id", actor.sellerAccountId)
      .in("payment_status", ["paid", "pending", "offline_due", "refunded"]),
    supabase
      .from("payout_requests")
      .select("id,reference,amount_minor,currency,status,review_reason,created_at")
      .eq("seller_account_id", actor.sellerAccountId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("settlement_profiles")
      .select("bank_name,account_last4,status")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("provider", "paystack")
      .maybeSingle(),
  ]);

  const currency = (orders?.[0]?.currency ??
    (actor.country === "NG" ? "NGN" : actor.country === "CI" ? "XOF" : "GHS")) as CurrencyCode;
  const earnings = summariseEarnings(
    (orders ?? []).map((order) => ({
      totalMinor: order.total_minor,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
    })),
  );
  const destinationLabel = settlement
    ? `${settlement.bank_name} •••${settlement.account_last4}`
    : null;

  // Requesting a payout is disabled, so this list can only ever hold rows from
  // the old flow. Rendering an empty "your requests will appear here" panel
  // would advertise something the seller can no longer do.
  const hasHistory = Boolean(payouts?.length);

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Balance & payouts"
        sub="What you've earned, what's pending, and where it goes."
      />

      <div className={`grid items-start gap-4 ${hasHistory ? "lg:grid-cols-[1.2fr_1fr]" : ""}`}>
        <div className="grid gap-4">
          {/* Where the money actually is */}
          <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper">
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,152,111,0.22)_0%,transparent_55%)]"
            />
            <div className="relative">
              <p className="mb-1.5 text-[12.5px] font-semibold text-[#B8AEA1]">
                Paid orders, all time
              </p>
              <p className="font-serif text-[clamp(32px,4vw,40px)] font-medium tracking-[-0.01em]">
                {formatMoney(earnings.totalPaidMinor, currency)}
              </p>
              <p className="mt-3 text-[12px] text-[#B8AEA1]">
                {destinationLabel
                  ? `Online sales settle to ${destinationLabel}${settlement?.status === "active" ? " · Verified" : ""}`
                  : "Add settlement details in onboarding so Paystack can pay you."}
              </p>
            </div>
          </div>

          {/* The breakdown is the point: these two are already in different
              places, and lumping them into one "available balance" is what made
              the old page claim money was withdrawable when it was not. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="p-4">
              <p className="text-[12px] font-semibold text-ink-muted">Settled by Paystack</p>
              <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                {formatMoney(earnings.settledOnlineMinor, currency)}
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                Card and mobile money orders. Paystack pays this to your bank on its own settlement
                schedule, less its charges — SnapDuka never holds it.
              </p>
            </Panel>
            <Panel className="p-4">
              <p className="text-[12px] font-semibold text-ink-muted">Collected by you</p>
              <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                {formatMoney(earnings.collectedOfflineMinor, currency)}
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                Cash on delivery and pay on pickup. You took this money directly, so there is
                nothing to pay out.
              </p>
            </Panel>
            <Panel className="p-4">
              <p className="text-[12px] font-semibold text-ink-muted">Awaiting payment</p>
              <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                {formatMoney(earnings.awaitingPaymentMinor, currency)}
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                Orders placed but not yet paid.
              </p>
            </Panel>
            {earnings.refundedMinor > 0 ? (
              <Panel className="p-4">
                <p className="text-[12px] font-semibold text-ink-muted">Refunded</p>
                <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                  {formatMoney(earnings.refundedMinor, currency)}
                </p>
                <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                  Returned to buyers.
                </p>
              </Panel>
            ) : null}
          </div>

          <Panel className="p-4.5">
            <h2 className="mb-1.5 text-[14px] font-bold">How you get paid</h2>
            <p className="text-[12.5px] leading-[1.6] text-ink-soft">
              SnapDuka does not hold your money. Online payments go into your own Paystack account
              and Paystack settles them to your bank; offline orders you collect yourself. There is
              no payout to request — if an online sale has not reached your bank, that is a Paystack
              settlement question.
            </p>
          </Panel>
        </div>

        {hasHistory ? (
          <Panel className="overflow-hidden">
            <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
              Past payout requests
            </h2>
            {payouts!.map((payout) => {
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
            })}
          </Panel>
        ) : null}
      </div>
    </main>
  );
}
