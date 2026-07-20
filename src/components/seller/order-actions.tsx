"use client";

import { updateOrderAction } from "@/app/(seller)/dashboard/orders/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { canTransitionOrder, type OrderState } from "@/lib/commerce/transitions";

export function OrderActions({ order }: { order: { id: string; status: OrderState; event_version: number; payment_status: string } }) {
  const candidates: OrderState[] = ["confirmed","processing","completed","cancelled"];
  return (
    <div className="flex flex-wrap gap-2">
      {candidates.filter((next) => canTransitionOrder(order.status, next)).map((next) => (
        <form
          action={updateOrderAction}
          key={next}
          onSubmit={next === "cancelled" ? (e) => { if (!confirm("Cancel this order? This cannot be undone.")) e.preventDefault(); } : undefined}
        >
          <input name="orderId" type="hidden" value={order.id} />
          <input name="status" type="hidden" value={next} />
          <input name="version" type="hidden" value={order.event_version} />
          {next === "completed" && order.payment_status === "offline_due" ? (
            <label className="mr-2">
              <input name="offlinePaid" required type="checkbox" value="yes" /> Payment received
            </label>
          ) : null}
          <SubmitButton
            className={next === "cancelled" ? "btn-danger" : "btn-secondary"}
            pendingLabel={next === "cancelled" ? "Cancelling…" : next === "confirmed" ? "Confirming…" : next === "processing" ? "Updating…" : next === "completed" ? "Completing…" : "Working…"}
          >
            {next === "cancelled" ? "Cancel order" : next === "confirmed" ? "Confirm" : next === "processing" ? "Mark processing" : next === "completed" ? "Mark complete" : next}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
