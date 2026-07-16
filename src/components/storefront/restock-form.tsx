"use client";

import { useState } from "react";

export function RestockForm({ productId }: { productId: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="mb-4.5 rounded-xl border border-line bg-white px-4 py-3.5"
      onSubmit={async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const phone = String(values.get("phone") ?? "").trim();
        const email = String(values.get("email") ?? "").trim();
        if (!phone && !email) {
          setMessage("Add a WhatsApp number or an email so we can reach you.");
          return;
        }
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setMessage("Enter a valid email address.");
          return;
        }
        setPending(true);
        setMessage("");
        const response = await fetch("/api/restock", {
          body: JSON.stringify({
            consent: values.get("consent") === "on",
            email: String(values.get("email") ?? "") || undefined,
            phone: String(values.get("phone") ?? "") || undefined,
            productId,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const result = await response.json();
        setMessage(
          response.ok
            ? "You're on the list. We'll let you know when it's back."
            : (result.error ?? "We couldn't save your request."),
        );
        setPending(false);
      }}
    >
      <p className="mb-2.5 text-[13px] font-bold text-ink">This item is sold out</p>
      <p className="mb-3 text-[12.5px] leading-[1.5] text-ink-soft">
        Leave your WhatsApp number or email (at least one) and the seller will message you
        when it&rsquo;s restocked.
      </p>
      <div className="mb-2.5 flex flex-wrap gap-2">
        <input
          type="tel"
          name="phone"
          aria-label="WhatsApp number"
          placeholder="+233… / +234… / +225…"
          className="h-[42px] min-w-[150px] flex-1 rounded-[9px] border border-line-input bg-white px-3 text-[13.5px] outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <input
          type="email"
          name="email"
          aria-label="Email"
          placeholder="you@example.com"
          className="h-[42px] min-w-[150px] flex-1 rounded-[9px] border border-line-input bg-white px-3 text-[13.5px] outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-[42px] cursor-pointer rounded-[9px] border-none bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Saving…" : "Notify me"}
        </button>
      </div>
      <label className="flex items-start gap-2 text-[11.5px] leading-[1.5] text-ink-soft">
        <input name="consent" required type="checkbox" className="mt-0.5 accent-[#A8431A]" />
        I agree to receive one notification when this item is available.
      </label>
      <p aria-live="polite" role="status" className={`m-0 mt-2 text-[12.5px] font-semibold ${message.startsWith("You're on the list") ? "text-success" : "text-danger"}`}>
        {message}
      </p>
    </form>
  );
}
