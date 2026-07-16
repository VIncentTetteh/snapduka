"use client";

import { useState } from "react";

type Check = { label: string; met: boolean };

function evaluate(password: string): { score: number; checks: Check[] } {
  const checks: Check[] = [
    { label: "8+ characters", met: password.length >= 8 },
    { label: "an uppercase letter", met: /[A-Z]/.test(password) },
    { label: "a lowercase letter", met: /[a-z]/.test(password) },
    { label: "a number", met: /[0-9]/.test(password) },
  ];
  return { score: checks.filter((c) => c.met).length, checks };
}

/** Prototype meter colors: empty · weak amber · warm mid · strong emerald. */
const BAR_COLORS = ["#EAE2D6", "#D97706", "#D9986F", "#047857"] as const;

function meterLevel(score: number): 0 | 1 | 2 | 3 {
  if (score === 0) return 0;
  if (score <= 2) return 1;
  if (score === 3) return 2;
  return 3;
}

function hint(password: string, checks: Check[], level: number): string {
  if (password.length === 0) {
    return "Use 8+ characters with uppercase, lowercase and a number.";
  }
  if (level === 3) {
    return "Strong password.";
  }
  const missing = checks.filter((c) => !c.met).map((c) => c.label);
  return `Add ${missing.join(", ")}.`;
}

type PasswordStrengthInputProps = {
  id: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
};

/**
 * A controlled password input with a live 3-bar strength meter and an
 * adaptive hint reflecting the real password policy. Submits through a
 * regular `<input name={name}>` so it works inside any `<form>`.
 */
export function PasswordStrengthInput({
  id,
  name,
  autoComplete = "new-password",
  minLength = 8,
  required = true,
}: PasswordStrengthInputProps) {
  const [value, setValue] = useState("");

  const { score, checks } = evaluate(value);
  const level = meterLevel(score);

  return (
    <div>
      <input
        autoComplete={autoComplete}
        className="h-[46px] w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]"
        id={id}
        minLength={minLength}
        name={name}
        onChange={(e) => setValue(e.target.value)}
        placeholder="At least 8 characters"
        required={required}
        type="password"
        value={value}
      />

      <div aria-live="polite" className="mt-2">
        <div className="mb-1.5 flex gap-[5px]">
          {[1, 2, 3].map((bar) => (
            <span
              aria-hidden="true"
              key={bar}
              className="h-1 flex-1 rounded-[3px] transition-colors duration-200"
              style={{
                background: level >= bar ? BAR_COLORS[level] : BAR_COLORS[0],
              }}
            />
          ))}
        </div>
        <p className="m-0 text-[11.5px] text-ink-muted">{hint(value, checks, level)}</p>
      </div>
    </div>
  );
}
