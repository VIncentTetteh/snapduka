import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

type SettingCard = {
  title: string;
  description: string;
  href: string;
  status: string;
  tone: BadgeTone;
};

export default async function SettingsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();

  const [
    { data: branding },
    { count: fulfillmentCount },
    { data: subscription },
    { count: teamCount },
    { data: discovery },
    { count: keyCount },
  ] = await Promise.all([
    supabase
      .from("shop_branding")
      .select("id")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("fulfillment_methods")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("active", true),
    supabase
      .from("seller_subscriptions")
      .select("state, plans(code)")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("team_memberships")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId),
    supabase
      .from("discovery_preferences")
      .select("opted_in")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId),
  ]);

  const plans = subscription?.plans as { code?: string } | { code?: string }[] | null | undefined;
  const planCode = (Array.isArray(plans) ? plans[0]?.code : plans?.code) ?? "free";
  const planLabel = `${planCode.charAt(0).toUpperCase()}${planCode.slice(1)} plan`;
  const members = Math.max(teamCount ?? 0, 1);

  const cards: SettingCard[] = [
    {
      title: "Store & branding",
      description: "Store name, colours, logo and custom domains.",
      href: "/dashboard/settings/branding",
      status: branding ? "Configured" : "Default look",
      tone: branding ? "success" : "neutral",
    },
    {
      title: "Fulfilment",
      description: "Delivery zones, pickup points and fees applied at checkout.",
      href: "/dashboard/settings/fulfillment",
      status: fulfillmentCount
        ? `${fulfillmentCount} ${fulfillmentCount === 1 ? "method" : "methods"}`
        : "Not set up",
      tone: fulfillmentCount ? "success" : "warn",
    },
    {
      title: "Payments & billing",
      description: "Your SnapDuka plan, entitlements and invoices.",
      href: "/dashboard/settings/billing",
      status: planLabel,
      tone: "neutral",
    },
    {
      title: "Notifications",
      description: "Choose how order and payment updates reach you.",
      href: "/dashboard/settings/notifications",
      status: "On",
      tone: "success",
    },
    {
      title: "Team",
      description: "Invite teammates and manage what they can do.",
      href: "/dashboard/settings/team",
      status: `${members} ${members === 1 ? "member" : "members"}`,
      tone: "neutral",
    },
    {
      title: "Discovery",
      description: "Control whether your store appears in public discovery.",
      href: "/dashboard/settings/discovery",
      status: discovery?.opted_in ? "Opted in" : "Opted out",
      tone: discovery?.opted_in ? "success" : "neutral",
    },
    {
      title: "Developer tools",
      description: "API keys and integrations for your own automations.",
      href: "/dashboard/settings/developers",
      status: keyCount ? `${keyCount} ${keyCount === 1 ? "key" : "keys"}` : "Not set up",
      tone: keyCount ? "success" : "neutral",
    },
    {
      title: "Balance & payouts",
      description: "Available balance, payout requests and history.",
      href: "/dashboard/payouts",
      status: "View",
      tone: "accent",
    },
  ];

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Settings"
        sub="Manage how your storefront, delivery, team, and integrations work."
      />
      <section className="grid gap-3.5 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-2xl border border-line bg-white p-4.5 no-underline transition-colors hover:border-[#B9AC98]"
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="text-[14.5px] font-bold text-ink">{card.title}</h2>
              <Badge tone={card.tone}>{card.status}</Badge>
            </div>
            <p className="text-[12.5px] leading-[1.55] text-ink-soft">{card.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
