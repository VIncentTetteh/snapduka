import Link from "next/link";
import type { ReactNode } from "react";

import { signOutBuyerAction } from "./sign-in-actions";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const INPUT =
  "h-11 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";
export const LABEL = "grid gap-1.5 text-[12.5px] font-semibold text-ink";
export const CARD = "mb-4 rounded-[14px] border border-line bg-white p-5";
export const PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] bg-accent px-5 text-[14.5px] font-semibold text-white hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60";
export const SECONDARY =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-[9px] border border-line-strong bg-white px-3.5 text-[13.5px] font-semibold text-ink hover:border-[#B9AC98]";

export function PageTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="font-serif text-[clamp(24px,3vw,30px)] font-medium tracking-[-0.01em]">{title}</h1>
      {sub ? <p className="mt-1.5 text-[14px] leading-[1.6] text-ink-soft">{sub}</p> : null}
    </div>
  );
}

/** Rendered by sub-pages when nobody (or no buyer) is signed in. */
export function SignInPrompt() {
  return (
    <div className={CARD}>
      <p className="text-[14px] text-ink-soft">
        Sign in with your phone number to see this page.{" "}
        <Link className="font-semibold text-accent underline" href="/me">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutBuyerAction}>
      <button type="submit" className={SECONDARY}>
        Sign out
      </button>
    </form>
  );
}
