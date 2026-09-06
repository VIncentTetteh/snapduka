import {
  CHANNEL_LABEL,
  shareCaption,
  shortLinkUrl,
  type ShareChannel,
} from "@snapduka/core";

import { ShareButtons } from "@/components/share/share-buttons";
import { ActionBanner } from "@/components/ui/action-banner";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { appOrigin } from "@/lib/app-url";
import { resolveCreatorContext } from "@/lib/auth/actor";
import { fetchPartnerShops } from "@/lib/creators/partner-shops";
import type { CurrencyCode } from "@/lib/countries/types";
import { normalizeToOne } from "@/lib/storefront/media";
import { createClient } from "@/lib/supabase/server";

import { createCreatorLinks } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The creator's workspace, not a list.
 *
 * This page used to be read-only, and its empty state said "The shop creates
 * your link. Ask them for one if it has not appeared here." An influencer who
 * had just accepted an invitation could do nothing at all until a shop owner
 * remembered to press a button in a web dashboard — and the link they eventually
 * got pointed at the shop homepage, never at the product being posted about.
 *
 * So the unit of work here is a product, and what comes back is the thing an
 * influencer actually posts: a tracked link per channel, and the caption to go
 * with it.
 */
export default async function CreatorLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; shop?: string }>;
}) {
  const creator = await resolveCreatorContext();
  // Gated on the creator profile so a shop owner promoting another shop qualifies.
  if (!creator) return null;

  const params = await searchParams;
  const supabase = await createClient();
  const origin = await appOrigin();

  // RLS scopes all three to this creator: partnerships they are in, links whose
  // partnership is theirs, and the totals for those links.
  const [{ data: partnerships }, { data: links }, { data: totals }] = await Promise.all([
    supabase
      .from("creator_partnerships")
      .select("id,status,rate_bps,seller_account_id")
      .eq("status", "active"),
    supabase
      .from("campaign_links")
      .select("id,name,token,channel,destination_path,active,creator_partnership_id,shops(display_name,slug)")
      .not("creator_partnership_id", "is", null)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    supabase.rpc("campaign_link_totals"),
  ]);

  const stats = new Map<string, { clicks: number; orders: number }>(
    (totals ?? []).map((row) => [row.campaign_id, { clicks: row.clicks, orders: row.orders }]),
  );

  // Neither creator_partnerships nor the links list carries the shop's name in a
  // way PostgREST can embed from the partnership side, so this is the same
  // explicit lookup /creator/partners uses.
  const partnerShops = await fetchPartnerShops(
    (partnerships ?? []).map((row) => row.seller_account_id),
  );

  // The shop being worked on. Defaults to the first active partnership so the
  // page is never a chooser-before-anything-useful.
  const selectedPartnershipId = params.shop ?? partnerships?.[0]?.id ?? null;
  const selected = (partnerships ?? []).find((row) => row.id === selectedPartnershipId) ?? null;

  const { data: shop } = selected
    ? await supabase
        .from("shops")
        .select("id,slug,display_name,currency")
        .eq("seller_account_id", selected.seller_account_id)
        .maybeSingle()
    : { data: null };

  // What the creator can promote. Active products only — a link to a draft or
  // archived product would 404 for whoever taps it.
  const { data: products } = shop
    ? await supabase
        .from("products")
        .select("id,name,price_minor,currency,video_url")
        .eq("shop_id", shop.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(60)
    : { data: null };

  // Group the existing links by what they point at, because that is how a
  // creator thinks about them: one post, four channels.
  const byDestination = new Map<string, typeof links>();
  for (const link of links ?? []) {
    const list = byDestination.get(link.destination_path) ?? [];
    list.push(link);
    byDestination.set(link.destination_path, list);
  }

  return (
    <main className="sd-main">
      <PageHeader
        title="My links"
        sub="Pick what you want to post about and get your own tracked link. Only sales through your link earn commission."
      />

      <ActionBanner
        error={params.error}
        saved={
          params.saved === "created"
            ? "Your links are ready — copy the caption and link below."
            : params.saved === "exists"
              ? "You already have links for that one."
              : undefined
        }
      />

      {(partnerships ?? []).length === 0 ? (
        <EmptyState
          title="No shops yet"
          body="When a shop invites you and you accept, it appears here and you can start making links."
        />
      ) : (
        <>
          {/* Shop switcher, only when there is a choice to make. */}
          {(partnerships ?? []).length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {(partnerships ?? []).map((partnership) => {
                const name =
                  partnerShops.get(partnership.seller_account_id)?.displayName ?? "Shop";
                const active = partnership.id === selectedPartnershipId;
                return (
                  <a
                    key={partnership.id}
                    href={`/creator/links?shop=${partnership.id}`}
                    className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold no-underline ${
                      active
                        ? "bg-ink text-paper"
                        : "border border-line bg-white text-ink-soft hover:text-ink"
                    }`}
                  >
                    {name}
                  </a>
                );
              })}
            </div>
          ) : null}

          {shop && selected ? (
            <Panel className="mb-5 px-4 py-4">
              <h2 className="mb-1 text-[14px] font-bold text-ink">
                Make a link for {shop.display_name}
              </h2>
              <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
                You earn {(selected.rate_bps / 100).toFixed(selected.rate_bps % 100 === 0 ? 0 : 2)}%
                of the product total on sales through your own link.
              </p>

              <form action={createCreatorLinks} className="grid gap-2.5">
                <input name="partnershipId" type="hidden" value={selected.id} />

                <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink">
                  What are you posting about?
                  <select
                    className="h-11 w-full rounded-[10px] border border-line-input bg-white px-3 text-[14px] text-ink outline-none focus:border-accent"
                    defaultValue={`/${shop.slug}`}
                    name="destinationPath"
                  >
                    <option value={`/${shop.slug}`}>The whole shop</option>
                    {(products ?? []).map((product) => (
                      <option key={product.id} value={`/${shop.slug}/products/${product.id}`}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>

                <SubmitButton
                  className="h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4 text-[14px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                  pendingLabel="Making your links…"
                >
                  Get my link
                </SubmitButton>
              </form>

              {(products ?? []).length === 0 ? (
                <p className="mt-2.5 text-[12px] text-ink-muted">
                  This shop has no live products yet, so for now you can only link to the shop
                  itself.
                </p>
              ) : null}
            </Panel>
          ) : null}

          {byDestination.size === 0 ? (
            <EmptyState
              title="No links yet"
              body="Pick a product above and press Get my link. You will get one link per app, so you can see which one brings sales."
            />
          ) : (
            <div className="grid gap-3">
              {[...byDestination.entries()].map(([destination, group]) => {
                const first = group![0];
                const shopName = normalizeToOne(first.shops)?.display_name ?? "A SnapDuka shop";
                const shopSlug = normalizeToOne(first.shops)?.slug ?? "";
                const product = (products ?? []).find(
                  (row) => destination === `/${shopSlug}/products/${row.id}`,
                );

                // The same caption both clients use, so what a creator posts
                // matches what the shop sees in Share Studio.
                const caption = shareCaption({
                  shopName,
                  product: product
                    ? {
                        name: product.name,
                        priceMinor: product.price_minor,
                        currency: product.currency as CurrencyCode,
                        videoUrl: product.video_url,
                      }
                    : undefined,
                });

                // The unit of work is a post, not a URL: the image, the words
                // and the creator's own link, ready to send in one action. The
                // card is requested against the partnership so the API resolves
                // the shop from it and stamps the creator's token on the QR —
                // a shop's own card would attribute the sale to the shop and
                // earn the creator nothing.
                const storyCardUrl = `/api/share/story-card?partnership=${first.creator_partnership_id}${
                  product ? `&product=${product.id}` : ""
                }`;
                const groupLinks = group!.map((link) => ({
                  channel: link.channel,
                  shortUrl: shortLinkUrl(origin, link.token),
                }));
                const fallbackUrl =
                  groupLinks.find((link) => link.channel === "other")?.shortUrl ??
                  groupLinks[0]?.shortUrl ??
                  `${origin}${destination}`;

                return (
                  <Panel key={destination} className="px-4 py-3.5">
                    <p className="text-[13.5px] font-bold text-ink">
                      {product?.name ?? shopName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">{shopName}</p>

                    <div className="mt-3">
                      <ShareButtons
                        caption={caption}
                        links={groupLinks}
                        shopName={shopName}
                        storeUrl={fallbackUrl}
                        storyCardUrl={storyCardUrl}
                      />
                    </div>

                    <details className="mt-3">
                      <summary className="cursor-pointer text-[12px] font-semibold text-ink-soft hover:text-ink">
                        How each app is doing
                      </summary>
                      <div className="mt-2 grid gap-2">
                      {group!.map((link) => {
                        const stat = stats.get(link.id) ?? { clicks: 0, orders: 0 };
                        const url = shortLinkUrl(origin, link.token);
                        return (
                          <div
                            key={link.id}
                            className="flex items-center justify-between gap-2 border-b border-line-soft pb-2 last:border-0 last:pb-0"
                          >
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-semibold text-ink">
                                {CHANNEL_LABEL[link.channel as ShareChannel] ?? link.channel}
                              </p>
                              <code className="block truncate font-mono text-[11.5px] text-ink-soft">
                                {url}
                              </code>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-[11.5px] text-ink-muted">
                                {stat.clicks} {stat.clicks === 1 ? "visit" : "visits"} ·{" "}
                                {stat.orders} {stat.orders === 1 ? "sale" : "sales"}
                              </span>
                              {/* Caption and link together: the thing that gets
                                  pasted, not just the URL. */}
                              <CopyButton value={`${caption}\n${url}`} />
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </details>
                  </Panel>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
