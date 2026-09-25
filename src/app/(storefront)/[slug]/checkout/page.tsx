import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalyticsTracker } from "@/components/storefront/analytics-tracker";
import { CheckoutCartRecovery } from "@/components/storefront/checkout-cart-recovery";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { StoreHeader } from "@/components/storefront/store-header";
import { fulfillmentSummary } from "@/lib/storefront/fulfillment-summary";
import { getPublicProduct, getPublicShop } from "@/lib/storefront/queries";
import { appOrigin } from "@/lib/app-url";
import { mainImageUrl, normalizeToOne, publicMediaUrl } from "@/lib/storefront/media";
import { canonicalStorefrontUrl } from "@/lib/storefront/sharing";
import { isFeatureEnabled } from "@/lib/flags";
import { settlementModeFor } from "@/lib/protect/service";
import { bnplCheckoutOption } from "@/lib/bnpl/availability";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type RequestedLine = { productId: string; variantId?: string | null; quantity: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestedLines(query: {
  product?: string;
  variant?: string;
  qty?: string;
  cart?: string;
}): RequestedLine[] {
  if (query.cart) {
    try {
      const parsed = JSON.parse(query.cart) as RequestedLine[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(0, 50)
        .filter(
          (line) =>
            uuid.test(line.productId) &&
            (!line.variantId || uuid.test(line.variantId)) &&
            Number.isInteger(line.quantity) &&
            line.quantity > 0 &&
            line.quantity <= 99,
        );
    } catch {
      return [];
    }
  }
  const qty = Math.min(99, Math.max(1, Number.parseInt(query.qty ?? "1", 10) || 1));
  return query.product && uuid.test(query.product) && (!query.variant || uuid.test(query.variant))
    ? [{ productId: query.product, variantId: query.variant ?? null, quantity: qty }]
    : [];
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ product?: string; variant?: string; qty?: string; cart?: string; campaign?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const shop = await getPublicShop(slug);
  if (!shop) notFound();
  const canonicalUrl = canonicalStorefrontUrl(await appOrigin(), slug);
  const requested = requestedLines(query);

  if (!requested.length) {
    return (
      <main className="sd-main min-h-svh bg-paper text-ink">
        <StoreHeader
          backHref={`/${slug}`}
          canonicalUrl={canonicalUrl}
          country={shop.country}
          fulfillment={fulfillmentSummary(shop.fulfillment_methods)}
          name={shop.display_name}
          slug={slug}
          verified={Boolean(shop.verified_at)}
        />
        <div className="mx-auto max-w-[640px] px-4 pb-16 pt-5">
          <h1 className="mb-4.5 max-w-none font-serif text-[24px] font-medium">Checkout</h1>
          <CheckoutCartRecovery urlCarriedCart={Boolean(query.cart)}>
            <div className="rounded-2xl border border-dashed border-line-strong bg-white px-6 py-11 text-center">
              <h2 className="mb-2 text-base font-bold">Your cart is empty</h2>
              <p className="mx-auto mb-4.5 max-w-[38ch] text-[13.5px] leading-[1.6] text-ink-soft">
                Browse the store and add something you like — your cart is saved even if you
                leave.
              </p>
              <Link
                href={`/${slug}`}
                className="inline-flex min-h-11 items-center rounded-[10px] bg-accent px-5 text-[13.5px] font-semibold text-white no-underline transition-colors hover:bg-accent-deep"
              >
                Back to store
              </Link>
            </div>
          </CheckoutCartRecovery>
        </div>
      </main>
    );
  }

  const loaded = await Promise.all(
    requested.map(async (line) => ({ line, product: await getPublicProduct(shop.id, line.productId) })),
  );
  if (loaded.some(({ product }) => !product)) notFound();
  const products = loaded.map(({ line, product }) => {
    const selectedVariant = line.variantId
      ? product!.product_variants?.find((variant) => variant.id === line.variantId)
      : null;
    if (line.variantId && !selectedVariant) notFound();
    return {
      id: product!.id,
      name: product!.name,
      currency: product!.currency,
      price_minor: selectedVariant?.price_minor ?? product!.price_minor,
      variantId: selectedVariant?.id ?? null,
      variantName: selectedVariant?.name ?? null,
      quantity: line.quantity,
      // The photo the buyer was just looking at. getPublicProduct already
      // loads product_media, so this was available all along and simply never
      // passed on — checkout was the one surface in the app that showed a
      // coloured square instead of the item, at the moment of paying for it.
      // A variant with its own image wins, matching the product page.
      imageUrl:
        publicMediaUrl(selectedVariant?.image_path) ?? mainImageUrl(product!.product_media),
    };
  });
  const admin = createAdminClient();
  const [{ data: methods }, { data: seller }, { data: countryConfig }, settlementMode, protectFlag] =
    await Promise.all([
    admin
      .from("fulfillment_methods")
      .select("id,name,type,fee_minor,instructions")
      .eq("shop_id", shop.id)
      .eq("active", true)
      .order("position"),
    admin
      .from("seller_accounts")
      .select("status,country,seller_verifications(state),payment_subaccounts(status)")
      .eq("id", shop.seller_account_id)
      .maybeSingle(),
    admin
      .from("country_configs")
      .select("enabled,protect_enabled,protect_fee_bps,protect_fee_min_minor,protect_fee_cap_minor")
      .eq("country", shop.country)
      .maybeSingle(),
    // The seller's effective mode: a pilot seller can be on the ledger before
    // the rest of the market.
    settlementModeFor(shop.seller_account_id),
    isFeatureEnabled("protect", { sellerAccountId: shop.seller_account_id }),
  ]);

  // The subaccount row used to be the gate, and it was doing real work: its
  // existence proved the seller was verified and had settlement details. Under
  // the pooled ledger there is no subaccount, so the same guarantees are stated
  // explicitly rather than dropped — otherwise an unverified seller could take
  // buyer money that SnapDuka then holds and cannot pay out.
  //
  // A payout destination is deliberately NOT required: money may accrue before
  // a seller has told us where to send it. It is only required to withdraw.
  const verification = Array.isArray(seller?.seller_verifications)
    ? seller?.seller_verifications[0]
    : seller?.seller_verifications;
  const legacySubaccount = Array.isArray(seller?.payment_subaccounts)
    ? seller?.payment_subaccounts[0]
    : seller?.payment_subaccounts;

  const sellerCanBeOwedMoney =
    seller?.status === "active" && verification?.state === "verified";

  const onlinePaymentsAvailable = Boolean(
    countryConfig?.enabled &&
      (settlementMode === "ledger"
        ? sellerCanBeOwedMoney
        : // Legacy split: Paystack pays the subaccount directly, so the
          // subaccount existing is still exactly the right condition.
          legacySubaccount?.status === "active"),
  );

  // Protect needs online payment into SnapDuka's account (ledger settlement),
  // the market switched on, and the rollout flag on for this seller. The SQL
  // re-checks all of it when the buyer opts in.
  const protectOffer =
    onlinePaymentsAvailable && protectFlag && countryConfig?.protect_enabled && settlementMode === "ledger"
      ? {
          feeBps: countryConfig.protect_fee_bps,
          minMinor: countryConfig.protect_fee_min_minor,
          capMinor: countryConfig.protect_fee_cap_minor,
        }
      : null;

  // Pay in instalments (flag `bnpl`, ADR-0014): same conditions the BNPL
  // initialize route enforces, so the option never appears only to fail.
  const bnplOffer =
    onlinePaymentsAvailable && products[0]
      ? await bnplCheckoutOption({
          sellerAccountId: shop.seller_account_id,
          country: shop.country,
          currency: products[0].currency as "GHS" | "NGN" | "XOF",
        })
      : null;

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <AnalyticsTracker
        campaign={query.campaign}
        country={shop.country}
        eventType="checkout_start"
        productId={products.length === 1 ? products[0].id : undefined}
        shopId={shop.id}
      />
      <StoreHeader
        backHref={`/${slug}`}
        canonicalUrl={canonicalUrl}
        country={shop.country}
        fulfillment={fulfillmentSummary(shop.fulfillment_methods)}
        logoUrl={publicMediaUrl(normalizeToOne(shop.shop_branding)?.logo_path, "shop-logos")}
        name={shop.display_name}
        slug={slug}
        verified={Boolean(shop.verified_at)}
      />

      <div className="mx-auto max-w-[640px] px-4 pb-16 pt-5">
        <h1 className="mb-1.5 max-w-none font-serif text-[24px] font-medium">
          Complete your order
        </h1>
        <p className="mb-4.5 text-[13px] text-ink-muted">
          Guest checkout — no account needed.
        </p>

        {!methods?.length ? (
          <div
            role="alert"
            className="mb-4 rounded-[10px] border border-warn-line bg-warn-tint px-3.5 py-3 text-[13px] font-semibold text-warn"
          >
            This seller has not enabled delivery or pickup yet.
          </div>
        ) : null}

        <CheckoutForm
          campaignToken={query.campaign}
          country={shop.country}
          fromCart={Boolean(query.cart)}
          methods={methods ?? []}
          onlinePaymentsAvailable={onlinePaymentsAvailable}
          protect={protectOffer}
          bnpl={bnplOffer}
          products={products}
          shopId={shop.id}
          shopName={shop.display_name}
        />
      </div>
    </main>
  );
}
