import Link from "next/link";

/**
 * Locked-feature card shown in place of a gated form. Server component —
 * pages decide visibility from getSellerPlan and render this when the
 * capability is missing or its limit is reached.
 */
export function UpgradePrompt({
  feature,
  planName,
  detail,
}: {
  /** Short feature name, e.g. "Promotions". */
  feature: string;
  /** The seller's current plan name, e.g. "Free". */
  planName: string;
  /** Optional extra line, e.g. "You've used 3 of 3 segments." */
  detail?: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-line-strong bg-white px-5 py-6 text-center">
      <span
        aria-hidden="true"
        className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-accent-tint text-accent"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path
            d="M6 9V6.5a4 4 0 1 1 8 0V9m-9.5 0h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h2 className="text-[15px] font-bold text-ink">{feature} is a paid feature</h2>
      <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] text-ink-soft">
        {detail ?? `The ${planName} plan doesn't include ${feature.toLowerCase()}.`} Upgrade to
        Growth or Scale to unlock it.
      </p>
      <Link
        href="/dashboard/settings/billing"
        className="mt-4 inline-grid min-h-10 place-items-center rounded-[10px] bg-accent px-5 text-[13px] font-bold text-white no-underline transition-colors hover:bg-accent-deep"
      >
        View plans
      </Link>
    </section>
  );
}
