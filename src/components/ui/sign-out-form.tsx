"use client";

// The action lives with the login route because that is where the rest of the
// session lifecycle lives; it is imported here rather than duplicated so every
// surface ends the session the same way.
import { signOut } from "@/app/(auth)/login/actions";

import { SubmitButton } from "./submit-button";

/**
 * Ends the session and redirects to /login.
 *
 * A form rather than an onClick so it still works before hydration and cannot
 * be triggered by a stray GET — signing out is a state change, and a link
 * would let a prefetch or a crawler log the user out.
 */
export function SignOutForm({
  className,
  label = "Sign out",
  role,
}: {
  className?: string;
  label?: string;
  /** Set to "menuitem" when rendered inside a role="menu" container. */
  role?: "menuitem";
}) {
  return (
    <form action={signOut} className="contents">
      <SubmitButton className={className} pendingLabel="Signing out…" role={role}>
        {label}
      </SubmitButton>
    </form>
  );
}
