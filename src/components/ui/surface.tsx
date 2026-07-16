import type { ReactNode } from "react";

/** White card on paper background — the standard raised surface. */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-white ${className}`}>
      {children}
    </div>
  );
}

/** Section header used at the top of dashboard/admin screens. */
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="max-w-none font-serif text-[clamp(24px,3vw,32px)] font-medium leading-[1.15] tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {sub ? <p className="mt-1 text-[14.5px] text-ink-soft">{sub}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}
