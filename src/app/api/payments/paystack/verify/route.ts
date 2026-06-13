import { NextResponse } from "next/server";
import { z } from "zod";

import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ reference: z.string().min(8) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reference." }, { status: 400 });
  const { data: attempt } = await createAdminClient().from("payment_attempts")
    .select("status").eq("reference", parsed.data.reference).maybeSingle();
  if (!attempt) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  const verified = await paystackProvider().verify(parsed.data.reference);
  return NextResponse.json({ providerStatus: verified.status, recordedStatus: attempt.status });
}
