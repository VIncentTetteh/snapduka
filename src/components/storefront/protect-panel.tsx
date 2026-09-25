"use client";

import Link from "next/link";
import { useState } from "react";

import { PROTECT_BUYER_COPY, type ProtectState } from "@snapduka/core";

type Props = {
  token: string;
  state: ProtectState;
  inspectionEndsAt: string | null;
  autoReleaseAt: string | null;
};

function when(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The buyer's SnapDuka Protect controls on the tracking page.
 *
 * "Show my delivery code" rotates the code and displays the new one here. That
 * is deliberate: the SMS may never have arrived, and the plaintext is stored
 * nowhere, so a fresh code shown only to the tracking-token holder is both the
 * fallback and the most private option. The rider's old code stops working.
 */
export function ProtectPanel({ token, state, inspectionEndsAt, autoReleaseAt }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function post(action: "confirm" | "new_code") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/orders/${token}/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error ?? "That did not work. Try again.");
        return;
      }
      if (action === "new_code") setCode(result.code);
      else {
        setConfirmed(true);
        setMessage(result.message ?? "Delivery confirmed.");
      }
    } catch {
      setMessage("You seem to be offline. Try again when you have a connection.");
    } finally {
      setBusy(false);
    }
  }

  const reportable = ["held", "in_transit", "releasable"].includes(state) && !confirmed;
  const deadline =
    state === "releasable" ? when(inspectionEndsAt) : state === "in_transit" ? when(autoReleaseAt) : null;

  return (
    <section
      aria-label="SnapDuka Protect"
      className="mb-4 rounded-[14px] border border-accent/30 bg-raised px-5 py-4.5"
    >
      <h2 className="mb-1.5 flex items-center gap-2 text-[14px] font-bold">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 1.5 3 4v4.5c0 3.7 2.6 6.9 6 8 3.4-1.1 6-4.3 6-8V4L9 1.5Z" stroke="#A8431A" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        SnapDuka Protect
      </h2>
      <p className="mb-2 text-[12px]">
        <Link href="/protect" className="font-semibold text-accent underline">
          How Protect works
        </Link>
      </p>
      <p className="mb-3 text-[13px] leading-[1.55] text-ink-soft">
        {confirmed ? PROTECT_BUYER_COPY.releasable : PROTECT_BUYER_COPY[state]}
      </p>
      {deadline && !confirmed ? (
        <p className="mb-3 text-[12px] text-ink-muted">
          {state === "releasable"
            ? `Report a problem before ${deadline}.`
            : `If you do not confirm or report a problem, delivery is confirmed automatically on ${deadline}.`}
        </p>
      ) : null}

      {state === "in_transit" && !confirmed ? (
        <div className="grid gap-2.5">
          {code ? (
            <p className="rounded-[10px] border border-line bg-white px-3.5 py-3 text-center">
              <span className="block text-[11.5px] text-ink-muted">Your delivery code</span>
              <span className="block font-mono text-[26px] font-bold tracking-[0.3em] text-ink">{code}</span>
              <span className="block text-[11.5px] text-ink-muted">
                Give it to the rider only when your order is in your hands.
              </span>
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => post("new_code")}
              className="min-h-10 cursor-pointer rounded-[9px] border border-line bg-white px-4 text-[13px] font-bold text-ink disabled:opacity-60"
            >
              Show my delivery code
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => post("confirm")}
            className="min-h-10 cursor-pointer rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white disabled:opacity-60"
          >
            I have received my order
          </button>
        </div>
      ) : null}

      {reportable ? (
        <Link
          href={`/orders/${token}/support`}
          className="mt-3 inline-block text-[12.5px] font-semibold text-accent underline"
        >
          Something wrong? Report a problem — your payment stays held
        </Link>
      ) : null}

      {message ? (
        <p role="status" className="mt-2.5 text-[12.5px] text-ink-soft">
          {message}
        </p>
      ) : null}
    </section>
  );
}
