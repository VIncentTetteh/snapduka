"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ShippingBookingForm({ amountMinor, orderId }: { amountMinor: number; orderId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form className="card grid gap-3" onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage("Preparing delivery…");
      const values = new FormData(event.currentTarget);
      const quoteResponse = await fetch("/api/couriers/quotes", { body: JSON.stringify({ amountMinor, orderId, provider: "manual" }), headers: { "content-type": "application/json" }, method: "POST" });
      const quoteResult = await quoteResponse.json();
      if (!quoteResponse.ok || !quoteResult.quotes?.[0]) { setMessage(quoteResult.error ?? "Could not prepare delivery."); setPending(false); return; }
      const trackingUrl = String(values.get("trackingUrl") ?? "").trim();
      const response = await fetch("/api/couriers/book", { body: JSON.stringify({ orderId, provider: "manual", quoteId: quoteResult.quotes[0].id, trackingNumber: String(values.get("trackingNumber") ?? "").trim() || undefined, trackingUrl: trackingUrl || undefined }), headers: { "content-type": "application/json" }, method: "POST" });
      const result = await response.json();
      setMessage(response.ok ? "Delivery tracking saved." : result.error ?? "Could not save tracking."); setPending(false);
      if (response.ok) router.refresh();
    }}>
      <div><h2 className="m-0 text-lg font-extrabold">Record delivery</h2><p className="page-sub m-0 mt-1">Use a rider reference or courier tracking number. A SnapDuka reference is generated if left blank.</p></div>
      <label className="grid gap-1"><span className="field-label">Tracking number</span><input className="field-input" name="trackingNumber" placeholder="RIDER-2048" /></label>
      <label className="grid gap-1"><span className="field-label">Tracking URL (optional)</span><input className="field-input" name="trackingUrl" placeholder="https://courier.example/track/…" type="url" /></label>
      <button className="btn-primary w-full" disabled={pending} type="submit">{pending ? "Saving…" : "Save tracking"}</button>
      <p aria-live="polite" className="m-0 text-sm" role="status">{message}</p>
    </form>
  );
}
