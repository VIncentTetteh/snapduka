import type { Metadata } from "next";
import Link from "next/link";

import { PasswordStrengthInput } from "@/components/ui/password-strength";
import { LogoMark } from "@/components/ui/logo";
import { Req } from "@/components/ui/required-mark";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSocialProviderEnabled } from "@/lib/auth/social";

import { signIn, signInWithMagicLink, signInWithSocial, signUp } from "./actions";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "Sign in | SnapDuka",
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    message?: string | string[];
    next?: string | string[];
    mode?: string | string[];
    method?: string | string[];
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

function MailIcon({ stroke = "currentColor" }: { stroke?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 6.5 10 11l7-4.5M4 15h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 16 5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 15Z"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckEmailScreen({ next, message }: { next: string; message: string }) {
  const continueHref = `/login?${new URLSearchParams({ next })}`;
  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <div className="w-full max-w-[440px] rounded-[18px] border border-line bg-white p-7 text-center sm:p-11">
        <span
          aria-hidden="true"
          className="mb-4.5 inline-grid h-[52px] w-[52px] place-items-center rounded-full bg-success-tint"
        >
          <svg width="24" height="24" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 6.5 10 11l7-4.5M4 15h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 16 5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 15Z"
              stroke="#047857"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 className="mb-2.5 font-serif text-[24px] font-medium">Check your email</h1>
        <p className="mb-5.5 text-[14px] leading-[1.6] text-ink-soft" role="status">
          {message}
        </p>
        <p className="mb-6 text-[12.5px] leading-[1.6] text-ink-muted">
          Click the link to continue. It expires in 24 hours. Check spam if you don&rsquo;t see
          it within a minute.
        </p>
        <Link
          href={continueHref}
          className="mb-2.5 block rounded-[11px] bg-accent py-3.5 text-center text-[14px] font-bold text-white transition-colors hover:bg-accent-deep"
        >
          I&rsquo;ve confirmed — continue
        </Link>
        <Link
          href={continueHref}
          className="inline-block p-1.5 text-[12.5px] font-semibold text-ink-soft underline hover:text-ink"
        >
          Use a different email
        </Link>
      </div>
    </div>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next) ?? "/onboarding");
  const error = first(params.error);
  const message = first(params.message);
  const isRegister = first(params.mode) === "register";
  const isMagic = first(params.method) === "magic";
  const googleEnabled = isSocialProviderEnabled("google");

  const modeQuery = (mode: "signin" | "register", method?: "magic") => {
    const qs = new URLSearchParams({ next });
    if (mode === "register") qs.set("mode", "register");
    if (method === "magic") qs.set("method", "magic");
    return `/login?${qs.toString()}`;
  };

  const isCheckEmail = Boolean(message?.toLowerCase().startsWith("check your email"));

  return (
    <main className="sd-main flex min-h-svh flex-col bg-paper text-ink">
      {/* Top bar */}
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center justify-between gap-3 px-5">
          <Link
            href="/"
            aria-label="SnapDuka home"
            className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-ink"
          >
            <LogoMark className="h-[26px] w-[26px] rounded-lg text-[15px]" />
            SnapDuka
          </Link>
          {!isCheckEmail ? (
            <Link
              href={modeQuery(isRegister ? "signin" : "register")}
              className="rounded-[9px] border border-line-input px-3.5 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-line-soft"
            >
              {isRegister ? "Sign in" : "Create account"}
            </Link>
          ) : null}
        </div>
      </header>

      {isCheckEmail ? (
        <CheckEmailScreen next={next} message={message ?? ""} />
      ) : (
        <div className="mx-auto grid w-full max-w-[1120px] flex-1 grid-cols-1 items-stretch lg:grid-cols-2">
          {/* Form column */}
          <div className="grid place-items-center px-5 py-8 sm:py-14">
            <div className="w-full max-w-[400px]">
              <h1 className="mb-2 font-serif text-[clamp(26px,3.4vw,32px)] font-medium tracking-[-0.01em]">
                {isRegister ? "Create your account" : "Welcome back"}
              </h1>
              <p className="mb-6.5 text-[14px] leading-[1.6] text-ink-soft">
                {isRegister
                  ? "One account for your storefront, orders and payouts."
                  : "Sign in to manage your shop, orders and customers."}
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

              <form
                action={isMagic ? signInWithMagicLink : isRegister ? signUp : signIn}
                className="grid gap-3.5"
              >
                <input name="next" type="hidden" value={next} />

                <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="auth-email">
                  <span>Email<Req /></span>
                  <input
                    autoComplete="email"
                    className={INPUT_CLASSES}
                    id="auth-email"
                    name="email"
                    placeholder="you@example.com"
                    required
                    type="email"
                  />
                </label>

                {!isMagic ? (
                  isRegister ? (
                    <div className="grid gap-1.5 text-[12.5px] font-semibold">
                      <label htmlFor="auth-password">Password<Req /></label>
                      <PasswordStrengthInput
                        autoComplete="new-password"
                        id="auth-password"
                        minLength={8}
                        name="password"
                        required
                      />
                    </div>
                  ) : (
                    <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="auth-password">
                      <span className="flex justify-between">
                        <span>Password<Req /></span>
                        <Link
                          href={modeQuery("signin", "magic")}
                          className="text-[12px] font-semibold text-accent hover:text-accent-deep"
                        >
                          Forgot?
                        </Link>
                      </span>
                      <input
                        autoComplete="current-password"
                        className={INPUT_CLASSES}
                        id="auth-password"
                        name="password"
                        placeholder="Your password"
                        required
                        type="password"
                      />
                    </label>
                  )
                ) : null}

                <SubmitButton
                  className="h-[50px] cursor-pointer rounded-[11px] border-none bg-accent text-[15px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                  pendingLabel="Please wait…"
                >
                  {isMagic ? "Email me a magic link" : isRegister ? "Create account" : "Sign in"}
                </SubmitButton>
              </form>

              <div className="my-4 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11.5px] font-semibold text-ink-faint">OR</span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <div className="grid gap-3.5">
                {googleEnabled ? (
                  <form action={signInWithSocial}>
                    <input name="next" type="hidden" value={next} />
                    <input name="provider" type="hidden" value="google" />
                    <SubmitButton
                      className="inline-flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-line-strong bg-white text-[13.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                      pendingLabel="Connecting to Google…"
                    >
                      <GoogleIcon />
                      {isRegister ? "Sign up with Google" : "Continue with Google"}
                    </SubmitButton>
                  </form>
                ) : null}
                <Link
                  href={
                    isMagic
                      ? modeQuery(isRegister ? "register" : "signin")
                      : modeQuery(isRegister ? "register" : "signin", "magic")
                  }
                  className="inline-flex h-[46px] items-center justify-center gap-2 rounded-[11px] border border-line-strong bg-white text-[13.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98]"
                >
                  <MailIcon />
                  {isMagic ? "Use password instead" : "Email me a magic link"}
                </Link>
              </div>

              <p className="mt-6 text-[12.5px] leading-[1.6] text-ink-muted">
                {isRegister ? "Already have an account?" : "New to SnapDuka?"}{" "}
                <Link
                  href={modeQuery(isRegister ? "signin" : "register")}
                  className="font-bold text-accent underline hover:text-accent-deep"
                >
                  {isRegister ? "Sign in" : "Create your storefront"}
                </Link>
              </p>
            </div>
          </div>

          {/* Brand column (desktop) */}
          <div
            aria-hidden="true"
            className="relative m-6 ml-0 hidden overflow-hidden rounded-3xl bg-ink p-8 lg:flex lg:flex-col lg:justify-end lg:p-14"
          >
            <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_10%,rgba(217,152,111,0.22)_0%,transparent_55%)]" />
            <div className="relative">
              <p className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-accent-soft">
                Social commerce, organized
              </p>
              <p className="mb-4.5 max-w-[18ch] font-serif text-[clamp(24px,2.6vw,32px)] leading-[1.2] text-paper">
                Every order, payment and customer — in one place.
              </p>
              <p className="max-w-[40ch] text-[13.5px] leading-[1.7] text-[#B8AEA1]">
                Sellers across Ghana, Nigeria and Côte d&rsquo;Ivoire run their social storefronts
                on SnapDuka, with Paystack payments and guest checkout built in.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
