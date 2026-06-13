import { updateOrderAction } from "@/app/(seller)/dashboard/orders/actions";
import { canTransitionOrder, type OrderState } from "@/lib/commerce/transitions";

export function OrderActions({ order }: { order: { id: string; status: OrderState; event_version: number; payment_status: string } }) {
  const candidates: OrderState[] = ["confirmed","processing","completed","cancelled"];
  return <div className="flex flex-wrap gap-2">{candidates.filter((next) => canTransitionOrder(order.status,next)).map((next) => <form action={updateOrderAction} key={next}><input name="orderId" type="hidden" value={order.id} /><input name="status" type="hidden" value={next} /><input name="version" type="hidden" value={order.event_version} />{next === "completed" && order.payment_status === "offline_due" ? <label className="mr-2"><input name="offlinePaid" required type="checkbox" value="yes" /> Payment received</label> : null}<button className="min-h-11 rounded-xl border border-stone-400 px-4 font-bold">{next}</button></form>)}</div>;
}
