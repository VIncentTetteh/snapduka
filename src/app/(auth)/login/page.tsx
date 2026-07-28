import type { Metadata } from "next";
import Link from "next/link";

import { LogoMark } from "@/components/ui/logo";
import { Req } from "@/components/ui/required-mark";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSocialProviderEnabled } from "@/lib/auth/social";

import { resendOtpAction, sendOtpAction, signInWithSocial, verifyOtpAction } from "./actions";
import { IdentifierForm } from "./identifier-form";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "Sign in | SnapDuka",
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    message?: string | string[];
    next?: string | string[];
    step?: string | string[];
    identifier?: string | string[];
  }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const INPUT_CLASSES =
  "h-[46px] w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next) ?? "/onboarding");
  const error = first(params.error);
  const message = first(params.message);
  const isCodeStep = first(params.step) === "code";
  const identifier = first(params.identifier) ?? "";
  const googleEnabled = isSocialProviderEnabled("google");

  return (
    <main className="sd-main flex min-h-svh flex-col bg-paper text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center px-5">
          <Link
            href="/"
            aria-label="SnapDuka home"
            className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-ink"
          >
            <LogoMark className="h-[26px] w-[26px] rounded-lg text-[15px]" />
            SnapDuka
          </Link>
        </div>
      </header>

      <div className="grid flex-1 place-items-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <h1 className="mb-2 font-serif text-[clamp(26px,3.4vw,32px)] font-medium tracking-[-0.01em]">
            {isCodeStep ? "Enter your code" : "Sign in or create an account"}
          </h1>
          <p className="mb-6.5 text-[14px] leading-[1.6] text-ink-soft">
            {isCodeStep
              ? "We sent a 6-digit code — enter it below to continue."
              : "One account for your storefront, orders and payouts."}
          </p>

          {error ? (
            <div
              role="alert"
              className="mb-4 flex gap-2.5 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="mt-px shrink-0">
                <path d="M9 6.5v3.2m0 2.6h.01M9 2 1.8 15h14.4L9 2Z" stroke="#B42318" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-[12.5px] leading-[1.5] text-[#7A1B10]">
                <strong className="font-bold">That didn&rsquo;t work.</strong> {error}
              </p>
            </div>
          ) : null}
          {message ? (
            <div
              role="status"
              className="mb-4 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] text-ink-soft"
            >
              {message}
            </div>
          ) : null}

          {isCodeStep ? (
            <>
              <form action={verifyOtpAction} className="grid gap-3.5">
                <input name="next" type="hidden" value={next} />
                <input name="identifier" type="hidden" value={identifier} />
                <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="auth-code">
                  <span>6-digit code<Req /></span>
                  <input
                    autoComplete="one-time-code"
                    className={INPUT_CLASSES}
                    id="auth-code"
                    inputMode="numeric"
                    maxLength={6}
                    name="code"
                    pattern="[0-9]{6}"
                    placeholder="123456"
                    required
                    type="text"
                  />
                </label>
                <SubmitButton
                  className="h-[50px] cursor-pointer rounded-[11px] border-none bg-accent text-[15px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                  pendingLabel="Verifying…"
                >
                  Verify and continue
                </SubmitButton>
              </form>
              <div className="mt-4 flex items-center justify-between text-[12.5px]">
                <form action={resendOtpAction}>
                  <input name="next" type="hidden" value={next} />
                  <input name="identifier" type="hidden" value={identifier} />
                  <button
                    type="submit"
                    className="cursor-pointer border-none bg-transparent p-0 font-semibold text-accent underline hover:text-accent-deep"
                  >
                    Resend code
                  </button>
                </form>
                <Link
                  href={`/login?${new URLSearchParams({ next })}`}
                  className="font-semibold text-ink-soft underline hover:text-ink"
                >
                  Use a different email or phone
                </Link>
              </div>
            </>
          ) : (
            <>
              <IdentifierForm action={sendOtpAction} next={next} />

              {googleEnabled ? (
                <>
                  <div className="my-4 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[11.5px] font-semibold text-ink-faint">OR</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <form action={signInWithSocial}>
                    <input name="next" type="hidden" value={next} />
                    <input name="provider" type="hidden" value="google" />
                    <SubmitButton
                      className="inline-flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-line-strong bg-white text-[13.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                      pendingLabel="Connecting to Google…"
                    >
                      <GoogleIcon />
                      Continue with Google
                    </SubmitButton>
                  </form>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
