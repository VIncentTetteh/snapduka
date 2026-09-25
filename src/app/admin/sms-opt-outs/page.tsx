import { ActionBanner } from "@/components/ui/action-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireOperator } from "@/lib/auth/require-operator";
import { createAdminClient } from "@/lib/supabase/admin";

import { addSmsOptOutAction } from "./actions";

export const dynamic = "force-dynamic";

/** Bounded explicitly: an unbounded read is silently capped at db.max_rows. */
const RECENT_LIMIT = 50;

/** "+233201234567" -> "+233 •••• 4567": enough to confirm a caller's number. */
function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)} •••• ${phone.slice(-4)}`;
}

const inputClass =
  "h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent";

export default async function AdminSmsOptOutsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  // The layout redirects a non-operator; this is the handler's own check,
  // because every query below runs through the service-role client.
  await requireOperator("/admin/sms-opt-outs");
  const params = await searchParams;
  const admin = createAdminClient();
  const [{ count: optedOut }, { data: recent }] = await Promise.all([
    admin.from("sms_opt_outs").select("phone", { count: "exact", head: true }).eq("opted_out", true),
    admin
      .from("sms_opt_outs")
      .select("phone,opted_out,source,keyword,opted_out_at,opted_in_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <ActionBanner error={params.error} saved={params.saved ? "Opt-out saved." : undefined} />

      <PageHeader
        title="SMS opt-outs"
        sub={`Numbers that will not receive marketing SMS from any shop. ${optedOut ?? 0} opted out. Order updates, sign-in codes and delivery codes are never suppressed.`}
      />

      <Panel className="mb-4 p-4.5">
        <h2 className="mb-1 text-[15px] font-bold text-ink">Opt a number out</h2>
        <p className="mb-3 text-[12.5px] text-ink-soft">
          For a buyer who asked support rather than replying STOP. Applies to every shop and withdraws each
          shop&apos;s marketing consent for the number. Only the buyer can opt back in, by texting START.
        </p>
        <form action={addSmsOptOutAction} className="grid gap-2.5 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="optout-phone">
            Phone (international format)
            <input className={inputClass} id="optout-phone" inputMode="tel" name="phone" placeholder="+233201234567" required />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="optout-reason">
            Reason (required)
            <input className={inputClass} id="optout-reason" name="reason" placeholder="e.g. Asked by phone, ticket #123" required />
          </label>
          <SubmitButton className="btn-primary" pendingLabel="Saving…">Opt out</SubmitButton>
        </form>
      </Panel>

      {!recent?.length ? (
        <EmptyState title="No opt-outs yet" body="Numbers that reply STOP, or that you opt out here, appear in this list." />
      ) : (
        <Panel className="overflow-hidden">
          {recent.map((row) => (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 last:border-b-0" key={row.phone}>
              <span className="font-mono text-[13px] text-ink">{maskPhone(row.phone)}</span>
              <span className="text-[12.5px] text-ink-soft">
                {row.opted_out ? "Opted out" : "Re-subscribed"} · {row.source === "operator" ? "by an operator" : `replied ${row.keyword ?? "a keyword"}`} ·{" "}
                {new Date(row.updated_at).toLocaleString()}
              </span>
            </div>
          ))}
        </Panel>
      )}
    </main>
  );
}
