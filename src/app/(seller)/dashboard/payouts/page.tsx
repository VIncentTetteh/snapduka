import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PayoutDestinationForm } from "@/components/seller/payout-destination-form";
import { PayoutRequestForm } from "@/components/seller/payout-request-form";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { summariseEarnings } from "@/lib/payouts/balance";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const PAYOUT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Awaiting review", tone: "warn" },
  approved: { label: "Queued", tone: "neutral" },
  processing: { label: "Sending", tone: "neutral" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  reversed: { label: "Reversed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  needs_operator: { label: "Needs review", tone: "warn" },
};

export default async function PayoutsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();

  const currency = (actor.country === "NG"
    ? "NGN"
    : actor.country === "CI"
      ? "XOF"
      : "GHS") as CurrencyCode;

  const [{ data: wallet }, { data: orders }, { data: payouts }, { data: destination }, { data: config }] =
    await Promise.all([
      supabase.rpc("seller_wallet_balance", {
        p_seller_account_id: actor.sellerAccountId,
        p_currency: currency,
      }),
      supabase
        .from("orders")
        .select("total_minor,currency,payment_method,payment_status")
        .eq("seller_account_id", actor.sellerAccountId)
        .in("payment_status", ["paid", "pending", "offline_due", "refunded"]),
      supabase
        .from("payout_requests")
        .select("id,reference,amount_minor,fee_minor,currency,status,review_reason,failure_reason,created_at")
        .eq("seller_account_id", actor.sellerAccountId)
        .order("created_at", { ascending: false })
        .limit(50),
      // Through an RPC rather than a table select: the cool-off has to be
      // computed with the database clock (request_seller_payout enforces the
      // same window), and routing it here keeps recipient_code unreadable by
      // construction instead of by remembering to omit it.
      supabase.rpc("seller_payout_destination", {
        p_seller_account_id: actor.sellerAccountId,
      }),
      supabase
        .from("country_configs")
        .select("settlement_mode,payouts_enabled,minimum_payout_minor,payout_fee_minor,payout_hold_days")
        .eq("country", actor.country)
        .maybeSingle(),
    ]);

  const balances = (wallet ?? [])[0] as
    | { pending_minor: number; available_minor: number; reserved_minor: number }
    | undefined;
  const pending = balances?.pending_minor ?? 0;
  const available = balances?.available_minor ?? 0;
  const reserved = balances?.reserved_minor ?? 0;

  // A seller in the legacy split still has money settled directly by Paystack,
  // so showing them a wallet balance of zero would be actively misleading.
  const onLedger = config?.settlement_mode === "ledger";

  const earnings = summariseEarnings(
    (orders ?? []).map((order) => ({
      totalMinor: order.total_minor,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
    })),
  );

  const payoutDestination = (destination ?? [])[0] as
    | {
        bank_name: string;
        account_last4: string;
        destination_type: string;
        resolved_account_name: string | null;
        cooling_off: boolean;
      }
    | undefined;
  const destinationLabel = payoutDestination
    ? `${payoutDestination.bank_name} •••${payoutDestination.account_last4}`
    : null;
  const inArrears = available < 0;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Balance & payouts"
        sub={
          onLedger
            ? "What you've earned, what's ready to withdraw, and where it goes."
            : "What you've earned, what's pending, and where it goes."
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-4">
          <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper">
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,152,111,0.22)_0%,transparent_55%)]"
            />
            <div className="relative">
              <p className="mb-1.5 text-[12.5px] font-semibold text-[#B8AEA1]">
                {onLedger ? "Ready to withdraw" : "Paid orders, all time"}
              </p>
              <p className="font-serif text-[clamp(32px,4vw,40px)] font-medium tracking-[-0.01em]">
                {formatMoney(onLedger ? available : earnings.totalPaidMinor, currency)}
              </p>
              <p className="mt-3 text-[12px] text-[#B8AEA1]">
                {destinationLabel
                  ? `Withdrawals go to ${destinationLabel}`
                  : "Add a payout destination to withdraw."}
              </p>
            </div>
          </div>

          {inArrears ? (
            <Panel className="border-danger/40 bg-danger/5 p-4">
              <h2 className="mb-1 text-[14px] font-bold text-ink">Your balance is negative</h2>
              <p className="text-[12.5px] leading-[1.6] text-ink-soft">
                A refund was returned to a buyer after you had already withdrawn that money, so{" "}
                {formatMoney(Math.abs(available), currency)} is owed back. Nothing is due from you
                directly — it comes off your next sales automatically, and withdrawals resume once
                the balance is positive.
              </p>
            </Panel>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {onLedger ? (
              <>
                <Panel className="p-4">
                  <p className="text-[12px] font-semibold text-ink-muted">Clearing</p>
                  <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                    {formatMoney(pending, currency)}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                    Paid online but still within the {config?.payout_hold_days ?? 3}-day window after
                    delivery. This covers refunds, then becomes withdrawable.
                  </p>
                </Panel>
                {reserved > 0 ? (
                  <Panel className="p-4">
                    <p className="text-[12px] font-semibold text-ink-muted">On its way to you</p>
                    <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                      {formatMoney(reserved, currency)}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                      Withdrawn and being sent to your bank.
                    </p>
                  </Panel>
                ) : null}
              </>
            ) : (
              <Panel className="p-4">
                <p className="text-[12px] font-semibold text-ink-muted">Settled by Paystack</p>
                <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                  {formatMoney(earnings.settledOnlineMinor, currency)}
                </p>
                <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                  Card and mobile money orders, paid to your bank by Paystack on its own schedule.
                </p>
              </Panel>
            )}

            <Panel className="p-4">
              <p className="text-[12px] font-semibold text-ink-muted">Collected by you</p>
              <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">
                {formatMoney(earnings.collectedOfflineMinor, currency)}
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
                Cash on delivery and pay on pickup. You took this money directly, so there is
                nothing to withdraw.
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
          </div>

          {onLedger ? (
            <>
              <PayoutRequestForm
                availableMinor={available}
                currency={currency}
                minimumMinor={config?.minimum_payout_minor ?? 5000}
                feeMinor={config?.payout_fee_minor ?? 100}
                hasDestination={Boolean(payoutDestination)}
                payoutsEnabled={Boolean(config?.payouts_enabled)}
                destinationLabel={destinationLabel}
              />
              <PayoutDestinationForm
                currentLabel={destinationLabel}
                currentAccountName={payoutDestination?.resolved_account_name ?? null}
                coolingOff={Boolean(payoutDestination?.cooling_off)}
              />
            </>
          ) : (
            <Panel className="p-4.5">
              <h2 className="mb-1.5 text-[14px] font-bold">How you get paid</h2>
              <p className="text-[12.5px] leading-[1.6] text-ink-soft">
                Online payments go into your own Paystack account and Paystack settles them to your
                bank; offline orders you collect yourself. There is no withdrawal to request.
              </p>
            </Panel>
          )}
        </div>

        {payouts?.length ? (
          <Panel className="overflow-hidden">
            <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
              Withdrawals
            </h2>
            {payouts.map((payout) => {
              const spec = PAYOUT_STATUS[payout.status] ?? {
                label: payout.status,
                tone: "neutral" as BadgeTone,
              };
              const note = payout.failure_reason ?? payout.review_reason;
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
                    {payout.fee_minor
                      ? ` · ${formatMoney(payout.fee_minor, payout.currency as CurrencyCode)} fee`
                      : ""}
                    {note ? ` · ${note}` : ""}
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
