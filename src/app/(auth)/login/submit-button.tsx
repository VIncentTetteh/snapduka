"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: string;
  pendingLabel: string;
  className?: string;
};

export function SubmitButton({
  children,
  pendingLabel,
  className,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-disabled={pending}
      className={className}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
