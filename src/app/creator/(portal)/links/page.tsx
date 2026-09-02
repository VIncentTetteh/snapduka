import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { appOrigin } from "@/lib/app-url";
import { resolveCreatorContext } from "@/lib/auth/actor";
import { normalizeToOne } from "@/lib/storefront/media";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CreatorLinksPage() {
  const creator = await resolveCreatorContext();
  // Gated on the creator profile so a shop owner promoting another shop qualifies.
  if (!creator) return null;
  const supabase = await createClient();
  const origin = await appOrigin();

  // RLS scopes both of these to links whose partnership belongs to this
  // creator, so no seller filter is needed (or possible) here.
  const [{ data: links }, { data: attributions }] = await Promise.all([
    supabase
      .from("campaign_links")
      .select("id,name,token,active,creator_partnership_id,shops(display_name)")
      .not("creator_partnership_id", "is", null),
    supabase.rpc("campaign_link_totals"),
  ]);

  // Grouped in Postgres: reducing the raw rows here silently stopped counting
  // past PostgREST's 1000-row response cap.
  const stats = new Map<string, { clicks: number; orders: number }>(
    (attributions ?? []).map((row) => [row.campaign_id, { clicks: row.clicks, orders: row.orders }]),
  );

  return (
    <main className="sd-main">
      <PageHeader
        title="My links"
        sub="Only sales through your own link earn commission."
      />
      {(links ?? []).length === 0 ? (
        <EmptyState
          title="No links yet"
          body="The shop creates your link. Ask them for one if it has not appeared here."
        />
      ) : (
        <div className="grid gap-2.5">
          {(links ?? []).map((link) => {
            const stat = stats.get(link.id) ?? { clicks: 0, orders: 0 };
            return (
              <Panel key={link.id} className="px-3.5 py-3">
                <p className="text-[13.5px] font-bold text-ink">{link.name}</p>
                {/* Which shop this link earns from. A creator with links across
                    several shops could not tell them apart otherwise. */}
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {normalizeToOne(link.shops)?.display_name ?? "A SnapDuka shop"}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-[12.5px] text-ink-soft">
                    {origin}/l/{link.token}
                  </code>
                  <CopyButton value={`${origin}/l/${link.token}`} />
                </div>
                <p className="mt-2 text-[12px] text-ink-muted">
                  {stat.clicks} {stat.clicks === 1 ? "visit" : "visits"} · {stat.orders}{" "}
                  {stat.orders === 1 ? "sale" : "sales"}
                </p>
              </Panel>
            );
          })}
        </div>
      )}
    </main>
  );
}
