"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * When Paystack redirects back with ?reference=/&trxref=, confirms the charge
 * via the subscription-verify endpoint and refreshes the page so the newly
 * activated plan renders — no webhook required in local dev.
 */
export function SubscriptionVerifier() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference") ?? searchParams.get("trxref");
  const attempted = useRef(false);
  const [status, setStatus] = useState<"verifying" | "done" | "failed" | null>(
    reference ? "verifying" : null,
  );

  useEffect(() => {
    if (!reference || attempted.current) return;
    attempted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/payments/paystack/subscription-verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reference }),
        });
        const payload = (await response.json()) as { state?: string };
        if (cancelled) return;
        if (payload.state === "active") {
          setStatus("done");
          router.replace("/dashboard/settings/billing?payment=confirmed");
          router.refresh();
        } else {
          setStatus("failed");
        }
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reference, router]);

  if (status === "verifying") {
    return (
      <div className="rounded-[12px] border border-line bg-white px-4 py-3 text-[13px] font-semibold text-ink-soft" role="status">
        Confirming your payment with Paystack…
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="rounded-[12px] border border-[#F2C9BF] bg-[#FBEAE7] px-4 py-3 text-[13px] font-semibold text-[#B42318]" role="alert">
        Payment is still processing. Your plan activates automatically once Paystack confirms — refresh in a moment.
      </div>
    );
  }
  return null;
}
