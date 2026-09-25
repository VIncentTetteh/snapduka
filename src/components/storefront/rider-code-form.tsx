"use client";

import { useState } from "react";

/** The rider types the buyer's six-digit delivery code at the door. */
export function RiderCodeForm({ riderToken }: { riderToken: string }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          const response = await fetch(`/api/protect/rider/${riderToken}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const result = await response.json().catch(() => ({}));
          setMessage(result.message ?? result.error ?? null);
          if (response.ok) setDone(true);
        } catch {
          setMessage("No connection. Try again when you have signal.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {done ? null : (
        <>
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink" htmlFor="delivery-code">
            Buyer&apos;s delivery code
            <input
              id="delivery-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="h-14 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-center font-mono text-[26px] tracking-[0.3em] text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="min-h-12 cursor-pointer rounded-[10px] border-none bg-ink px-4 text-[15px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "Checking…" : "Confirm delivery"}
          </button>
        </>
      )}
      {message ? (
        <p role="status" className={`text-[13.5px] ${done ? "font-semibold text-success" : "text-danger"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
