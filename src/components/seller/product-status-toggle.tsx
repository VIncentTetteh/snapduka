"use client";

import { useFormStatus } from "react-dom";

/**
 * The publish/hide switch on the products list. Its <button> lives inside
 * a <form action={setProductStatusAction}> in the parent server component —
 * this client wrapper is what lets it read useFormStatus() and dim/disable
 * itself while the toggle is in flight, without turning the whole list row
 * into a client component.
 */
export function ProductStatusToggle({
  checked,
  ariaLabel,
  title,
}: {
  checked: boolean;
  ariaLabel: string;
  title: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`relative h-[26px] w-11 rounded-full border-none p-0 transition-colors disabled:cursor-wait disabled:opacity-60 ${
        pending ? "" : "cursor-pointer"
      } ${checked ? "bg-accent" : "bg-line-strong"}`}
      disabled={pending}
      role="switch"
      title={title}
      type="submit"
    >
      <span
        className="absolute top-0.5 block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(33,27,20,0.25)] transition-[left]"
        style={{ left: checked ? "20px" : "2px" }}
      />
    </button>
  );
}
