import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { BrandLink } from "@/components/ui/logo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover stores | SnapDuka",
  description: "Find independent shops selling on SnapDuka across Ghana, Nigeria and Côte d'Ivoire.",
};

const COUNTRY_LABELS: Record<string, string> = {
  GH: "Ghana",
  NG: "Nigeria",
  CI: "Côte d'Ivoire",
};

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; country?: string }>;
}) {
  const filters = await searchParams;
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  let query = client
    .from("discovery_listings")
    .select("shop_id,slug,display_name,country,category,city,description,quality_score")
    .eq("active", true)
    .order("quality_score", { ascending: false })
    .order("shop_id")
    .limit(100);
  if (filters.country) query = query.eq("country", filters.country);
  if (filters.q)
    query = query.or(
      `display_name.ilike.%${filters.q}%,category.ilike.%${filters.q}%,city.ilike.%${filters.q}%`,
    );
  const { data } = await query;

  return (
    <main className="sd-main min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1040px] items-center justify-between px-5">
          <BrandLink />
          <Link
            href="/onboarding"
            className="rounded-[9px] bg-accent px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-accent-deep"
          >
            Create your storefront
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1040px] px-5 pb-24 pt-10">
        <p className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
          Optional discovery
        </p>
        <h1 className="mb-2 font-serif text-[clamp(28px,4vw,40px)] font-medium leading-[1.12] tracking-[-0.015em]">
          Find independent shops
        </h1>
        <p className="mb-8 max-w-[52ch] text-[15.5px] leading-[1.65] text-ink-soft">
          Stores across Ghana, Nigeria and Côte d&rsquo;Ivoire that chose to be discovered. Every one has
          secure Paystack checkout and order tracking.
        </p>

        <form className="mb-8 flex flex-wrap gap-2.5">
          <input
            className="min-h-11 min-w-[14rem] flex-1 rounded-[10px] border border-line-input bg-white px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]"
            defaultValue={filters.q}
            name="q"
            placeholder="Search shops, categories or cities"
          />
          <select
            className="min-h-11 rounded-[10px] border border-line-input bg-white px-3.5 text-[15px] text-ink outline-none focus:border-accent"
            defaultValue={filters.country ?? ""}
            name="country"
          >
            <option value="">All countries</option>
            <option value="GH">Ghana</option>
            <option value="NG">Nigeria</option>
            <option value="CI">Côte d&apos;Ivoire</option>
          </select>
          <button
            className="min-h-11 cursor-pointer rounded-[10px] bg-accent px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-accent-deep"
            type="submit"
          >
            Search
          </button>
        </form>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!data?.length && (
            <div className="col-span-full grid place-items-center rounded-2xl border border-dashed border-[#C9BBA6] bg-raised px-6 py-16 text-center">
              <p className="font-serif text-[19px] font-medium text-ink">No shops found</p>
              <p className="mt-1.5 text-[14px] text-ink-soft">Try a different search or country.</p>
            </div>
          )}
          {data?.map((shop) => (
            <Link
              className="group overflow-hidden rounded-2xl border border-line bg-white no-underline transition-shadow hover:shadow-card"
              href={`/${shop.slug}?campaign=discovery`}
              key={shop.shop_id}
            >
              <span
                aria-hidden="true"
                className="block h-20"
                style={{ background: gradientForSeed(shop.slug ?? String(shop.shop_id)) }}
              />
              <div className="p-4.5">
                <h2 className="m-0 font-serif text-[19px] font-medium tracking-[-0.01em] text-ink">
                  {shop.display_name}
                </h2>
                <p className="m-0 mt-1 text-[13px] font-semibold text-accent">
                  {[shop.category, shop.city, COUNTRY_LABELS[shop.country] ?? shop.country]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {shop.description && (
                  <p className="m-0 mt-2 line-clamp-2 text-[13.5px] leading-[1.6] text-ink-soft">
                    {shop.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
