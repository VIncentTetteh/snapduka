/**
 * Test-only: an in-memory stand-in for the slice of the PostgREST query
 * builder the /api/v1 list routes use — select, eq, order, limit, maybeSingle
 * and the one `or` shape keysetAfterFilter emits.
 *
 * The `or` filter is interpreted, not matched as an opaque string, so the route
 * tests exercise the real paging semantics: a wrong comparison (the old
 * `id > cursor`) or a wrong tie-breaker shows up as skipped or repeated rows.
 * The filter syntax itself was verified against local PostgREST.
 */

export type FakeRow = Record<string, unknown> & { id: string; created_at: string };
type Row = FakeRow;
type Predicate = (row: Row) => boolean;

const KEYSET_OR = /^created_at\.gt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.gt\.([0-9a-f-]+)\)$/;

/**
 * Timestamps in fixtures share one format (PostgREST's, with microseconds and
 * +00:00), so lexical order is time order — which is what Postgres compares.
 */
function compare(a: unknown, b: unknown): number {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export class FakeQuery implements PromiseLike<{ data: Row[] | null; error: null }> {
  private predicates: Predicate[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  readonly calls: string[] = [];

  constructor(private readonly rows: Row[]) {}

  select(columns: string): this {
    this.calls.push(`select:${columns}`);
    return this;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.predicates.push((row) => compare(row[column], value) > 0);
    return this;
  }

  or(filter: string): this {
    this.calls.push(`or:${filter}`);
    const match = KEYSET_OR.exec(filter);
    if (!match) throw new Error(`FakeQuery cannot interpret or(${filter})`);
    const [, after, equal, id] = match;
    this.predicates.push(
      (row) =>
        compare(row.created_at, after) > 0 ||
        (compare(row.created_at, equal) === 0 && compare(row.id, id) > 0),
    );
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.max = count;
    return this;
  }

  private run(): Row[] {
    const filtered = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    filtered.sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const result = compare(a[column], b[column]);
        if (result !== 0) return ascending ? result : -result;
      }
      return 0;
    });
    return this.max === null ? filtered : filtered.slice(0, this.max);
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.run()[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null }).then(onfulfilled, onrejected);
  }
}

/** A fake admin client whose `from(table)` reads `tables[table]`. */
export function fakeAdmin(tables: Record<string, Row[]>) {
  const queries: FakeQuery[] = [];
  return {
    queries,
    from(table: string): FakeQuery {
      const query = new FakeQuery(tables[table] ?? []);
      queries.push(query);
      return query;
    },
  };
}

/**
 * `count` rows for one seller in `batches` groups, each group sharing one
 * created_at exactly (rows inserted in one transaction do), with ids whose
 * order is unrelated to creation order — the shape that broke `id > cursor`.
 */
export function rowsWithSharedTimestamps(
  sellerAccountId: string,
  count: number,
  batches: number,
): (FakeRow & { seller_account_id: string })[] {
  return Array.from({ length: count }, (_, index) => {
    // A multiplicative scramble so id order is not creation order.
    const scrambled = ((index * 7919) % 65_521).toString(16).padStart(12, "0");
    const batch = index % batches;
    return {
      id: `00000000-0000-4000-8000-${scrambled}`,
      seller_account_id: sellerAccountId,
      created_at: `2026-09-2${batch}T10:00:00.123456+00:00`,
    };
  });
}
