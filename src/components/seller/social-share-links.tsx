"use client";

import { useState } from "react";

const channels = [
  { label: "WhatsApp", emoji: "💬", bg: "#E7F9EE" },
  { label: "Snapchat", emoji: "👻", bg: "#FFFBE0" },
  { label: "TikTok", emoji: "🎵", bg: "#F2F2F5" },
  { label: "Instagram", emoji: "📸", bg: "#FFE9F0" },
] as const;

export function SocialShareLinks({ shopName, shopUrl }: { shopName: string; shopUrl: string }) {
  const [message, setMessage] = useState("");
  const share = async (label: string) => {
    if (label === "WhatsApp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(`Shop ${shopName} on SnapDuka: ${shopUrl}`)}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: shopName, text: `Shop ${shopName} on SnapDuka`, url: shopUrl }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(shopUrl);
    setMessage(`Link copied — paste it into ${label}.`);
  };

  return (
    <>
      <div style={{ display: "flex", gap: "9px", marginBottom: message ? "8px" : "22px" }}>
        {channels.map((channel) => (
          <button
            key={channel.label}
            onClick={() => void share(channel.label)}
            style={{
              flex: 1,
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "13px 6px",
              textAlign: "center",
              background: "#fff",
              cursor: "pointer",
              color: "var(--ink)",
            }}
            type="button"
          >
            <span style={{ width: "42px", height: "42px", borderRadius: "13px", background: channel.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", margin: "0 auto" }}>
              {channel.emoji}
            </span>
            <span style={{ display: "block", fontSize: "11px", fontWeight: 600, marginTop: "7px" }}>{channel.label}</span>
          </button>
        ))}
      </div>
      <p aria-live="polite" style={{ color: "var(--green)", fontSize: "12px", margin: message ? "0 0 18px" : 0 }}>{message}</p>
    </>
  );
}
