"use server";
import {createHash,randomBytes} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {appOrigin} from "@/lib/app-url";
import {resolveServerActor} from "@/lib/auth/actor";
import {getSellerPlan,planLimit} from "@/lib/billing/resolve";
import {sendEmail} from "@/lib/notifications/email";
import {createClient} from "@/lib/supabase/server";
export async function inviteTeamMember(formData:FormData){
  const actor=await resolveServerActor();if(actor.kind!=="seller"||actor.role)return;
  const email=String(formData.get("email")).trim().toLowerCase();const role=String(formData.get("role"));
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!["manager","catalog","fulfillment","support","analyst"].includes(role))redirect("/dashboard/settings/team?error=Check+the+email+and+role");
  const token=randomBytes(32).toString("hex");const supabase=await createClient();
  // Seats are a plan entitlement: owner + active members + pending invites.
  const [plan,{count:members},{count:invites}]=await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase.from("team_memberships").select("id",{count:"exact",head:true}).eq("seller_account_id",actor.sellerAccountId).eq("active",true),
    supabase.from("team_invitations").select("id",{count:"exact",head:true}).eq("seller_account_id",actor.sellerAccountId).is("accepted_at",null).gt("expires_at",new Date().toISOString()),
  ]);
  const seatLimit=planLimit(plan,"staffAccounts");
  if(1+(members??0)+(invites??0)>=seatLimit){
    redirect(`/dashboard/settings/team?error=${encodeURIComponent(`Your ${plan.planName} plan includes ${seatLimit} staff account${seatLimit===1?" (the owner)":"s"}. Upgrade in Settings → Plan & billing to invite more.`)}`);
  }
  const{data:invite,error}=await supabase.from("team_invitations").insert({seller_account_id:actor.sellerAccountId,email,role,token_hash:createHash("sha256").update(token).digest("hex"),invited_by:actor.userId,expires_at:new Date(Date.now()+7*86_400_000).toISOString()}).select("id").single();
  if(error||!invite)redirect("/dashboard/settings/team?error=Invitation+could+not+be+created");
  const origin=await appOrigin();
  if(!origin){await supabase.from("team_invitations").delete().eq("id",invite.id);redirect("/dashboard/settings/team?error=Application+URL+is+not+configured");}
  const invitationUrl=new URL(`/team/invitations/${token}`,origin).toString();
  try{
    const result=await sendEmail(email,"You were invited to a SnapDuka team",`Sign in with ${email} to accept the ${role} role: ${invitationUrl}\n\nThis invitation expires in 7 days.`);
    if(!result.delivered)throw new Error(result.reason);
  }catch{
    await supabase.from("team_invitations").delete().eq("id",invite.id);
    redirect("/dashboard/settings/team?error=Invitation+email+could+not+be+sent");
  }
  redirect("/dashboard/settings/team?message=Invitation+sent");
}
export async function revokeTeamMember(formData:FormData){const actor=await resolveServerActor();if(actor.kind!=="seller"||actor.role)return;const supabase=await createClient();await supabase.from("team_memberships").update({active:false,revoked_at:new Date().toISOString()}).eq("id",String(formData.get("membershipId"))).eq("seller_account_id",actor.sellerAccountId);revalidatePath("/dashboard/settings/team")}
