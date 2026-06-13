import { NextResponse } from "next/server";

import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request:Request,{params}:{params:Promise<{caseId:string}>}) {
  const actor=await resolveServerActor();
  if(actor.kind!=="operator") return NextResponse.json({error:"Unauthorized."},{status:401});
  const {caseId}=await params;
  const {data}=await createAdminClient().from("support_cases").select("*,case_messages(*),case_evidence(*)").eq("id",caseId).maybeSingle();
  return data?NextResponse.json(data):NextResponse.json({error:"Not found."},{status:404});
}
