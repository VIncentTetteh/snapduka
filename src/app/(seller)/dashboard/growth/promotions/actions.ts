"use server";
import { oneOf, PROMOTION_KINDS } from "@/lib/db/enums";
import { revalidatePath } from "next/cache";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";
export async function createPromotion(formData: FormData) {
  const actor=await resolveServerActor(); if(actor.kind!=="seller"||!hasPermission(actor.role??"owner","campaigns.manage")) return;
  const plan=await getSellerPlan(actor.sellerAccountId); if(!planAllows(plan,"promotions")) return;
  const supabase=await createClient(); const {data:shop}=await supabase.from("shops").select("id").eq("seller_account_id",actor.sellerAccountId).single(); if(!shop)return;
  const kind=oneOf(String(formData.get("kind")),PROMOTION_KINDS);if(!kind)return; const value=Number(formData.get("value")); const code=String(formData.get("code")).trim().toUpperCase();
  if(!["fixed","percentage"].includes(kind)||!code||!Number.isInteger(value)||value<=0||(kind==="percentage"&&value>100))return;
  await supabase.from("promotions").insert({seller_account_id:actor.sellerAccountId,shop_id:shop.id,name:String(formData.get("name")).trim()||code,code,kind,value,minimum_minor:Number(formData.get("minimumMinor")||0),redemption_limit:Number(formData.get("redemptionLimit")||0)||null});
  revalidatePath("/dashboard/growth/promotions");
}
