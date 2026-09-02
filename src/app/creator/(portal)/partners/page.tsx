import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatRate } from "@/lib/creators/commission";
import { fetchPartnerShops } from "@/lib/creators/partner-shops";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warn" | "neutral"> = {
  active: "success",
  invited: "warn",
  paused: "warn",
  ended: "neutral",
  declined: "neutral",
};

export default async function CreatorPartnersPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "creator") return null;
  const supabase = await createClient();

  const { data: partnerships } = await supabase
    .from("creator_partnerships")
    .select("id,status,rate_bps,hold_days,currency,seller_account_id")
    .eq("creator_id", actor.creatorId)
    .order("invited_at", { ascending: false });

  const shops = await fetchPartnerShops((partnerships ?? []).map((p) => p.seller_account_id));

  return (
    <main className="sd-main">
      <PageHeader title="Shops you work with" sub="Your agreed rate and hold period with each." />
      {(partnerships ?? []).length === 0 ? (
        <EmptyState title="No shops yet" body="When a shop invites you, it appears here." />
      ) : (
        <div className="grid gap-2.5">
          {(partnerships ?? []).map((partnership) => {
            // The shop leads. Without it a creator working with several shops
            // saw identical rate cards and could not tell which was which.
            const shop = shops.get(partnership.seller_account_id);
            return (
              <Panel key={partnership.id} className="flex items-center justify-between gap-3 px-3.5 py-3">
                <div className="min-w-0">
                  {shop?.slug ? (
                    <Link
                      className="block truncate text-[13.5px] font-bold text-ink no-underline hover:text-accent"
                      href={`/${shop.slug}`}
                    >
                      {shop.displayName}
                    </Link>
                  ) : (
                    <p className="truncate text-[13.5px] font-bold text-ink">
                      {shop?.displayName ?? "A SnapDuka shop"}
                    </p>
                  )}
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {formatRate(partnership.rate_bps)} commission · paid {partnership.hold_days} days
                    after the sale, once the refund window closes
                  </p>
                </div>
                <Badge tone={TONE[partnership.status] ?? "neutral"}>{partnership.status}</Badge>
              </Panel>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-[11.5px] leading-[1.6] text-ink-faint">
        Commission is calculated on the product total after discounts, excluding delivery.
        Where a buyer followed more than one creator link, the most recent one earns.
      </p>
    </main>
  );
}
