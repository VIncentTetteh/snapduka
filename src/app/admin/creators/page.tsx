import { setCreatorStatusAction } from "@/app/admin/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills } from "@/components/ui/filter-pills";
import { FormActionButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Disputed payments", value: "disputed" },
  { label: "Suspended", value: "suspended" },
];

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
};

/**
 * Operator view of the creator program. Read-mostly: the only write is
 * suspending or reinstating a creator, which is the abuse lever. Settlement
 * stays entirely between seller and creator — SnapDuka is not the payer and
 * must not look like an arbiter of who is owed what.
 */
export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const admin = createAdminClient();

  const [{ data: creators }, { data: partnerships }, { data: commissions }, { data: payments }] =
    await Promise.all([
      admin
        .from("creators")
        .select("id,handle,display_name,country,status,contact_phone,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      admin.from("creator_partnerships").select("creator_id,status,rate_bps"),
      admin.from("creator_commissions").select("creator_id,status,amount_minor,currency"),
      admin
        .from("creator_commission_payments")
        .select("id,creator_id,amount_minor,currency,marked_at,disputed_at,dispute_note")
        .not("disputed_at", "is", null)
        .order("disputed_at", { ascending: false }),
    ]);

  const byCreator = new Map<
    string,
    { partnerships: number; earnedMinor: number; paidMinor: number; disputes: number; currency: CurrencyCode }
  >();
  const bump = (id: string) =>
    byCreator.get(id) ??
    byCreator.set(id, { partnerships: 0, earnedMinor: 0, paidMinor: 0, disputes: 0, currency: "GHS" }).get(id)!;

  for (const row of partnerships ?? []) bump(row.creator_id).partnerships += 1;
  for (const row of commissions ?? []) {
    const entry = bump(row.creator_id);
    entry.currency = row.currency as CurrencyCode;
    if (row.status !== "reversed" && row.status !== "void") entry.earnedMinor += row.amount_minor;
    if (row.status === "paid") entry.paidMinor += row.amount_minor;
  }
  for (const row of payments ?? []) bump(row.creator_id).disputes += 1;

  const disputedIds = new Set((payments ?? []).map((row) => row.creator_id));
  const filtered = (creators ?? []).filter((creator) => {
    if (params.status === "disputed") return disputedIds.has(creator.id);
    if (params.status === "suspended") return creator.status === "suspended";
    return true;
  });

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Creators"
        sub="Third parties earning commission from seller shops. Suspend only for abuse."
      />

      <div className="mb-4">
        <FilterPills
          pills={FILTERS.map((filter) => ({
            label: filter.label,
            href: filter.value ? `/admin/creators?status=${filter.value}` : "/admin/creators",
            active: (params.status ?? "") === filter.value,
          }))}
        />
      </div>

      {/* Disputes are the signal worth surfacing: SnapDuka records a seller's
          claim that they paid, and this is where a pattern of that claim being
          wrong becomes visible. */}
      {(payments ?? []).length > 0 ? (
        <Panel className="mb-5 px-3.5 py-3">
          <h2 className="mb-2 text-[13.5px] font-bold text-danger">
            {(payments ?? []).length} disputed {(payments ?? []).length === 1 ? "payment" : "payments"}
          </h2>
          <ul className="grid gap-2">
            {(payments ?? []).slice(0, 10).map((payment) => (
              <li key={payment.id} className="border-b border-line pb-2 text-[12.5px] last:border-0">
                <span className="font-semibold text-ink">
                  {formatMoney(payment.amount_minor, payment.currency as CurrencyCode)}
                </span>{" "}
                <span className="text-ink-muted">
                  · marked paid {new Date(payment.marked_at).toLocaleDateString()}
                </span>
                {payment.dispute_note ? (
                  <p className="mt-0.5 text-ink-soft">“{payment.dispute_note}”</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No creators" body="Creators appear here once a seller invites one and they accept." />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                  <th className="pb-2 font-bold">Creator</th>
                  <th className="pb-2 font-bold">Shops</th>
                  <th className="pb-2 font-bold">Earned</th>
                  <th className="pb-2 font-bold">Paid</th>
                  <th className="pb-2 font-bold">Disputes</th>
                  <th className="pb-2 font-bold">Status</th>
                  <th className="pb-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((creator) => {
                  const stats = byCreator.get(creator.id) ?? {
                    partnerships: 0, earnedMinor: 0, paidMinor: 0, disputes: 0, currency: "GHS" as CurrencyCode,
                  };
                  const status = STATUS[creator.status] ?? STATUS.active;
                  return (
                    <tr key={creator.id} className="border-b border-line last:border-0">
                      <td className="py-2">
                        <p className="font-semibold text-ink">{creator.display_name}</p>
                        <p className="text-[11.5px] text-ink-muted">@{creator.handle} · {creator.country}</p>
                      </td>
                      <td className="py-2 text-ink-soft">{stats.partnerships}</td>
                      <td className="py-2 text-ink-soft">{formatMoney(stats.earnedMinor, stats.currency)}</td>
                      <td className="py-2 text-ink-soft">{formatMoney(stats.paidMinor, stats.currency)}</td>
                      <td className="py-2">
                        {stats.disputes > 0 ? (
                          <Badge tone="danger">{stats.disputes}</Badge>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="py-2"><Badge tone={status.tone}>{status.label}</Badge></td>
                      <td className="py-2 text-right">
                        <form action={setCreatorStatusAction} className="inline-flex items-center gap-1.5">
                          <input name="creatorId" type="hidden" value={creator.id} />
                          <input
                            className="h-8 w-32 rounded-[8px] border border-line-input px-2 text-[12px]"
                            name="reason"
                            placeholder="Reason"
                            required
                          />
                          <FormActionButton
                            className="cursor-pointer rounded-[8px] border border-line-strong bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:border-danger hover:text-danger disabled:opacity-60"
                            name="status"
                            pendingLabel="…"
                            value={creator.status === "suspended" ? "active" : "suspended"}
                          >
                            {creator.status === "suspended" ? "Reinstate" : "Suspend"}
                          </FormActionButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}
