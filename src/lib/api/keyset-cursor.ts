/**
 * Keyset pagination for the public API (/api/v1/orders, customers, products).
 *
 * Those routes ordered by created_at but paged with `id > cursor`. Ids are
 * random UUIDs, unrelated to creation order, so the second page was "rows
 * after a random point in UUID space, sorted by time": it skipped rows whose id
 * happened to sort below the cursor and repeated rows that had already been
 * returned. An integration syncing orders silently missed some of them.
 *
 * The fix pages on the same key it sorts by, made unique with the id as a
 * tie-breaker: order by (created_at, id) and continue strictly after the last
 * row's (created_at, id). Rows created in the same transaction share a
 * created_at exactly (now() is the transaction start), so without the
 * tie-breaker a page boundary inside such a batch would still skip or repeat.
 *
 * The cursor stays an opaque string (the `nextCursor` field keeps its type), so
 * clients that pass it back unchanged keep working. It carries the timestamp
 * exactly as PostgREST returned it: microseconds included. Parsing it into a
 * JS Date would round to milliseconds, and the equality half of the tuple
 * comparison would then never match.
 */

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

const CURSOR_PREFIX = "v2.";
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The (created_at, id) of the last row a client has seen. */
export type KeysetPosition = { createdAt: string; id: string };

export type DecodedCursor =
  | { kind: "keyset"; position: KeysetPosition }
  /** A bare row id: the cursor format this API issued before v2. */
  | { kind: "legacy"; id: string };

/** Clamp `?limit=` to 1..100. Garbage falls back to the default rather than NaN. */
export function parseLimit(raw: string | null): number {
  const value = raw === null ? DEFAULT_PAGE_LIMIT : Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, value));
}

export function encodeCursor(position: KeysetPosition): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify([position.createdAt, position.id])).toString("base64url");
}

/** null means the cursor is malformed; the caller answers 400. */
export function decodeCursor(raw: string): DecodedCursor | null {
  if (UUID_PATTERN.test(raw)) return { kind: "legacy", id: raw.toLowerCase() };
  if (!raw.startsWith(CURSOR_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [createdAt, id] = parsed as unknown[];
  if (typeof createdAt !== "string" || !TIMESTAMP_PATTERN.test(createdAt)) return null;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  return { kind: "keyset", position: { createdAt, id: id.toLowerCase() } };
}

/**
 * PostgREST `or` filter for "strictly after (createdAt, id)" in ascending
 * (created_at, id) order. PostgREST has no row-value comparison, so the tuple
 * `(created_at, id) > (t, i)` is spelled out as `created_at > t OR (created_at
 * = t AND id > i)`. The timestamp is double-quoted because it contains `.` and
 * `:`, which are reserved inside a logic-tree filter. Both inputs have already
 * passed the strict patterns in decodeCursor, so neither can carry a quote.
 */
export function keysetAfterFilter(position: KeysetPosition): string {
  const at = `"${position.createdAt}"`;
  return `created_at.gt.${at},and(created_at.eq.${at},id.gt.${position.id})`;
}

/** The cursor for the page after `rows`, or null when this was the last page. */
export function nextCursorFor(
  rows: readonly { created_at: string; id: string }[] | null,
  limit: number,
): string | null {
  if (!rows || rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return encodeCursor({ createdAt: last.created_at, id: last.id });
}

export type ResolvedCursor = { ok: true; position: KeysetPosition | null } | { ok: false };

/**
 * Turn `?cursor=` into a position. A legacy bare-id cursor is honoured by
 * looking up that row's created_at (scoped to the caller's seller by
 * `createdAtOf`), so a client mid-sync across the deploy continues from the row
 * it last saw instead of restarting or failing. An id the caller cannot see is
 * treated as malformed.
 */
export async function resolveCursor(
  raw: string | null,
  createdAtOf: (id: string) => PromiseLike<string | null>,
): Promise<ResolvedCursor> {
  if (raw === null || raw === "") return { ok: true, position: null };
  const decoded = decodeCursor(raw);
  if (!decoded) return { ok: false };
  if (decoded.kind === "keyset") return { ok: true, position: decoded.position };
  const createdAt = await createdAtOf(decoded.id);
  return createdAt ? { ok: true, position: { createdAt, id: decoded.id } } : { ok: false };
}
