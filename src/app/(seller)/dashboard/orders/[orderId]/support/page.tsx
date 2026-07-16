import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

const CASE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  opened: { label: "Open", tone: "warn" },
  seller_response_due: { label: "Your response due", tone: "danger" },
  under_review: { label: "Under review", tone: "warn" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

const ACTOR_LABEL: Record<string, string> = {
  buyer: "Buyer",
  seller: "You",
  admin: "SnapDuka support",
  system: "System",
};

type CaseMessage = {
  id: string;
  body: string;
  actor_type: string;
  operator_only: boolean;
  created_at: string;
};

export default async function SellerSupportPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { orderId } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: item }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, public_reference")
      .eq("id", orderId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("support_cases")
      .select("*, case_messages(*)")
      .eq("order_id", orderId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
  ]);
  if (!order) notFound();

  const spec = item
    ? (CASE_STATUS[item.status] ?? { label: item.status, tone: "neutral" as BadgeTone })
    : null;
  const messages = item
    ? ((item.case_messages ?? []) as CaseMessage[])
        .filter((message) => !message.operator_only)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];

  return (
    <main className="sd-main mx-auto max-w-[840px] px-4 pt-6 sm:px-6">
      <Link
        href={`/dashboard/orders/${orderId}`}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted no-underline hover:text-ink"
      >
        ← Order #{order.public_reference}
      </Link>
      <PageHeader
        eyebrow="Support"
        title={item ? `Case · ${String(item.reason).replace(/_/g, " ")}` : "Support"}
        sub={`Order #${order.public_reference}`}
        actions={spec ? <Badge tone={spec.tone}>{spec.label}</Badge> : undefined}
      />

      {!item ? (
        <EmptyState
          title="No support case for this order"
          body="If the buyer reports a problem from their tracking page, the case and its messages will appear here. Buyers can also reach you directly on WhatsApp."
          action={
            <Link
              href={`/dashboard/orders/${orderId}`}
              className="inline-flex min-h-10 items-center rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]"
            >
              Back to the order
            </Link>
          }
        />
      ) : (
        <Panel className="p-4.5">
          <h2 className="mb-3 text-[14px] font-bold">Thread</h2>
          <div className="mb-3 rounded-[11px] border border-line bg-raised px-3.5 py-3">
            <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
              Buyer · case description
            </p>
            <p className="text-[13.5px] leading-[1.6] text-ink-2">{item.description}</p>
          </div>
          {messages.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No messages yet.</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className="mb-2.5 rounded-[11px] border border-line bg-white px-3.5 py-3 last:mb-0"
              >
                <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
                  {ACTOR_LABEL[message.actor_type] ?? message.actor_type} ·{" "}
                  {new Date(message.created_at).toLocaleString()}
                </p>
                <p className="text-[13.5px] leading-[1.6] text-ink-2">{message.body}</p>
              </div>
            ))
          )}
          {item.resolution ? (
            <p className="mt-3 rounded-[10px] border border-success-line bg-success-tint px-3.5 py-2.5 text-[12.5px] text-[#1F5741]">
              <strong className="font-bold">Resolution:</strong> {item.resolution}
            </p>
          ) : null}
        </Panel>
      )}
    </main>
  );
}
