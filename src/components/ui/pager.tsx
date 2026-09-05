import Link from "next/link";

/**
 * Previous / next links for a paged list.
 *
 * Written because there was no way to reach page two of anything. Several
 * queries paged server-side at a fixed size and no control was ever rendered,
 * so a seller with more products than one page simply could not see the rest of
 * their own catalogue unless they knew to hand-edit `?page=` in the URL.
 *
 * Links rather than buttons: these are server components, the pages are
 * server-rendered, and a link works without JavaScript, opens in a new tab, and
 * is announced correctly. There is no total count because counting rows exactly
 * is a second query on every render; `hasNext` comes from asking for one row
 * more than is displayed, which costs nothing.
 */
export function Pager({
  page,
  hasNext,
  basePath,
  params,
}: {
  /** 1-based. */
  page: number;
  hasNext: boolean;
  basePath: string;
  /** Other query parameters to preserve, e.g. a search term or filter. */
  params?: Record<string, string | undefined>;
}) {
  if (page <= 1 && !hasNext) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const linkClass =
    "rounded-[10px] border border-line-input bg-white px-3.5 py-2 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-accent hover:text-accent";
  const disabledClass =
    "rounded-[10px] border border-line-soft bg-raised px-3.5 py-2 text-[13px] font-semibold text-ink-faint";

  return (
    <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link className={linkClass} href={href(page - 1)} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span aria-hidden="true" className={disabledClass}>
          ← Previous
        </span>
      )}

      <span className="text-[12.5px] font-semibold text-ink-muted">Page {page}</span>

      {hasNext ? (
        <Link className={linkClass} href={href(page + 1)} rel="next">
          Next →
        </Link>
      ) : (
        <span aria-hidden="true" className={disabledClass}>
          Next →
        </span>
      )}
    </nav>
  );
}

/**
 * `?page=abc` must not reach `.range(NaN, NaN)`, which PostgREST rejects and
 * Next renders as a 500 for the whole page. Anything that is not a positive
 * integer is page one.
 */
export function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  // A page number far past the end is harmless — it renders empty with a
  // working "Previous" — but an unbounded one invites a pointless deep scan.
  return Math.min(parsed, 10_000);
}
