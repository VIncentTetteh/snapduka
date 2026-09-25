"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdCampaign, moveAdBudget, updateAdCampaign } from "@/lib/ads/service";
import { resolveServerActor, type SellerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";

export type AdsActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  /**
   * The idempotency key for the NEXT budget move. The page renders the first
   * one; each successful move hands back a fresh one, so a double-submit of one
   * click shares a key (and moves money once) while a deliberate second top-up
   * gets its own. A failed move keeps its key: if the first attempt did land,
   * the retry replays it instead of moving the money twice.
   */
  nextKey?: string;
};

const PATH = "/dashboard/ads";

type Actor = Awaited<ReturnType<typeof resolveServerActor>>;

/** XOF has no minor unit; everything else is 100 subunits (see payouts/actions.ts). */
function toMinor(value: FormDataEntryValue | null, country: SellerActor["country"]): number | null {
  const amount = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(country === "CI" ? amount : amount * 100);
}

/**
 * Campaign changes are marketing work, so `campaigns.manage` (owner and
 * manager). A team member resolves as `kind: "seller"` with the owner's account
 * id, which is why the role check is here and not assumed from `kind`.
 */
function campaignRefusal(actor: Actor): string | null {
  if (actor.kind !== "seller") return "Sign in again.";
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    return "Your role cannot manage promoted listings.";
  }
  return null;
}

/**
 * Budget moves take money out of (or back into) the withdrawable balance, so
 * they are owner-only like withdrawals. The explicit `role` test keeps this
 * owner-only even if `billing.manage` is widened later; the service writes with
 * the service-role client, so nothing in the database would stop a manager.
 */
function budgetRefusal(actor: Actor): string | null {
  if (actor.kind !== "seller") return "Sign in again.";
  if (actor.role || !hasPermission(actor.role ?? "owner", "billing.manage")) {
    return "Only the account owner can move money in or out of the ad budget.";
  }
  return null;
}

const keySchema = z.uuid();

export async function moveBudgetAction(_previous: AdsActionState, formData: FormData): Promise<AdsActionState> {
  const key = String(formData.get("idempotencyKey") ?? "");
  const actor = await resolveServerActor();
  const refusal = budgetRefusal(actor);
  if (refusal || actor.kind !== "seller") return { status: "error", message: refusal ?? "Sign in again.", nextKey: key };

  if (!keySchema.safeParse(key).success) {
    return { status: "error", message: "Reload the page and try again.", nextKey: randomUUID() };
  }
  const direction = formData.get("direction");
  if (direction !== "top_up" && direction !== "withdraw") {
    return { status: "error", message: "Choose whether to add or withdraw.", nextKey: key };
  }
  const amountMinor = toMinor(formData.get("amount"), actor.country);
  if (amountMinor === null) return { status: "error", message: "Enter an amount.", nextKey: key };

  const result = await moveAdBudget({
    sellerAccountId: actor.sellerAccountId,
    direction,
    amountMinor,
    idempotencyKey: `ads:${key}`,
  });
  if (!result.ok) return { status: "error", message: result.message, nextKey: key };

  revalidatePath(PATH);
  return {
    status: "success",
    message: direction === "top_up" ? "Added to your ad budget." : "Moved back to your available balance.",
    nextKey: randomUUID(),
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(80, "Keep the name under 80 characters."),
  productIds: z.array(z.uuid()).min(1, "Choose at least one product.").max(50),
});

export async function createCampaignAction(_previous: AdsActionState, formData: FormData): Promise<AdsActionState> {
  const actor = await resolveServerActor();
  const refusal = campaignRefusal(actor);
  if (refusal || actor.kind !== "seller") return { status: "error", message: refusal ?? "Sign in again." };

  const parsed = createSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    productIds: formData.getAll("productId").map(String),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the campaign details." };
  }
  const bidMinor = toMinor(formData.get("bid"), actor.country);
  const dailyBudgetMinor = toMinor(formData.get("dailyBudget"), actor.country);
  if (bidMinor === null) return { status: "error", message: "Enter what you will pay per click." };
  if (dailyBudgetMinor === null) return { status: "error", message: "Enter a daily budget." };

  // Ranges, product ownership and the per-campaign product cap are enforced by
  // create_ad_campaign, whose messages are written for sellers.
  const result = await createAdCampaign({
    sellerAccountId: actor.sellerAccountId,
    userId: actor.userId,
    name: parsed.data.name,
    productIds: parsed.data.productIds,
    bidMinor,
    dailyBudgetMinor,
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  return { status: "success", message: "Campaign created." };
}

const CHANGE_MESSAGES = {
  pause: "Campaign paused.",
  resume: "Campaign resumed.",
  end: "Campaign ended.",
} as const;

export async function changeCampaignAction(_previous: AdsActionState, formData: FormData): Promise<AdsActionState> {
  const actor = await resolveServerActor();
  const refusal = campaignRefusal(actor);
  if (refusal || actor.kind !== "seller") return { status: "error", message: refusal ?? "Sign in again." };

  const campaignId = String(formData.get("campaignId") ?? "");
  const action = formData.get("action");
  if (!keySchema.safeParse(campaignId).success) return { status: "error", message: "That campaign was not found." };
  if (action !== "pause" && action !== "resume" && action !== "end") {
    return { status: "error", message: "Choose what to do with the campaign." };
  }

  const result = await updateAdCampaign({
    sellerAccountId: actor.sellerAccountId,
    campaignId,
    change: { action },
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  // Resuming with too little budget is accepted but parks the campaign.
  if (action === "resume" && result.value === "out_of_funds") {
    return { status: "success", message: "Resumed. It runs again once your ad budget covers a click." };
  }
  return { status: "success", message: CHANGE_MESSAGES[action] };
}
