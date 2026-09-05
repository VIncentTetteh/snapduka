/**
 * Reading every row a query matches, not the first page of them.
 *
 * PostgREST caps a response at `db.max_rows` — 1000 here
 * (supabase/config.toml:8) — and applies the cap whether or not the caller
 * asked for a limit. A query with no bound therefore returns *some* rows and
 * looks exactly like a query that matched only that many. Nothing errors, and
 * a `.limit(5000)` is not a workaround: the server cap wins.
 *
 * That is a display bug on a dashboard and a correctness bug in a job
 * processor, where the rows that fall off the end are customers who are never
 * contacted or sellers who are never billed.
 *
 * Keyset, not `.range()`. These callers mutate rows as they process them, so
 * offsets shift underneath the iteration and rows get skipped. A cursor on a
 * monotonic unique column is unaffected by rows leaving the filter — and,
 * importantly, a row that is processed but *stays* matching (a restock alert
 * whose product is still out of stock, a delivery that failed) cannot pin the
 * cursor and starve everything behind it. That head-of-line case is not
 * hypothetical: the restock sweep took the first 100 unnotified requests with
 * no ordering, and a hundred permanently-unavailable products at the head
 * would have blocked every other alert forever.
 */

export type PageResult<T> = { data: T[] | null; error: unknown };

export type PaginateOptions = {
  /** Rows per request. Must stay under the server cap to detect a short page. */
  pageSize?: number;
  /**
   * A ceiling on one invocation, not on the backlog — the next run resumes.
   * It exists so a runaway queue cannot turn one call into an unbounded
   * sequence of side effects.
   */
  maxRows?: number;
};

export type Paginated<T> = {
  rows: T[];
  /** The first read error. `rows` then holds whatever was read before it. */
  error: unknown | null;
  /** True when `maxRows` stopped the read with rows still unvisited. */
  truncated: boolean;
};

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 5000;

/**
 * `fetchPage` must apply the caller's filters plus `.order(cursorColumn)`,
 * `.limit(size)`, and `.gt(cursorColumn, cursor)` when a cursor is given.
 * `cursorOf` reads the cursor value off the last row of a page.
 */
export async function paginate<T>(
  fetchPage: (cursor: string | null, size: number) => PromiseLike<PageResult<T>>,
  cursorOf: (row: T) => string,
  options: PaginateOptions = {},
): Promise<Paginated<T>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const rows: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    const { data, error } = await fetchPage(cursor, pageSize);
    // Return what was read rather than pretending the queue was empty: the
    // caller has to be able to tell "nothing matched" from "the read broke".
    if (error) return { rows, error, truncated: false };
    if (!data || data.length === 0) return { rows, error: null, truncated: false };

    rows.push(...data);
    cursor = cursorOf(data[data.length - 1]);

    // A short page is the last page.
    if (data.length < pageSize) return { rows, error: null, truncated: false };
    if (rows.length >= maxRows) return { rows, error: null, truncated: true };
  }
}
