import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

import { respondToPayment } from "./actions";

export const dynamic = "force-dynamic";

export default async function CreatorPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "creator") return null;
  const params = await searchParams;
  const supabase = await createClient();

  const { data: payments } = await supabase
    .from("creator_commission_payments")
    .select("id,reference,amount_minor,currency,method,marked_at,confirmed_at,disputed_at,dispute_note")
    .eq("creator_id", actor.creatorId)
    .order("marked_at", { ascending: false });

  return (
    <main className="sd-main">
      <PageHeader
        title="Payments"
        sub="Confirm what you actually received, so both sides have the same record."
      />

      {params.error ? (
        <div role="alert" className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-[#7A1B10]">
          {params.error}
        </div>
      ) : null}
      {params.message ? (
        <div role="status" className="mb-4 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] text-ink-soft">
          {params.message}
        </div>
      ) : null}

      {(payments ?? []).length === 0 ? (
        <EmptyState
          title="No payments yet"
          body="When a shop records paying you, it appears here for you to confirm."
        />
      ) : (
        <div className="grid gap-2.5">
          {(payments ?? []).map((payment) => {
            const resolved = payment.confirmed_at ?? payment.disputed_at;
            return (
              <Panel key={payment.id} className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-bold text-ink">
                      {formatMoney(payment.amount_minor, payment.currency as CurrencyCode)}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {payment.reference} · {payment.method.replace("_", " ")} ·{" "}
                      {new Date(payment.marked_at).toLocaleDateString()}
                    </p>
                  </div>
                  {payment.disputed_at ? (
                    <Badge tone="danger">you reported a problem</Badge>
                  ) : payment.confirmed_at ? (
                    <Badge tone="success">you confirmed</Badge>
                  ) : (
                    <Badge tone="warn">shop says paid</Badge>
                  )}
                </div>

                {payment.dispute_note ? (
                  <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-soft">
                    You said: {payment.dispute_note}
                  </p>
                ) : null}

                {!resolved ? (
                  <div className="mt-3 grid gap-2 border-t border-line pt-3">
                    <form action={respondToPayment}>
                      <input name="paymentId" type="hidden" value={payment.id} />
                      <input name="action" type="hidden" value="confirm" />
                      <SubmitButton
                        className="h-10 w-full cursor-pointer rounded-[10px] border-none bg-accent text-[13.5px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                        pendingLabel="Confirming…"
                      >
                        I received this
                      </SubmitButton>
                    </form>
                    <form action={respondToPayment} className="grid gap-2">
                      <input name="paymentId" type="hidden" value={payment.id} />
                      <input name="action" type="hidden" value="dispute" />
                      <input
                        className={inputClasses()}
                        name="note"
                        placeholder="What went wrong? The shop will see this."
                        required
                      />
                      <SubmitButton
                        className="h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white text-[13px] font-semibold text-ink-soft hover:border-danger hover:text-danger disabled:cursor-wait"
                        pendingLabel="Sending…"
                      >
                        Report a problem
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </main>
  );
}
