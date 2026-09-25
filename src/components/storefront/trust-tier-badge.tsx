import { getStorefrontTrustTier, type PublicTrustTier } from "@/lib/risk/trust";

/**
 * The seller's trust tier beside the verified check in the storefront header
 * (flag `trust_score`). Server-only: it looks the tier up itself by slug, so
 * pages render it without threading a seller id through. Rendered inside
 * <Suspense> by the header, so the lookup never delays the page.
 */

const LABEL: Record<PublicTrustTier, string> = {
  bronze: "Bronze seller",
  silver: "Silver seller",
  gold: "Gold seller",
};

// Muted metal tones that sit on the warm paper palette; text stays ink for
// contrast rather than coloured-on-coloured.
const TONE: Record<PublicTrustTier, string> = {
  bronze: "bg-[#F1E2D3] border-[#D9B99A]",
  silver: "bg-[#EEF0F2] border-[#C9CED4]",
  gold: "bg-[#FBF0CF] border-[#E3C66B]",
};

export function TrustTierPill({ tier }: { tier: PublicTrustTier }) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-[1.5] text-ink ${TONE[tier]}`}
      title="Based on this seller's delivery, refund and review record on SnapDuka"
    >
      {LABEL[tier]}
    </span>
  );
}

export async function TrustTierBadge({ slug }: { slug: string }) {
  const tier = await getStorefrontTrustTier(slug);
  return tier ? <TrustTierPill tier={tier} /> : null;
}
