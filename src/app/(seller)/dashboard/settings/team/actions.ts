"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {resolveServerActor} from "@/lib/auth/actor";
import {createClient} from "@/lib/supabase/server";
import {inviteTeamMember as inviteTeamMember_} from "@/lib/team/invite";
export async function inviteTeamMember(formData:FormData){
  const actor=await resolveServerActor();if(actor.kind!=="seller"||actor.role)return;
  // The invite itself lives in @/lib/team/invite so the mobile route runs the
  // identical seat check, token hashing and rollback-on-delivery-failure.
  const result=await inviteTeamMember_({sellerAccountId:actor.sellerAccountId,userId:actor.userId},{email:String(formData.get("email")??""),role:String(formData.get("role")??"")});
  if(!result.ok)redirect(`/dashboard/settings/team?error=${encodeURIComponent(result.message)}`);
  redirect("/dashboard/settings/team?message=Invitation+sent");
}
export async function revokeTeamMember(formData:FormData){const actor=await resolveServerActor();if(actor.kind!=="seller"||actor.role)return;const supabase=await createClient();await supabase.from("team_memberships").update({active:false,revoked_at:new Date().toISOString()}).eq("id",String(formData.get("membershipId"))).eq("seller_account_id",actor.sellerAccountId);revalidatePath("/dashboard/settings/team")}
