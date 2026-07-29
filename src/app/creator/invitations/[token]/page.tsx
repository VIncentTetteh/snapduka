import { createHash } from "node:crypto";

import { SubmitButton } from "@/components/ui/submit-button";
import { LogoMark } from "@/components/ui/logo";
import { formatRate } from "@/lib/creators/commission";
import { createAdminClient } from "@/lib/supabase/admin";

import { acceptCreatorInvitation, declineCreatorInvitation } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  expired: "That invitation has expired or was withdrawn. Ask the shop to send a new one.",
  blocked: "You cannot be a creator for your own shop.",
};

/**
 * Public. The offer — which shop, what rate — is shown BEFORE asking anyone to
 * sign in: nobody should have to create an account to find out what they were
 * offered.
 */
export default async function CreatorInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const admin = createAdminClient();

  const { data: invite } = await admin
    .from("creator_invitations")
    .select("rate_bps,hold_days,expires_at,seller_account_id")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const { data: shop } = invite
    ? await admin
        .from("shops")
        .select("display_name")
        .eq("seller_account_id", invite.seller_account_id)
        .maybeSingle()
    : { data: null };

  return (
    <main className="sd-main grid min-h-svh place-items-center bg-paper px-5 py-10 text-ink">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2">
          <LogoMark className="h-7 w-7 rounded-lg text-[15px]" />
          <span className="text-[15px] font-bold tracking-[-0.02em]">SnapDuka</span>
        </div>

        {query.error ? (
          <div role="alert" className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-[#7A1B10]">
            {ERRORS[query.error] ?? "That invitation could not be accepted."}
          </div>
        ) : null}

        {!invite ? (
          <>
            <h1 className="mb-2 font-serif text-[26px] font-medium tracking-[-0.01em]">
              This invitation is no longer valid
            </h1>
            <p className="text-[14px] leading-[1.6] text-ink-soft">
              It may have expired, been withdrawn, or already been accepted.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 font-serif text-[26px] font-medium tracking-[-0.01em]">
              {shop?.display_name ?? "A SnapDuka shop"} wants to work with you
            </h1>
            <p className="mb-5 text-[14px] leading-[1.6] text-ink-soft">
              You would earn <strong className="font-bold text-ink">{formatRate(invite.rate_bps)}</strong>{" "}
              of the product total on every sale that comes from your own link — after
              discounts, excluding delivery. Earnings are released{" "}
              {invite.hold_days} days after the sale, once the refund window closes.
            </p>
            <div className="mb-5 rounded-[10px] border border-line bg-white px-3.5 py-3">
              <p className="text-[12.5px] leading-[1.6] text-ink-soft">
                The shop pays you directly by mobile money or bank transfer. SnapDuka
                tracks what you have earned but does not hold or send the money.
              </p>
            </div>
            <div className="grid gap-2">
              <form action={acceptCreatorInvitation}>
                <input name="token" type="hidden" value={token} />
                <SubmitButton
                  className="h-12 w-full cursor-pointer rounded-[11px] border-none bg-accent text-[15px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                  pendingLabel="Accepting…"
                >
                  Accept and start earning
                </SubmitButton>
              </form>
              <form action={declineCreatorInvitation}>
                <input name="token" type="hidden" value={token} />
                <SubmitButton
                  className="h-11 w-full cursor-pointer rounded-[11px] border border-line-strong bg-white text-[13.5px] font-semibold text-ink-soft hover:border-[#B9AC98] hover:text-ink"
                  pendingLabel="Declining…"
                >
                  No thanks
                </SubmitButton>
              </form>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
