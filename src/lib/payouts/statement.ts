/**
 * A seller's wallet statement: every movement on their own ledger accounts in a
 * period, with opening and closing balances — the document a bank or a lender
 * asks for when a trader applies for credit. Pure, so it is testable without a
 * database; the route fetches the rows.
 */

export type StatementEntry = {
  id: string;
  created_at: string;
  amount_minor: number;
  balance_after_minor: number;
  account: { kind: string } | null;
  transaction: { kind: string; reason: string | null; orders: { public_reference: string } | null } | null;
};

const ACCOUNT_LABEL: Record<string, string> = {
  seller_pending: "On hold",
  seller_available: "Available",
  seller_payout_reserved: "Withdrawal in progress",
  seller_dispute_reserve: "Reserved for chargeback",
};

export type StatementSummary = {
  account: string;
  openingMinor: number;
  closingMinor: number;
};

/**
 * Seller-perspective amount: ledger entries are debit-positive, and every
 * seller account is a liability (credit-normal), so money owed to the seller
 * is a negative entry. The statement shows it the way a person reads a bank
 * statement: in positive, out negative.
 */
export function sellerAmount(entry: Pick<StatementEntry, "amount_minor">): number {
  return -entry.amount_minor;
}

export function buildStatement(entries: StatementEntry[]): {
  rows: (string | number)[][];
  summary: StatementSummary[];
} {
  const ordered = [...entries].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );

  const byAccount = new Map<string, StatementSummary>();
  for (const entry of ordered) {
    const kind = entry.account?.kind ?? "unknown";
    const amount = sellerAmount(entry);
    const existing = byAccount.get(kind);
    if (!existing) {
      byAccount.set(kind, {
        account: ACCOUNT_LABEL[kind] ?? kind,
        openingMinor: entry.balance_after_minor - amount,
        closingMinor: entry.balance_after_minor,
      });
    } else {
      existing.closingMinor = entry.balance_after_minor;
    }
  }

  const rows = ordered.map((entry) => [
    entry.created_at,
    ACCOUNT_LABEL[entry.account?.kind ?? ""] ?? entry.account?.kind ?? "",
    entry.transaction?.kind ?? "",
    entry.transaction?.reason ?? "",
    entry.transaction?.orders?.public_reference ?? "",
    sellerAmount(entry),
    entry.balance_after_minor,
  ]);

  return { rows, summary: [...byAccount.values()] };
}

export const STATEMENT_HEADERS = [
  "date",
  "account",
  "type",
  "description",
  "order_reference",
  "amount_minor",
  "balance_after_minor",
];
