import { ActionBanner } from "@/components/ui/action-banner";
import Link from "next/link";
import { notFound } from "next/navigation";

import { addCaseMessageAction, resolveCaseAction } from "@/app/admin/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const CASE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  opened: { label: "Open", tone: "warn" },
  seller_response_due: { label: "Awaiting seller", tone: "warn" },
  under_review: { label: "Escalated", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

const ACTOR_LABEL: Record<string, string> = {
  buyer: "Buyer",
  seller: "Seller",
  admin: "Operator",
  system: "System",
};

type CaseMessage = {
  id: string;
  body: string;
  actor_type: string;
  operator_only: boolean;
  created_at: string;
};

export default async function AdminCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { caseId } = await params;
  const params_ = await searchParams;
  const { data: item } = await createAdminClient()
    .from("support_cases")
    .select(
      "*,orders(id,public_reference,total_minor,currency,payment_status,buyer_snapshot),seller_accounts(id,contact_name),case_messages(*)",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!item) notFound();

  const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
  const seller = Array.isArray(item.seller_accounts)
    ? item.seller_accounts[0]
    : item.seller_accounts;
  const buyer = (order?.buyer_snapshot ?? {}) as { name?: string };
  const spec = CASE_STATUS[item.status] ?? { label: item.status, tone: "neutral" as BadgeTone };
  const messages = ((item.case_messages ?? []) as CaseMessage[])
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const isOpen = !["resolved", "closed"].includes(item.status);

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <ActionBanner error={params_.error} saved={params_.saved} />

      <Link
        href="/admin/cases"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted no-underline hover:text-ink"
      >
        ← Cases
      </Link>
      <PageHeader
        eyebrow={order?.public_reference ? `Order #${order.public_reference}` : "Support case"}
        title={String(item.reason).replace(/_/g, " ")}
        sub={`Buyer ${buyer.name ?? "—"} · Seller ${seller?.contact_name ?? "—"}`}
        actions={<Badge tone={spec.tone}>{spec.label}</Badge>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Thread */}
        <div className="grid gap-4">
          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Thread</h2>
            <div className="mb-3 rounded-[11px] border border-line bg-raised px-3.5 py-3">
              <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
                Buyer · case description
              </p>
              <p className="text-[13.5px] leading-[1.6] text-ink-2">{item.description}</p>
            </div>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`mb-2.5 rounded-[11px] px-3.5 py-3 last:mb-0 ${
                  message.operator_only
                    ? "border border-dashed border-danger-line bg-danger-tint/50"
                    : "border border-line bg-white"
                }`}
              >
                <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
                  {message.operator_only
                    ? "Internal note · not visible to buyer or seller"
                    : (ACTOR_LABEL[message.actor_type] ?? message.actor_type)}
                  {" · "}
                  {new Date(message.created_at).toLocaleString()}
                </p>
                <p className="text-[13.5px] leading-[1.6] text-ink-2">{message.body}</p>
              </div>
            ))}
          </Panel>

          {/* Reply composer */}
          {isOpen ? (
            <Panel className="p-4.5">
              <h2 className="mb-3 text-[14px] font-bold">Reply or add a note</h2>
              <form action={addCaseMessageAction} className="grid gap-3">
                <input name="caseId" type="hidden" value={item.id} />
                <textarea
                  name="body"
                  required
                  rows={3}
                  aria-label="Message"
                  placeholder="Visible to both parties unless marked internal…"
                  className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
                <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-2">
                  <input
                    name="operatorOnly"
                    type="checkbox"
                    className="h-[16px] w-[16px] accent-[#B42318]"
                  />
                  Internal note — operators only
                </label>
                <SubmitButton
                  className="min-h-10 cursor-pointer justify-self-start rounded-[10px] border-none bg-ink px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Posting…"
                >
                  Post message
                </SubmitButton>
              </form>
            </Panel>
          ) : null}
        </div>

        {/* Context + resolve */}
        <div className="grid gap-4">
          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Context</h2>
            <dl className="grid gap-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-ink-muted">Order</dt>
                <dd className="m-0 font-bold text-ink">
                  {order?.public_reference ? `#${order.public_reference}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-ink-muted">Amount</dt>
                <dd className="m-0 font-bold text-ink">
                  {order
                    ? formatMoney(order.total_minor, order.currency as CurrencyCode)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-ink-muted">Payment</dt>
                <dd className="m-0 capitalize text-ink">{order?.payment_status ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-ink-muted">Opened</dt>
                <dd className="m-0 text-ink">{new Date(item.created_at).toLocaleString()}</dd>
              </div>
            </dl>
            {seller ? (
              <Link
                href={`/admin/sellers/${seller.id}`}
                className="mt-4 inline-flex min-h-10 items-center rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]"
              >
                Review seller &amp; risk actions →
              </Link>
            ) : null}
          </Panel>

          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Resolve</h2>
            <form action={resolveCaseAction} className="grid gap-3">
              <input name="caseId" type="hidden" value={item.id} />
              <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="case-status">
                Move case to
                <select
                  id="case-status"
                  name="status"
                  className="h-11 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none focus:border-accent"
                >
                  <option value="under_review">Under review</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed — resolved between parties</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="resolution">
                Resolution (required to resolve)
                <textarea
                  id="resolution"
                  name="resolution"
                  rows={3}
                  placeholder="Buyer-visible outcome, e.g. refund issued via Paystack"
                  className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </label>
              <SubmitButton
                className="min-h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
                pendingLabel="Updating…"
              >
                Update case
              </SubmitButton>
              <p className="m-0 text-[11.5px] leading-[1.5] text-ink-muted">
                Refunds for Paystack orders are issued from the payments dashboard and reconciled
                automatically via webhook.
              </p>
            </form>
          </Panel>
        </div>
      </div>
    </main>
  );
}
