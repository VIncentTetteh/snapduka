import Link from "next/link";

export type FilterPill = {
  label: string;
  href: string;
  active: boolean;
  count?: number;
};

/** Link-based filter pills (server-rendered; state lives in searchParams). */
export function FilterPills({ pills }: { pills: FilterPill[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <Link
          key={p.label}
          href={p.href}
          aria-current={p.active ? "page" : undefined}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors ${
            p.active
              ? "border-ink bg-ink text-paper"
              : "border-line-strong bg-white text-ink-soft hover:border-[#B9AC98] hover:text-ink"
          }`}
        >
          {p.label}
          {typeof p.count === "number" ? (
            <span className={p.active ? "text-paper/70" : "text-ink-faint"}>
              {p.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
