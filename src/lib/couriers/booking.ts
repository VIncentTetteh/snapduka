import "server-only";

import {
  CourierAdapterError,
  type BookRequest,
  type BookResult,
  type CountryCode,
  type CourierAdapter,
  type CurrencyCode,
  type Json,
} from "@snapduka/core";

import { deliveryAddressFromJson, orderDeliveryAddress } from "@/lib/addresses/snapshot";
import { loadCourierCredentials } from "@/lib/couriers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Booking an order with a partner courier through its adapter.
 *
 * Builds the partner request from what SnapDuka already holds — the shop's
 * pickup point, the buyer's address and phone from the order, the parcel
 * value — and books with the order id as the idempotency key, so a seller
 * double-tapping "Book", or a retry after a timeout, can never send two
 * riders. Persisting the shipment and dispatching stay in the route, which
 * already owns that for seller-arranged deliveries.
 */

export type BookableOrder = {
  id: string;
  shop_id: string;
  public_reference: string;
  currency: CurrencyCode;
  subtotal_minor: number;
  total_minor: number;
  payment_method: string;
  buyer_snapshot: Json;
  delivery_address?: Json | null;
};

export type AdapterBookingOutcome =
  | {
      ok: true;
      result: BookResult;
      /**
       * Booked on SnapDuka's own courier account (the seller has not connected
       * theirs), so the courier bills SnapDuka and the seller must be charged:
       * the caller passes this to charge_courier_booking once the shipment row
       * exists. Null when the seller's own account was used.
       */
      platformCharge: { estimateMinor: number } | null;
    }
  | {
      ok: false;
      reason:
        | "no_pickup_address"
        | "no_delivery_address"
        | "missing_contact"
        | "courier_rejected"
        | "courier_unavailable"
        | "not_billable";
      message: string;
    };

function buyerContact(snapshot: Json): { name: string; phoneE164: string } | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const name = typeof snapshot.name === "string" ? snapshot.name.trim() : "";
  const phone = typeof snapshot.phone === "string" ? snapshot.phone.trim() : "";
  return name && phone ? { name, phoneE164: phone } : null;
}

export async function bookOrderWithAdapter(input: {
  adapter: CourierAdapter;
  order: BookableOrder;
  sellerAccountId: string;
  country: CountryCode;
}): Promise<AdapterBookingOutcome> {
  const { adapter, order, sellerAccountId, country } = input;
  const admin = createAdminClient();

  const [{ data: pickupRow }, { data: seller }, { data: shop }] = await Promise.all([
    admin
      .from("shop_pickup_addresses")
      .select("address,contact_phone")
      .eq("shop_id", order.shop_id)
      .eq("seller_account_id", sellerAccountId)
      .maybeSingle(),
    admin.from("seller_accounts").select("contact_phone,contact_name").eq("id", sellerAccountId).maybeSingle(),
    admin.from("shops").select("display_name").eq("id", order.shop_id).eq("seller_account_id", sellerAccountId).maybeSingle(),
  ]);

  const pickup = deliveryAddressFromJson(pickupRow?.address, country);
  if (!pickup) {
    return {
      ok: false,
      reason: "no_pickup_address",
      message: "Add your pickup address in delivery settings before booking a courier.",
    };
  }
  const dropoff = orderDeliveryAddress(order, country);
  if (!dropoff) {
    return { ok: false, reason: "no_delivery_address", message: "This order has no delivery address." };
  }
  const recipient = buyerContact(order.buyer_snapshot);
  const senderPhone = pickupRow?.contact_phone ?? seller?.contact_phone ?? null;
  if (!recipient || !senderPhone) {
    return {
      ok: false,
      reason: "missing_contact",
      message: "The courier needs a phone number for both you and the buyer.",
    };
  }

  const request: BookRequest = {
    idempotencyKey: order.id,
    orderId: order.id,
    reference: order.public_reference,
    sellerAccountId,
    country,
    currency: order.currency,
    pickup,
    dropoff,
    sender: { name: shop?.display_name ?? seller?.contact_name ?? "SnapDuka seller", phoneE164: senderPhone },
    recipient,
    parcel: { valueMinor: Number(order.subtotal_minor) },
    // The rider collects only what the buyer has not already paid.
    codAmountMinor: order.payment_method === "cash_on_delivery" ? Number(order.total_minor) : null,
  };

  if (request.codAmountMinor && !adapter.capabilities.cod) {
    return {
      ok: false,
      reason: "courier_rejected",
      message: `${adapter.label} cannot collect cash on delivery. Choose another courier.`,
    };
  }

  const credentials = await loadCourierCredentials(sellerAccountId, adapter.id);

  // On SnapDuka's platform account the courier bills SnapDuka, so the cost has
  // to be recoverable from this order's held settlement before anything is
  // booked. Estimate: the latest cached quote for this courier and shop, else
  // what the buyer paid for delivery.
  let platformCharge: { estimateMinor: number } | null = null;
  if (!credentials) {
    const { data: quote } = await admin
      .from("courier_quotes")
      .select("amount_minor")
      .eq("shop_id", order.shop_id)
      .eq("provider", adapter.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const estimateMinor = Math.max(
      Number(quote?.amount_minor ?? Number(order.total_minor) - Number(order.subtotal_minor)),
      0,
    );
    const { data: billable } = await admin.rpc("courier_booking_billable", {
      p_order_id: order.id,
      p_estimate_minor: estimateMinor,
    });
    if (billable !== true) {
      return {
        ok: false,
        reason: "not_billable",
        message: `Connect your own ${adapter.label} account to book this order, or arrange the delivery yourself.`,
      };
    }
    platformCharge = { estimateMinor };
  }

  try {
    const result = await adapter.book(request, { credentials, signal: AbortSignal.timeout(15_000) });
    return { ok: true, result, platformCharge };
  } catch (error) {
    const code = error instanceof CourierAdapterError ? error.code : "unavailable";
    console.error(`[couriers/booking] ${adapter.id} booking failed for ${order.id} (${code})`);
    return code === "rejected" || code === "unsupported" || code === "not_configured"
      ? { ok: false, reason: "courier_rejected", message: `${adapter.label} could not take this booking.` }
      : {
          ok: false,
          reason: "courier_unavailable",
          message: `${adapter.label} did not respond. Try again in a moment.`,
        };
  }
}
