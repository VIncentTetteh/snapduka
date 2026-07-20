"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Submit button for a form with exactly one action. Shows `pendingLabel`
 * (or `children` if omitted) and disables itself while the enclosing
 * <form>'s action is in flight.
 */
export function SubmitButton({ children, pendingLabel, className, disabled }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button aria-disabled={pending || disabled} className={className} disabled={pending || disabled} type="submit">
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

type FormActionButtonProps = {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
} & (
  | { name: string; value: string; formAction?: undefined }
  | { formAction: (formData: FormData) => void | Promise<void>; name?: undefined; value?: undefined }
);

/**
 * Submit button for a form with MORE than one submit button, where only
 * the button that was actually clicked should show its own pending label.
 * `useFormStatus().pending` is true for every button in the form during
 * submission (pending state lives on the form, not the button) — so this
 * disables all of them (preventing double-submits) but only swaps the
 * label on the one that matches, via either:
 *  - `name`/`value`: buttons that share the form's own `action` and are
 *    told apart by their own name/value pair (inspects the submitted
 *    FormData, which useFormStatus() exposes as `.data`).
 *  - `formAction`: buttons that each override the form's action with
 *    their own `formAction` prop (compared by reference against
 *    useFormStatus().action, which holds the action of the in-flight
 *    submission).
 */
export function FormActionButton(props: FormActionButtonProps) {
  const { children, pendingLabel, className } = props;
  const status = useFormStatus();
  const isThisPending =
    status.pending &&
    ("formAction" in props && props.formAction !== undefined
      ? status.action === props.formAction
      : status.data?.get(props.name!) === props.value);
  return (
    <button
      aria-disabled={status.pending}
      className={className}
      disabled={status.pending}
      formAction={"formAction" in props ? props.formAction : undefined}
      name={"name" in props ? props.name : undefined}
      type="submit"
      value={"value" in props ? props.value : undefined}
    >
      {isThisPending ? (pendingLabel ?? children) : children}
    </button>
  );
}
