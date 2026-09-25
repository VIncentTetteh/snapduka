import { CapitalAcceptForm } from "@/components/seller/capital-accept-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import {
  getCapitalOverview,
  liveAdvance,
  type FinancingAdvanceView,
  type FinancingEligibility,
} from "@/lib/financing/service";
import {
  financingReasonCopy,
  financingTermsLines,
  formatBps,
  repaymentProgress,
} from "@/lib/financing/terms";
import { formatMoney, type CurrencyCode } from "@snapduka/core";

export const dynamic = "force-dynamic";

const ADVANCE_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  accepted: { label: "Waiting for our partner to send the money", tone: "warn" },
  disbursed: { label: "Received, repaying from sales", tone: "accent" },
  repaying: { label: "Repaying from sales", tone: "accent" },
  repaid: { label: "Repaid", tone: "success" },
  cancelled: { label: "Not funded", tone: "neutral" },
  defaulted: { label: "Closed by the partner, unpaid", tone: "danger" },
  written_off: { label: "Closed by the partner", tone: "neutral" },
};

function stateSpec(state: string): { label: string; tone: BadgeTone } {
  return ADVANCE_STATE[state] ?? { label: state, tone: "neutral" };
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Capital: revenue-based stock financing funded by a licensed lending partner
 * (ADR-0014). SnapDuka does not lend; it shows the offer, records the seller's
 * acceptance and repays the partner from a share of sales.
 *
 * Owner only. A team member resolves as `kind: "seller"` with the owner's
 * account id, and getCapitalOverview mints an offer as a side effect, so the
 * page does not even load the overview for them.
 */
export default async function CapitalPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;

  const header = (
    <PageHeader
      title="Capital"
      sub="Money for stock, funded by our licensed lending partner and repaid from a share of your sales."
    />
  );

  if (actor.role) {
    return (
      <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
        {header}
        <Panel className="p-4.5">
          <h2 className="mb-1 text-[14px] font-bold">Only the account owner can see Capital</h2>
          <p className="text-[12.5px] leading-[1.6] text-ink-soft">
            Financing offers are made to the shop owner, who is the only person who can accept one.
          </p>
        </Panel>
      </main>
    );
  }

  const overview = await getCapitalOverview({ sellerAccountId: actor.sellerAccountId, country: actor.country });

  if (!overview.enabled) {
    return (
      <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
        {header}
        <Panel className="p-4.5">
          <h2 className="mb-1 text-[14px] font-bold">Capital is not available yet</h2>
          <p className="text-[12.5px] leading-[1.6] text-ink-soft">
            We are opening it to shops gradually. When it reaches yours, any offer you qualify for will appear here.
          </p>
        </Panel>
      </main>
    );
  }

  const { eligibility, offer, advances, partnerReady } = overview;
  const live = liveAdvance(advances);
  const history = advances.filter((advance) => advance.id !== live?.id);

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      {header}

      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-4">
          {live ? <LiveAdvance advance={live} /> : null}

          {offer ? (
            <Panel className="p-4.5">
              <h2 className="mb-1 text-[14px] font-bold">Your offer</h2>
              <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
                Valid until {shortDate(offer.expiresAt)}. Funded by our licensed lending partner; SnapDuka does not
                lend money.
              </p>
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <Figure label="You receive" value={formatMoney(offer.principalMinor, offer.currency)} />
                <Figure label="Fixed fee" value={formatMoney(offer.feeMinor, offer.currency)} />
                <Figure label="You repay in total" value={formatMoney(offer.totalRepayableMinor, offer.currency)} />
                <Figure label="Share of each sale" value={formatBps(offer.sweepBps)} />
              </div>
              <ul className="mb-4 grid list-disc gap-1.5 pl-5 text-[12.5px] leading-[1.6] text-ink-soft">
                {financingTermsLines({
                  principal: formatMoney(offer.principalMinor, offer.currency),
                  fee: formatMoney(offer.feeMinor, offer.currency),
                  total: formatMoney(offer.totalRepayableMinor, offer.currency),
                  sweepPercent: formatBps(offer.sweepBps),
                }).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <CapitalAcceptForm
                offerId={offer.id}
                expectedTotalMinor={offer.totalRepayableMinor}
                termsVersion={offer.termsVersion}
                principalLabel={formatMoney(offer.principalMinor, offer.currency)}
              />
            </Panel>
          ) : null}

          {!live && !offer ? (
            <Eligibility eligibility={eligibility} partnerReady={partnerReady} />
          ) : null}
        </div>

        <div className="grid gap-4">
          <EligibilityFacts eligibility={eligibility} />
          {history.length ? <History advances={history} /> : null}
        </div>
      </div>
    </main>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-raised px-3.5 py-3">
      <p className="text-[12px] font-semibold text-ink-muted">{label}</p>
      <p className="mt-0.5 font-serif text-[20px] font-medium text-ink">{value}</p>
    </div>
  );
}

function LiveAdvance({ advance }: { advance: FinancingAdvanceView }) {
  const spec = stateSpec(advance.state);
  const progress = repaymentProgress(advance);
  const currency: CurrencyCode = advance.currency;
  const awaiting = advance.state === "accepted";

  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper">
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,152,111,0.22)_0%,transparent_55%)]"
      />
      <div className="relative">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold text-[#B8AEA1]">
            {awaiting ? "Advance accepted" : "Left to repay"}
          </p>
          <Badge tone={spec.tone}>{spec.label}</Badge>
        </div>
        <p className="font-serif text-[clamp(32px,4vw,40px)] font-medium tracking-[-0.01em]">
          {formatMoney(awaiting ? advance.principalMinor : progress.remainingMinor, currency)}
        </p>
        {awaiting ? (
          <p className="mt-3 text-[12px] leading-[1.6] text-[#B8AEA1]">
            Accepted {shortDate(advance.acceptedAt)}. Nothing is repaid until the money reaches your balance.
          </p>
        ) : (
          <>
            <div
              className="mt-4 h-2 overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-label="Repaid so far"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-[#B8AEA1]">
              {formatMoney(progress.repaidMinor, currency)} of {formatMoney(advance.totalRepayableMinor, currency)}{" "}
              repaid ({progress.percent}%). {formatBps(advance.sweepBps)} of each sale that clears goes towards it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Eligibility({ eligibility, partnerReady }: { eligibility: FinancingEligibility; partnerReady: boolean }) {
  if (eligibility.eligible && !partnerReady) {
    return (
      <Panel className="p-4.5">
        <h2 className="mb-1 text-[14px] font-bold">You qualify</h2>
        <p className="text-[12.5px] leading-[1.6] text-ink-soft">
          Our lending partner is not live in your market yet. Your offer will appear here as soon as it is.
        </p>
      </Panel>
    );
  }
  if (eligibility.eligible) {
    return (
      <Panel className="p-4.5">
        <h2 className="mb-1 text-[14px] font-bold">No offer right now</h2>
        <p className="text-[12.5px] leading-[1.6] text-ink-soft">Check back soon.</p>
      </Panel>
    );
  }
  return (
    <Panel className="p-4.5">
      <h2 className="mb-1 text-[14px] font-bold">Not eligible yet</h2>
      <p className="mb-2 text-[12.5px] leading-[1.6] text-ink-soft">What stands in the way:</p>
      <ul className="grid list-disc gap-1.5 pl-5 text-[12.5px] leading-[1.6] text-ink-soft">
        {eligibility.reasons.map((reason) => (
          <li key={reason}>{financingReasonCopy(reason)}</li>
        ))}
      </ul>
    </Panel>
  );
}

function EligibilityFacts({ eligibility }: { eligibility: FinancingEligibility }) {
  const currency: CurrencyCode = eligibility.currency;
  const facts: { label: string; value: string }[] = [
    { label: "Online sales, last 90 days", value: formatMoney(eligibility.gmv90dMinor, currency) },
    { label: "Paid orders, last 90 days", value: String(eligibility.orders90d) },
    { label: "Refund rate", value: formatBps(eligibility.refundRateBps) },
    { label: "Card chargeback rate", value: formatBps(eligibility.chargebackRateBps) },
    { label: "Trust tier", value: eligibility.trustTier ?? "Not rated yet" },
  ];
  return (
    <Panel className="overflow-hidden">
      <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">What offers are based on</h2>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex items-center justify-between gap-3 border-b border-[#F7F2EA] px-4.5 py-2.5 text-[12.5px] last:border-b-0"
        >
          <span className="text-ink-soft">{fact.label}</span>
          <span className="font-bold capitalize text-ink">{fact.value}</span>
        </div>
      ))}
    </Panel>
  );
}

function History({ advances }: { advances: FinancingAdvanceView[] }) {
  return (
    <Panel className="overflow-hidden">
      <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">Past advances</h2>
      {advances.map((advance) => {
        const spec = stateSpec(advance.state);
        return (
          <div key={advance.id} className="border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-bold text-ink">
                {formatMoney(advance.principalMinor, advance.currency)}
              </span>
              <Badge tone={spec.tone}>{spec.label}</Badge>
            </div>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              Accepted {shortDate(advance.acceptedAt)} · {formatMoney(advance.sweptMinor, advance.currency)} of{" "}
              {formatMoney(advance.totalRepayableMinor, advance.currency)} repaid
            </p>
          </div>
        );
      })}
    </Panel>
  );
}
