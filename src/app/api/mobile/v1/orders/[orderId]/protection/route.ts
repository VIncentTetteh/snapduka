import { z } from "zod";

import { isResponse, requireActiveSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { protectionForSeller } from "@/lib/protect/service";

/**
 * SnapDuka Protect status for one of the seller's orders, for the app's order
 * screen. order_protections is service-role only (it holds the delivery code
 * hash), so the app cannot read it directly; this returns the seller-safe view
 * — never the code — plus the rider link to hand to the courier.
 */
export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  const actor = await requireActiveSeller();
  if (isResponse(actor)) return actor;

  const { orderId } = await context.params;
  if (!z.uuid().safeParse(orderId).success) return fail("not_found", "That order does not exist.");

  try {
    const protection = await protectionForSeller(orderId, actor.sellerAccountId);
    if (!protection) return ok({ protection: null });
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://snapduka.shop").replace(/\/$/, "");
    return ok({
      protection: {
        state: protection.state,
        dispatchedAt: protection.dispatchedAt,
        deliveryConfirmedAt: protection.deliveryConfirmedAt,
        confirmationMethod: protection.confirmationMethod,
        autoReleaseAt: protection.autoReleaseAt,
        inspectionEndsAt: protection.inspectionEndsAt,
        riderUrl:
          protection.state === "held" || protection.state === "in_transit"
            ? `${appUrl}/d/${protection.riderToken}`
            : null,
      },
    });
  } catch (error) {
    return failUnexpected("orders.protection", error);
  }
}
