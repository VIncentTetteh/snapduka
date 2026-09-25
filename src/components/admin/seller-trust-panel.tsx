import { Panel } from "@/components/ui/surface";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What the automated trust layer knows about one seller, for the operator's
 * seller page: the latest trust score and its breakdown, recent KYC checks
 * (masked ids only), and the risk signals the engine has raised.
 *
 * Read-only by design. Operator decisions stay where they were — the
 * verification review form and risk actions on the same page — so automation
 * informs a human and never replaces one.
 */

const COMPONENT_LABEL: Record<string, string> = {
  verification: "Verification",
  accountAge: "Account age",
  completedOrders: "Completed orders",
  refundRate: "Refund rate",
  disputeRate: "Dispute rate",
  fulfilmentSpeed: "Fulfilment speed",
  reviews: "Reviews",
};

// Bounded: this is a summary, and the admin client is not subject to RLS.
const RECENT = 10;

export async function SellerTrustPanel({ sellerId }: { sellerId: string }) {
  const admin = createAdminClient();
  const [{ data: score }, { data: checks }, { data: signals }] = await Promise.all([
    admin
      .from("seller_trust_scores")
      .select("score,tier,components,computed_at,weights_version")
      .eq("seller_account_id", sellerId)
      .maybeSingle(),
    admin
      .from("kyc_checks")
      .select("id,provider,check_type,status,match_score,masked_id,failure_reason,created_at")
      .eq("seller_account_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(RECENT),
    admin
      .from("risk_signals")
      .select("id,signal_type,score,context,state,rules_version,created_at")
      .eq("seller_account_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(RECENT),
  ]);

  const components =
    score?.components && typeof score.components === "object" && !Array.isArray(score.components)
      ? Object.entries(score.components).filter(
          (entry): entry is [string, number] => typeof entry[1] === "number" && entry[0] in COMPONENT_LABEL,
        )
      : [];

  return (
    <Panel className="mb-4 p-4.5">
      <h2 className="mb-3 text-[14px] font-bold text-ink">Trust &amp; risk</h2>

      <section className="mb-4">
        <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">Trust score</h3>
        {score ? (
          <>
            <p className="text-[13px] text-ink">
              <span className="font-serif text-[20px] font-medium">{score.score}</span>
              <span className="text-ink-muted"> / 100 · {score.tier} · computed {new Date(score.computed_at).toLocaleString()} ({score.weights_version})</span>
            </p>
            {components.length > 0 ? (
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-soft sm:grid-cols-4">
                {components.map(([key, value]) => (
                  <li key={key}>
                    {COMPONENT_LABEL[key]}: <span className="font-semibold text-ink">{value}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-[12.5px] text-ink-muted">Not computed yet — scores refresh nightly.</p>
        )}
      </section>

      <section className="mb-4">
        <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">Identity checks</h3>
        {checks && checks.length > 0 ? (
          <ul className="grid gap-1 text-[12.5px] text-ink-soft">
            {checks.map((check) => (
              <li key={check.id}>
                <span className="font-semibold text-ink">{check.check_type}</span> · {check.provider} · {check.status}
                {check.match_score !== null ? ` · match ${check.match_score}` : ""}
                {check.masked_id ? ` · ${check.masked_id}` : ""}
                {check.failure_reason ? ` · ${check.failure_reason}` : ""} · {new Date(check.created_at).toLocaleDateString()}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">No automated checks.</p>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">Risk signals</h3>
        {signals && signals.length > 0 ? (
          <ul className="grid gap-1 text-[12.5px] text-ink-soft">
            {signals.map((signal) => (
              <li key={signal.id}>
                <span className="font-semibold text-ink">{signal.signal_type}</span> · score {signal.score}
                {signal.context ? ` · ${signal.context}` : ""} · {signal.state} ·{" "}
                {new Date(signal.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">No risk signals.</p>
        )}
      </section>
    </Panel>
  );
}
