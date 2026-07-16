import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CASE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  opened: { label: "Open", tone: "warn" },
  seller_response_due: { label: "Awaiting seller", tone: "warn" },
  under_review: { label: "Escalated", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || ["resolved", "closed"].includes(status)) return false;
  return new Date(dueAt).getTime() < Date.now();
}

function ageLabel(iso: string) {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function AdminCasesPage() {
  const { data: cases } = await createAdminClient()
    .from("support_cases")
    .select(
      "id,reason,status,created_at,response_due_at,orders(public_reference),seller_accounts(contact_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Support cases"
        sub="Buyer–seller mediation. Escalate, resolve, and record every decision."
      />

      {!cases?.length ? (
        <EmptyState title="No cases" body="Buyer support requests land here." />
      ) : (
        <Panel className="overflow-hidden">
          {cases.map((item) => {
            const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
            const seller = Array.isArray(item.seller_accounts)
              ? item.seller_accounts[0]
              : item.seller_accounts;
            const spec = CASE_STATUS[item.status] ?? {
              label: item.status,
              tone: "neutral" as BadgeTone,
            };
            const overdue = isOverdue(item.response_due_at, item.status);

            return (
              <Link
                key={item.id}
                href={`/admin/cases/${item.id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3.5 no-underline transition-colors last:border-b-0 hover:bg-paper"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold capitalize text-ink">
                    {String(item.reason).replace(/_/g, " ")}
                    {order?.public_reference ? ` · #${order.public_reference}` : ""}
                  </span>
                  <span className="block text-[12px] text-ink-muted">
                    Seller {seller?.contact_name ?? "—"} · opened {ageLabel(item.created_at)} ago
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                  <Badge tone={spec.tone}>{spec.label}</Badge>
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </main>
  );
}
