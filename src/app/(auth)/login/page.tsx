import Link from "next/link";

import { safeNextPath } from "@/lib/auth/redirect";
import { enabledSocialProviders } from "@/lib/auth/social";

import { signIn, signInWithSocial, signUp } from "./actions";
import { SubmitButton } from "./submit-button";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    message?: string | string[];
    next?: string | string[];
  }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);
  const message = first(params.message);
  const providers = enabledSocialProviders();

  return (
    <main className="authShell">
      <Link className="brand" href="/">
        SnapDuka
      </Link>

      <section className="authIntro" aria-labelledby="login-heading">
        <p className="eyebrow">Seller account</p>
        <h1 id="login-heading">Seller access</h1>
        <p>
          Sign in or create your seller account in a few taps.
        </p>
      </section>

      {error ? (
        <p className="authNotice authError" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="authNotice" role="status">
          {message}
        </p>
      ) : null}

      {providers.length > 0 ? (
        <section className="authCard authSocial" aria-labelledby="social-heading">
          <h2 id="social-heading">Continue with</h2>
          <p>Use an account you already trust. No new password needed.</p>
          <div className="authSocialButtons">
            {providers.map((provider) => (
              <form action={signInWithSocial} key={provider.id}>
                <input name="next" type="hidden" value={next} />
                <button
                  className="authSocialButton"
                  name="provider"
                  type="submit"
                  value={provider.id}
                >
                  Continue with {provider.label}
                </button>
              </form>
            ))}
          </div>
          <p className="authDivider">
            <span>or use email</span>
          </p>
        </section>
      ) : null}

      <div className="authGrid">
        <form action={signIn} className="authCard">
          <h2>Sign in</h2>
          <input name="next" type="hidden" value={next} />

          <label htmlFor="sign-in-email">Email</label>
          <input
            autoComplete="email"
            id="sign-in-email"
            name="email"
            required
            type="email"
          />

          <label htmlFor="sign-in-password">Password</label>
          <input
            autoComplete="current-password"
            id="sign-in-password"
            name="password"
            required
            type="password"
          />

          <SubmitButton className="authPrimary" pendingLabel="Signing in...">
            Sign in
          </SubmitButton>
        </form>

        <form action={signUp} className="authCard">
          <h2>Create account</h2>
          <p>
            Start with email and a secure password. Creating an account does
            not publish a shop.
          </p>
          <input name="next" type="hidden" value={next} />

          <label htmlFor="sign-up-email">Email</label>
          <input
            autoComplete="email"
            id="sign-up-email"
            name="email"
            required
            type="email"
          />

          <label htmlFor="sign-up-password">Password</label>
          <input
            autoComplete="new-password"
            id="sign-up-password"
            minLength={8}
            name="password"
            required
            type="password"
          />

          <SubmitButton className="authSecondary" pendingLabel="Creating...">
            Create account
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
