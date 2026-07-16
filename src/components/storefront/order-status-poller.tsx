"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const FAST_INTERVAL_MS = 5_000;
const SLOW_INTERVAL_MS = 15_000;
const FAST_WINDOW_MS = 2 * 60 * 1_000;

type Snapshot = {
  paymentStatus: string;
  fulfillmentStatus: string;
  status: string;
};

function isTerminal(snapshot: Snapshot): boolean {
  if (["cancelled", "returned"].includes(snapshot.fulfillmentStatus)) return true;
  if (snapshot.paymentStatus === "refunded") return true;
  return snapshot.fulfillmentStatus === "fulfilled" && snapshot.paymentStatus === "paid";
}

/**
 * Keeps the buyer tracking page live: confirms a Paystack payment on return
 * (Paystack appends ?reference/?trxref to the callback URL) and polls the
 * order status, refreshing the server-rendered page whenever it changes.
 */
export function OrderStatusPoller({
  token,
  initial,
}: {
  token: string;
  initial: Snapshot;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lastRef = useRef(initial);
  const verifiedRef = useRef(false);

  useEffect(() => {
    // Baseline is whatever the server just rendered; the effect restarts on
    // every refresh-driven change so the loop always compares against it.
    lastRef.current = initial;
    if (isTerminal(initial) && !searchParams.get("reference") && !searchParams.get("trxref")) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function verifyReturnedPayment() {
      const reference = searchParams.get("reference") ?? searchParams.get("trxref");
      if (!reference || verifiedRef.current) return;
      verifiedRef.current = true;
      try {
        const response = await fetch("/api/payments/paystack/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reference }),
        });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.paymentStatus === "paid" && lastRef.current.paymentStatus !== "paid") {
          router.refresh();
        }
      } catch {
        // Verification is best-effort — polling below still picks up the webhook.
      }
    }

    async function poll() {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/orders/${token}`, { cache: "no-store" });
        if (response.ok) {
          const order = (await response.json()) as {
            payment_status: string;
            fulfillment_status: string;
            status: string;
          };
          const next: Snapshot = {
            paymentStatus: order.payment_status,
            fulfillmentStatus: order.fulfillment_status,
            status: order.status,
          };
          const previous = lastRef.current;
          if (
            next.paymentStatus !== previous.paymentStatus ||
            next.fulfillmentStatus !== previous.fulfillmentStatus ||
            next.status !== previous.status
          ) {
            lastRef.current = next;
            router.refresh();
          }
          if (isTerminal(next)) {
            return;
          }
        }
      } catch {
        // Offline or transient failure — keep trying.
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      const interval = Date.now() - startedAt < FAST_WINDOW_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      timer = setTimeout(() => {
        if (document.hidden) {
          schedule();
          return;
        }
        void poll();
      }, interval);
    }

    function onVisible() {
      if (!document.hidden && !cancelled) {
        void poll();
      }
    }

    void verifyReturnedPayment().then(() => schedule());
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initial.paymentStatus, initial.fulfillmentStatus, initial.status]);

  return null;
}
