"use client";

import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { suggestCaptionsAction } from "@/lib/ai/caption-actions";

const CHANNELS = [
  ["whatsapp", "WhatsApp"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["snapchat", "Snapchat"],
] as const;

const LANGUAGES = [
  ["en", "English"],
  ["pcm", "Pidgin"],
  ["tw", "Twi"],
] as const;

/**
 * AI caption ideas for the selected product. Suggestions only: nothing is
 * posted, and the seller copies and edits whichever one they like. Pidgin and
 * Twi output is a draft a native speaker should check before posting.
 */
export function CaptionSuggestions({ productId, shareUrl }: { productId: string; shareUrl: string }) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number][0]>("whatsapp");
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number][0]>("en");
  const [captions, setCaptions] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-3 grid gap-2.5 rounded-xl border border-white/15 p-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-semibold">Suggest captions for</span>
        <select
          aria-label="Channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value as typeof channel)}
          className="h-8 rounded-[8px] bg-white px-2 text-ink"
        >
          {CHANNELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Language"
          value={language}
          onChange={(event) => setLanguage(event.target.value as typeof language)}
          className="h-8 rounded-[8px] bg-white px-2 text-ink"
        >
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            const result = await suggestCaptionsAction({ productId, channel, language });
            setBusy(false);
            if (result.ok) setCaptions(result.captions);
            else {
              setCaptions([]);
              setMessage(result.message);
            }
          }}
          className="h-8 cursor-pointer rounded-[8px] border-none bg-accent px-3 font-bold text-white disabled:opacity-60"
        >
          {busy ? "Thinking…" : "Suggest"}
        </button>
      </div>
      {language !== "en" && captions.length > 0 ? (
        <p className="m-0 text-[11.5px] text-white/70">Machine-written — check the wording before posting.</p>
      ) : null}
      {captions.map((text) => (
        <div key={text} className="flex items-start justify-between gap-3 rounded-lg bg-raised px-3 py-2.5 text-[13px] text-ink-2">
          <span>{text}</span>
          <CopyButton value={`${text}\n${shareUrl}`} label="Copy" />
        </div>
      ))}
      {message ? <p className="m-0 text-[12px] text-white/80">{message}</p> : null}
    </div>
  );
}
