"use client";

import { useEffect } from "react";

type Props = {
  campaign?: string;
  country: "GH" | "NG" | "CI";
  eventType: "visit" | "product_view" | "checkout_start";
  productId?: string;
  shopId: string;
};

const SESSION_KEY = "snapduka:analytics-session";

export function AnalyticsTracker({ campaign, country, eventType, productId, shopId }: Props) {
  useEffect(() => {
    let sessionId = window.localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      window.localStorage.setItem(SESSION_KEY, sessionId);
    }

    const params = new URLSearchParams(window.location.search);
    const source = params.get("source") ?? (document.referrer || null);
    const eventKey = `snapduka:event:${sessionId}:${eventType}:${productId ?? shopId}:${campaign ?? ""}`;
    if (window.sessionStorage.getItem(eventKey)) return;
    window.sessionStorage.setItem(eventKey, "1");

    void fetch("/api/analytics/events", {
      body: JSON.stringify({
        campaign: campaign ?? params.get("campaign"),
        country,
        eventType,
        id: crypto.randomUUID(),
        productId: productId ?? null,
        sessionId,
        shopId,
        source: source?.slice(0, 100) ?? null,
      }),
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  }, [campaign, country, eventType, productId, shopId]);

  return null;
}
