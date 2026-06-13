"use server";
import { revalidatePath } from "next/cache";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
export async function createPromotion(formData: FormData) {
  const actor=await resolveServerActor(); if(actor.kind!=="seller") return;
  const supabase=await createClient(); const {data:shop}=await supabase.from("shops").select("id").eq("seller_account_id",actor.sellerAccountId).single(); if(!shop)return;
  const kind=String(formData.get("kind")); const value=Number(formData.get("value")); const code=String(formData.get("code")).trim().toUpperCase();
  if(!["fixed","percentage"].includes(kind)||!code||!Number.isInteger(value)||value<=0||(kind==="percentage"&&value>100))return;
  await supabase.from("promotions").insert({seller_account_id:actor.sellerAccountId,shop_id:shop.id,name:String(formData.get("name")).trim()||code,code,kind,value,minimum_minor:Number(formData.get("minimumMinor")||0),redemption_limit:Number(formData.get("redemptionLimit")||0)||null});
  revalidatePath("/dashboard/growth/promotions");
}
