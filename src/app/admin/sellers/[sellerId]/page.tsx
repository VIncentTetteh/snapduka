import Link from "next/link";
import { notFound } from "next/navigation";

import { applyRiskAction, approveVerificationAction, setDiscoveryRemovalAction } from "@/app/admin/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { PageHeader, Panel } from "@/components/ui/surface";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const RISK_ACTIONS = [
  { value: "warning", label: "Send warning", danger: false },
  { value: "require_verification", label: "Require re-verification", danger: false },
  { value: "restrict_payments", label: "Restrict payments", danger: true },
  { value: "suspend", label: "Suspend store", danger: true },
  { value: "remove", label: "Remove from platform", danger: true },
];

export default async function AdminSellerPage({
  params,
}: {
  params: Promise<{ sellerId: string }>;
}) {
  const { sellerId } = await params;
  const admin = createAdminClient();
  const [
    { data: seller },
    { data: actions },
    { data: paidOrders },
    { count: openCases },
    { data: discoveryPreference },
  ] = await Promise.all([
      admin
        .from("seller_accounts")
        .select(
          "id,contact_name,contact_email,status,country,created_at,shops(display_name,slug,status),seller_verifications(state),payment_subaccounts(status)",
        )
        .eq("id", sellerId)
        .maybeSingle(),
      admin
        .from("risk_actions")
        .select("*")
        .eq("seller_account_id", sellerId)
        .order("created_at", { ascending: false }),
      admin
        .from("orders")
        .select("total_minor,currency")
        .eq("seller_account_id", sellerId)
        .eq("payment_status", "paid"),
      admin
        .from("support_cases")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", sellerId)
        .in("status", ["opened", "seller_response_due", "under_review"]),
      admin
        .from("discovery_preferences")
        .select("opted_in,operator_removed_at")
        .eq("seller_account_id", sellerId)
        .maybeSingle(),
    ]);
  if (!seller) notFound();

  const shop = Array.isArray(seller.shops) ? seller.shops[0] : seller.shops;
  const verification = Array.isArray(seller.seller_verifications)
    ? seller.seller_verifications[0]
    : seller.seller_verifications;
  const verificationState = (verification as { state?: string } | null)?.state ?? "not_started";
  const currency = (paidOrders?.[0]?.currency ?? "GHS") as CurrencyCode;
  const gmv = paidOrders?.reduce((sum, order) => sum + order.total_minor, 0) ?? 0;
  const statusTone: BadgeTone =
    seller.status === "active" ? "success" : seller.status === "suspended" ? "danger" : "warn";

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <Link
        href="/admin/sellers"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted no-underline hover:text-ink"
      >
        ← Sellers
      </Link>
      <PageHeader
        eyebrow="Seller risk review"
        title={shop?.display_name ?? seller.contact_name}
        sub={`${seller.contact_name} · ${seller.contact_email} · ${seller.country}`}
        actions={
          <span className="flex gap-1.5">
            <Badge tone={verificationState === "verified" ? "success" : verificationState === "rejected" ? "danger" : "warn"}>
              {verificationState === "verified"
                ? "Verified"
                : `Verification: ${verificationState.replace(/_/g, " ")}`}
            </Badge>
            <Badge tone={statusTone}>{seller.status}</Badge>
          </span>
        }
      />

      {/* Profile stats */}
      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">GMV · all time</p>
          <p className="font-serif text-[22px] font-medium text-ink">
            {formatMoney(gmv, currency)}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Paid orders</p>
          <p className="font-serif text-[22px] font-medium text-ink">{paidOrders?.length ?? 0}</p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Open cases</p>
          <p className="font-serif text-[22px] font-medium text-ink">{openCases ?? 0}</p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Seller since</p>
          <p className="font-serif text-[22px] font-medium text-ink">
            {new Date(seller.created_at).toLocaleDateString()}
          </p>
        </Panel>
      </div>

      {verificationState !== "verified" ? (
        <Panel className="mb-4 p-4.5">
          <h2 className="mb-1 text-[14px] font-bold text-ink">Verification review</h2>
          <p className="mb-3.5 text-[12.5px] leading-[1.55] text-ink-soft">
            Online payments stay blocked until this seller is verified. Approval activates
            Paystack settlement eligibility and is recorded in the audit log.
          </p>
          <form action={approveVerificationAction} className="grid gap-3">
            <input name="sellerId" type="hidden" value={seller.id} />
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="verify-reason">
              Operational reason (required)
              <textarea
                id="verify-reason"
                name="reason"
                required
                rows={2}
                placeholder="e.g. Business registration and settlement account checked"
                className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="submit"
                name="decision"
                value="verified"
                className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
              >
                Approve verification
              </button>
              <button
                type="submit"
                name="decision"
                value="rejected"
                className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint"
              >
                Reject
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      {discoveryPreference?.opted_in ? (
        <Panel className="mb-4 p-4.5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-bold text-ink">Buyer discovery</h2>
            <Badge tone={discoveryPreference.operator_removed_at ? "danger" : "success"}>
              {discoveryPreference.operator_removed_at ? "Removed by operator" : "Listed"}
            </Badge>
          </div>
          <p className="mb-3.5 text-[12.5px] leading-[1.55] text-ink-soft">
            {discoveryPreference.operator_removed_at
              ? `Removed from the public directory on ${new Date(discoveryPreference.operator_removed_at).toLocaleDateString()}. Restoring re-lists the shop immediately if it is still opted in and published.`
              : "This shop is opted in to the public /discover directory. Removal hides it immediately and is recorded in the audit log."}
          </p>
          <form action={setDiscoveryRemovalAction} className="grid gap-3">
            <input name="sellerId" type="hidden" value={seller.id} />
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="discovery-reason">
              Operational reason (required)
              <textarea
                id="discovery-reason"
                name="reason"
                required
                rows={2}
                placeholder="e.g. Listing violates content policy — counterfeit goods reported"
                className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2.5">
              {discoveryPreference.operator_removed_at ? (
                <button
                  type="submit"
                  name="decision"
                  value="restore"
                  className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
                >
                  Restore listing
                </button>
              ) : (
                <button
                  type="submit"
                  name="decision"
                  value="remove"
                  className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint"
                >
                  Remove from discovery
                </button>
              )}
            </div>
          </form>
        </Panel>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Risk actions */}
        <Panel className="border-danger-line p-4.5">
          <div className="mb-1 flex items-center gap-2.5">
            <InitialsAvatar name={seller.contact_name ?? "?"} className="h-9 w-9 text-[12px]" />
            <h2 className="text-[14px] font-bold text-ink">Risk actions</h2>
          </div>
          <p className="mb-3.5 text-[12.5px] leading-[1.55] text-ink-soft">
            Actions take effect immediately, notify the seller, and are recorded with your name
            and reason in the audit log.
          </p>
          <form action={applyRiskAction} className="grid gap-3">
            <input name="sellerId" type="hidden" value={seller.id} />
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="risk-action">
              Action
              <select
                id="risk-action"
                name="riskAction"
                className="h-11 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none focus:border-accent"
              >
                {RISK_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.danger ? "⚠ " : ""}
                    {action.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="risk-reason">
              Operational reason (required)
              <textarea
                id="risk-reason"
                name="reason"
                required
                rows={3}
                placeholder="Recorded permanently in the audit log"
                className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-[1.5] text-ink-2">
              <input
                name="confirm"
                required
                type="checkbox"
                value="yes"
                className="mt-0.5 h-[17px] w-[17px] accent-[#B42318]"
              />
              I confirm this high-impact action takes effect immediately.
            </label>
            <button
              type="submit"
              className="min-h-11 cursor-pointer rounded-[10px] border-none bg-danger px-4.5 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Apply risk action
            </button>
          </form>
        </Panel>

        {/* Audit history */}
        <Panel className="overflow-hidden">
          <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
            Risk history
          </h2>
          {!actions?.length ? (
            <p className="px-4.5 py-8 text-center text-[13px] text-ink-soft">
              No risk actions recorded for this seller.
            </p>
          ) : (
            actions.map((action) => (
              <div key={action.id} className="border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0">
                <p className="flex items-center gap-2 text-[13px] font-semibold capitalize text-ink">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      ["suspend", "remove", "restrict_payments"].includes(action.action)
                        ? "bg-danger"
                        : "bg-warn"
                    }`}
                  />
                  {String(action.action).replace(/_/g, " ")}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-soft">{action.reason}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {new Date(action.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </Panel>
      </div>
    </main>
  );
}
