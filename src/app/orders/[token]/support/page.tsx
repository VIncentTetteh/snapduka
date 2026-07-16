"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const INPUT =
  "w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";

export default function BuyerSupportPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <div className="mx-auto max-w-[640px] px-4 pb-16 pt-8">
        <h1 className="mb-1.5 max-w-none font-serif text-[24px] font-medium">
          Get help with your order
        </h1>
        <p className="mb-4.5 text-[13.5px] leading-[1.6] text-ink-soft">
          Most issues are resolved directly with the seller — they typically reply within a few
          hours. SnapDuka support can step in if they don&rsquo;t.
        </p>

        {result?.ok ? (
          <div
            role="status"
            className="mb-4 rounded-[14px] border border-success-line bg-success-tint px-5 py-6 text-center"
          >
            <p className="mb-1 text-[15px] font-bold text-success">Sent to the seller</p>
            <p className="mb-4 text-[13px] text-[#2E6B54]">{result.text}</p>
            <Link
              href={`/orders/${token}`}
              className="inline-flex min-h-11 items-center rounded-[10px] border border-line-strong bg-white px-4.5 text-[13px] font-semibold text-ink no-underline"
            >
              Back to your order
            </Link>
          </div>
        ) : (
          <form
            className="mb-4 grid gap-3.5 rounded-[14px] border border-line bg-white px-5 py-4.5"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setResult(null);
              const form = new FormData(event.currentTarget);
              try {
                const response = await fetch(`/api/orders/${token}/support`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    reason: form.get("reason"),
                    description: form.get("description"),
                  }),
                });
                const body = await response.json();
                setResult(
                  response.ok
                    ? { ok: true, text: `Case opened: ${body.caseId}` }
                    : { ok: false, text: body.error ?? "We couldn't open the case. Please try again." },
                );
              } catch {
                setResult({ ok: false, text: "Connection failed. Please try again." });
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="reason">
              What&rsquo;s the issue?
              <select id="reason" name="reason" className={`${INPUT} h-11`}>
                <option value="item_not_as_described">Item not as described or damaged</option>
                <option value="item_not_received">Order not received</option>
                <option value="payment_issue">Payment issue</option>
                <option value="refund_request">Refund request</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="description">
              Describe what happened
              <textarea
                id="description"
                name="description"
                required
                rows={4}
                placeholder="Tell the seller what went wrong and what you'd like to happen…"
                className={`${INPUT} resize-y py-3`}
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="h-12 cursor-pointer rounded-[11px] border-none bg-accent text-[14px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send to seller"}
            </button>
            <p aria-live="polite" role="status" className="m-0 min-h-4 text-[12.5px] font-semibold text-danger">
              {result && !result.ok ? result.text : ""}
            </p>
          </form>
        )}

        <div className="rounded-xl border border-line bg-raised px-4 py-3.5">
          <p className="m-0 text-[12px] leading-[1.6] text-ink-muted">
            Your message is shared with the seller and SnapDuka support. If the seller
            doesn&rsquo;t respond within 72 hours, you can escalate the case. Your contact details
            stay private.
          </p>
        </div>
      </div>
    </main>
  );
}
