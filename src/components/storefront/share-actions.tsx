"use client";

import { useState } from "react";

import { shareStorefront, whatsappShareUrl } from "@/lib/storefront/sharing";

export function ShareActions({ name, url, qrDataUrl }: { name: string; url: string; qrDataUrl: string }) {
  const [status, setStatus] = useState("");

  return (
    <div className="flex flex-wrap gap-2">
      <button className="min-h-11 rounded-xl bg-white px-4 font-bold text-emerald-950" onClick={async () => {
        try {
          const result = await shareStorefront(navigator, name, url);
          if (result === "shared") setStatus("Shared");
          else window.location.href = result;
        } catch {
          setStatus("Sharing was cancelled.");
        }
      }} type="button">Share shop</button>
      <a className="grid min-h-11 place-items-center rounded-xl border border-emerald-200 px-4 font-bold text-white" href={whatsappShareUrl(name, url)}>WhatsApp</a>
      <a className="grid min-h-11 place-items-center rounded-xl border border-emerald-200 px-4 font-bold text-white" download={`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`} href={qrDataUrl}>Download QR</a>
      <span className="self-center text-sm" role="status">{status}</span>
    </div>
  );
}
