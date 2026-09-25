import { NextResponse } from "next/server";

import { exportBuyerData } from "@/lib/buyer/account";
import { requireBuyer } from "@/lib/buyer/guard";
import { enforceRateLimit, isResponse } from "@/lib/mobile/guard";
import { failUnexpected } from "@/lib/mobile/response";

/**
 * The Act 843 right of access: everything SnapDuka holds in the buyer's
 * profile, as a JSON download. Built by export_buyer_data() in SQL so the
 * export and the schema cannot drift, and so the sealed payment token (a
 * credential, not personal data) is excluded in exactly one place.
 */
export async function GET() {
  const session = await requireBuyer();
  if (isResponse(session)) return session;

  const limited = await enforceRateLimit("buyer.export", session.buyer.buyerProfileId, {
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const data = await exportBuyerData(session.client);
  if (!data) return failUnexpected("buyer.export", new Error("export returned nothing"));

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="snapduka-my-data-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
