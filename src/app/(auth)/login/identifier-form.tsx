"use client";

import { useId, useRef, useState } from "react";

import {
  DEFAULT_PHONE_REGION,
  PHONE_REGIONS,
  type IdentifierMode,
  type PhoneRegion,
  validateIdentifier,
} from "@/lib/auth/identifier";
import { Req } from "@/components/ui/required-mark";

import { SubmitButton } from "./submit-button";

// Width is deliberately left out: the country select and the number input sit
// in a flex row and set their own, and a `w-full` here would beat the select's
// fixed width depending on Tailwind's emitted rule order.
const INPUT_BASE =
  "h-[46px] rounded-[10px] border bg-white px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";
const INPUT_OK = "border-line-input focus:border-accent";
const INPUT_ERROR = "border-danger focus:border-danger";

const TABS: readonly { mode: IdentifierMode; label: string }[] = [
  { mode: "email", label: "Email" },
  { mode: "phone", label: "Phone" },
];

type IdentifierFormProps = {
  /** Server action; stays authoritative regardless of what runs here. */
  action: (formData: FormData) => void | Promise<void>;
  next: string;
};

export function IdentifierForm({ action, next }: IdentifierFormProps) {
  const [mode, setMode] = useState<IdentifierMode>("email");
  const [region, setRegion] = useState<PhoneRegion>(DEFAULT_PHONE_REGION);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const baseId = useId();
  const inputId = `${baseId}-identifier`;
  const errorId = `${baseId}-error`;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedRegion = PHONE_REGIONS.find((option) => option.value === region);
  const isPhone = mode === "phone";

  function switchMode(nextMode: IdentifierMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    // Clearing avoids carrying an email into the phone field, where it could
    // only ever be invalid.
    setValue("");
    setError(null);
  }

  // Roving focus so the tablist is operable from the keyboard, per the
  // WAI-ARIA tabs pattern.
  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const nextIndex = (index + delta + TABS.length) % TABS.length;
    switchMode(TABS[nextIndex].mode);
    tabRefs.current[nextIndex]?.focus();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const result = validateIdentifier(mode, value, region);
    if (!result.ok) {
      event.preventDefault();
      setError(result.message);
      return;
    }
    setError(null);
  }

  return (
    <form action={action} className="grid gap-3.5" noValidate onSubmit={onSubmit}>
      <input name="next" type="hidden" value={next} />
      <input name="mode" type="hidden" value={mode} />
      <input name="region" type="hidden" value={region} />

      <div
        aria-label="Sign in with"
        className="grid grid-cols-2 gap-1 rounded-[11px] border border-line bg-[#F6F1E9] p-1"
        role="tablist"
      >
        {TABS.map((tab, index) => {
          const selected = tab.mode === mode;
          return (
            <button
              aria-controls={inputId}
              aria-selected={selected}
              className={`h-9 cursor-pointer rounded-[8px] border-none text-[13.5px] font-semibold transition-colors ${
                selected ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "bg-transparent text-ink-soft hover:text-ink"
              }`}
              key={tab.mode}
              onClick={() => switchMode(tab.mode)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5 text-[12.5px] font-semibold">
        <label htmlFor={inputId}>
          {isPhone ? "Phone number" : "Email address"}
          <Req />
        </label>

        <div className="flex gap-2">
          {isPhone ? (
            <select
              aria-label="Country"
              className={`${INPUT_BASE} ${error ? INPUT_ERROR : INPUT_OK} w-[116px] shrink-0 cursor-pointer px-2.5 font-semibold`}
              name="region-select"
              onChange={(event) => {
                setRegion(event.target.value as PhoneRegion);
                setError(null);
              }}
              value={region}
            >
              {/* Dial code + ISO code, not the full country name: a native
                  select truncates its closed state, and "+233 Côte d’Ivoire"
                  clips to nonsense. The full name still appears in errors. */}
              {PHONE_REGIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.callingCode ? `${option.callingCode} ${option.value}` : option.label}
                </option>
              ))}
            </select>
          ) : null}

          <input
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete={isPhone ? "tel" : "email"}
            className={`${INPUT_BASE} ${error ? INPUT_ERROR : INPUT_OK} min-w-0 flex-1`}
            id={inputId}
            inputMode={isPhone ? "tel" : "email"}
            name="identifier"
            onBlur={() => {
              if (value.trim().length === 0) return;
              const result = validateIdentifier(mode, value, region);
              setError(result.ok ? null : result.message);
            }}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder={
              isPhone
                ? selectedRegion?.callingCode
                  ? "24 123 4567"
                  : "+254712345678"
                : "you@example.com"
            }
            type={isPhone ? "tel" : "email"}
            value={value}
          />
        </div>

        {error ? (
          <p className="text-[12.5px] font-medium text-danger" id={errorId} role="alert">
            {error}
          </p>
        ) : (
          <p className="text-[12px] font-normal text-ink-faint">
            {isPhone
              ? selectedRegion?.callingCode
                ? `We'll text a code to ${selectedRegion.callingCode} — no password needed.`
                : "Include your country code, starting with +."
              : "We'll email you a 6-digit code — no password needed."}
          </p>
        )}
      </div>

      <SubmitButton
        className="h-[50px] cursor-pointer rounded-[11px] border-none bg-accent text-[15px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
        pendingLabel="Sending code…"
      >
        Send me a code
      </SubmitButton>
    </form>
  );
}
