import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-[#C9BBA6] bg-raised px-6 py-14 text-center">
      {icon ? (
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent-tint text-accent">
          {icon}
        </span>
      ) : null}
      <p className="font-serif text-[19px] font-medium text-ink">{title}</p>
      {body ? (
        <p className="mt-1.5 max-w-[40ch] text-[14px] leading-[1.6] text-ink-soft">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
