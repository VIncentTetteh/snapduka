import { reviewPayoutAction } from "@/app/admin/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills } from "@/components/ui/filter-pills";
import { PageHeader, Panel } from "@/components/ui/surface";
import { FormActionButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const FILTERS = [
  { label: "Pending", value: "" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Paid", value: "paid" },
];

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Awaiting approval", tone: "warn" },
  approved: { label: "Processing", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  paid: { label: "Paid", tone: "success" },
};

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const filters = await searchParams;
  const status = FILTERS.some((f) => f.value === filters.status) ? (filters.status ?? "") : "";
  const admin = createAdminClient();

  const { data: payouts } = await admin
    .from("payout_requests")
    .select(
      "id,reference,amount_minor,fee_minor,currency,status,destination,review_reason,created_at,seller_accounts(id,contact_name,created_at,status)",
    )
    .eq("status", status || "requested")
    .order("created_at", { ascending: true })
    .limit(50);

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Payout approvals"
        sub="Every decision requires an operational reason and is written to the audit log."
      />

      {filters.error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {filters.error}
        </div>
      ) : null}

      <div className="mb-4">
        <FilterPills
          pills={FILTERS.map((f) => ({
            label: f.label,
            href: f.value ? `/admin/payouts?status=${f.value}` : "/admin/payouts",
            active: status === f.value,
          }))}
        />
      </div>

      {!payouts?.length ? (
        <EmptyState
          title="Queue clear"
          body="No payout requests in this state."
        />
      ) : (
        <div className="grid gap-3.5">
          {payouts.map((payout) => {
            const seller = payout.seller_accounts as
              | { id: string; contact_name?: string; created_at?: string; status?: string }
              | { id: string; contact_name?: string; created_at?: string; status?: string }[]
              | null;
            const sellerRow = Array.isArray(seller) ? seller[0] : seller;
            const destination = payout.destination as {
              bankName?: string;
              accountLast4?: string;
            } | null;
            const spec = STATUS[payout.status] ?? { label: payout.status, tone: "neutral" as BadgeTone };
            const risk =
              sellerRow?.status === "suspended"
                ? { label: "High risk", tone: "danger" as BadgeTone }
                : sellerRow?.status === "restricted"
                  ? { label: "Elevated", tone: "warn" as BadgeTone }
                  : { label: "Low risk", tone: "success" as BadgeTone };
            const reviewable = payout.status === "requested" || payout.status === "approved";

            return (
              <Panel key={payout.id} className="p-4.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-bold text-ink">
                        {payout.reference}
                      </span>
                      <Badge tone={spec.tone}>{spec.label}</Badge>
                      <Badge tone={risk.tone}>{risk.label}</Badge>
                    </p>
                    <p className="mt-1 text-[13px] text-ink-soft">
                      {sellerRow?.contact_name ?? "Seller"}
                      {destination?.bankName
                        ? ` · ${destination.bankName} •••${destination.accountLast4 ?? ""}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      Requested {new Date(payout.created_at).toLocaleString()}
                      {sellerRow?.created_at
                        ? ` · Seller since ${new Date(sellerRow.created_at).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-serif text-[22px] font-medium text-ink">
                      {formatMoney(payout.amount_minor, payout.currency as CurrencyCode)}
                    </p>
                    <p className="text-[11.5px] text-ink-muted">
                      Fee {formatMoney(payout.fee_minor, payout.currency as CurrencyCode)} · pays{" "}
                      {formatMoney(
                        payout.amount_minor - payout.fee_minor,
                        payout.currency as CurrencyCode,
                      )}
                    </p>
                  </div>
                </div>

                {payout.review_reason ? (
                  <p className="mt-3 rounded-[10px] border border-line bg-raised px-3.5 py-2.5 text-[12.5px] text-ink-soft">
                    <strong className="font-bold text-ink">Review note:</strong>{" "}
                    {payout.review_reason}
                  </p>
                ) : null}

                {reviewable ? (
                  <details className="mt-3.5 border-t border-line-soft pt-3.5">
                    <summary className="cursor-pointer list-none text-[13px] font-bold text-accent [&::-webkit-details-marker]:hidden">
                      Review &amp; decide →
                    </summary>
                    <form action={reviewPayoutAction} className="mt-3 grid gap-3">
                      <input name="payoutId" type="hidden" value={payout.id} />
                      <label
                        className="grid gap-1.5 text-[12.5px] font-semibold text-ink"
                        htmlFor={`reason-${payout.id}`}
                      >
                        Operational reason (recorded in the audit log)
                        <textarea
                          id={`reason-${payout.id}`}
                          name="reason"
                          required
                          rows={2}
                          placeholder="e.g. Verified settlement account matches seller identity"
                          className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2.5">
                        {payout.status === "requested" ? (
                          <FormActionButton
                            name="decision"
                            value="approved"
                            pendingLabel="Approving…"
                            className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep disabled:cursor-wait disabled:opacity-60"
                          >
                            Approve &amp; send
                          </FormActionButton>
                        ) : (
                          /* There is deliberately no "mark as paid". Approving
                             sends the transfer; only Paystack's webhook can
                             report that the money arrived. */
                          <p className="text-[12.5px] text-ink-soft">
                            Approved — the transfer is sent automatically and marked paid once
                            Paystack confirms it.
                          </p>
                        )}
                        <FormActionButton
                          name="decision"
                          value="rejected"
                          pendingLabel="Rejecting…"
                          className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                        >
                          Reject
                        </FormActionButton>
                      </div>
                    </form>
                  </details>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </main>
  );
}
