import { describe, expect, it, vi } from "vitest";

import { paginate } from "./paginate";

/**
 * PostgREST caps a response at db.max_rows = 1000 and applies the cap whether
 * or not the caller asked for a limit, so an unbounded query silently returns
 * a page and looks exactly like a query that matched only that many rows.
 */

type Row = { id: string };

/** A table of `total` rows, served in keyset pages the way PostgREST would. */
function table(total: number, onPage?: (size: number) => void) {
  const all: Row[] = Array.from({ length: total }, (_, i) => ({
    id: `row-${String(i).padStart(4, "0")}`,
  }));
  return async (cursor: string | null, size: number) => {
    const remaining = cursor ? all.filter((row) => row.id > cursor) : all;
    const page = remaining.slice(0, size);
    onPage?.(page.length);
    return { data: page, error: null };
  };
}

describe("paginate", () => {
  it("reads every row, not just the first page", async () => {
    const sizes: number[] = [];
    const { rows, truncated } = await paginate(table(250, (n) => sizes.push(n)), (row) => row.id, {
      pageSize: 100,
    });

    expect(sizes).toEqual([100, 100, 50]);
    expect(rows).toHaveLength(250);
    expect(truncated).toBe(false);
  });

  it("stops at a short page without asking for another", async () => {
    const fetchPage = vi.fn(table(30));
    const { rows } = await paginate(fetchPage, (row) => row.id, { pageSize: 100 });

    expect(rows).toHaveLength(30);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("handles an exact multiple of the page size", async () => {
    // The boundary case: a full final page looks like there may be more, so it
    // takes one extra empty read to know the queue is drained.
    const fetchPage = vi.fn(table(200));
    const { rows } = await paginate(fetchPage, (row) => row.id, { pageSize: 100 });

    expect(rows).toHaveLength(200);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("returns nothing for an empty queue", async () => {
    const { rows, error, truncated } = await paginate(table(0), (row) => row.id);
    expect(rows).toEqual([]);
    expect(error).toBeNull();
    expect(truncated).toBe(false);
  });

  // A ceiling on one invocation, not on the backlog.
  it("stops at maxRows and says so", async () => {
    const { rows, truncated } = await paginate(table(1000), (row) => row.id, {
      pageSize: 100,
      maxRows: 250,
    });

    expect(rows.length).toBeGreaterThanOrEqual(250);
    expect(truncated).toBe(true);
  });

  // A read failure must not look like an empty queue: the caller decides
  // whether to process a partial batch or refuse.
  it("surfaces a read error and keeps what it already read", async () => {
    let call = 0;
    const { rows, error } = await paginate(
      async (cursor, size) => {
        call += 1;
        if (call === 1) return table(1000)(cursor, size);
        return { data: null, error: { message: "boom" } };
      },
      (row) => row.id,
      { pageSize: 100 },
    );

    expect(error).toEqual({ message: "boom" });
    expect(rows).toHaveLength(100);
  });

  /**
   * The head-of-line case, and the reason this is keyset rather than a repeated
   * "take the first N". The restock sweep took the first 100 unnotified
   * requests with no ordering; a request whose product is still unavailable is
   * skipped and stays unnotified, so it matches again on the next read. With a
   * hundred of those at the head, an offset-free repeat-fetch never advances
   * and every other alert is starved forever. A cursor moves past them.
   */
  it("advances past rows that keep matching, instead of re-reading them", async () => {
    const seen: string[] = [];
    const { rows } = await paginate(
      async (cursor, size) => {
        const page = await table(120)(cursor, size);
        page.data.forEach((row) => seen.push(row.id));
        return page;
      },
      (row) => row.id,
      { pageSize: 50 },
    );

    expect(rows).toHaveLength(120);
    // Every row visited exactly once: no row is re-read, so none can block.
    expect(new Set(seen).size).toBe(seen.length);
  });
});
