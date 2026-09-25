import { formatMoney, type CurrencyCode } from "@snapduka/core";

/**
 * The landing page's one bold moment: the conversation every social seller in
 * Ghana has had — "how do I know you won't block me after I pay?" — and what
 * happens now instead. A static, readable transcript (an ordered list, so a
 * screen reader hears the exchange in order); the only motion is a single
 * staggered reveal, skipped for visitors who prefer reduced motion.
 *
 * Illustrative amounts in the visitor's currency; the Protect fee shown is
 * computed with the market's real fee rule by the caller.
 */

type Props = {
  currency: CurrencyCode;
  itemMinor: number;
  protectFeeMinor: number;
};

type Line =
  | { kind: "buyer" | "seller"; text: string }
  | { kind: "event"; title: string; detail: string; tone: "held" | "code" | "paid" };

function lines({ currency, itemMinor, protectFeeMinor }: Props): Line[] {
  const item = formatMoney(itemMinor, currency);
  const total = formatMoney(itemMinor + protectFeeMinor, currency);
  return [
    { kind: "buyer", text: "Is the Ankara two-piece still available in M?" },
    { kind: "buyer", text: "How do I know you won't block me after I pay?" },
    {
      kind: "seller",
      text: `Yes, M is in stock — ${item}. Pay with SnapDuka Protect: your money is held until the set is in your hands.`,
    },
    { kind: "event", title: `Payment held · ${total}`, detail: "SnapDuka holds it until delivery", tone: "held" },
    {
      kind: "event",
      title: "Your delivery code: 482 915",
      detail: "Give it to the rider only when you have your order",
      tone: "code",
    },
    { kind: "event", title: "Delivered · seller paid", detail: "Confirmed with the buyer's code", tone: "paid" },
  ];
}

const EVENT_TONE: Record<"held" | "code" | "paid", string> = {
  held: "border-line-strong bg-raised text-ink",
  code: "border-accent/40 bg-accent-tint text-accent-deep",
  paid: "border-success-line bg-success-tint text-success-deep",
};

export function ProtectChat(props: Props) {
  return (
    <figure className="relative mx-auto w-full max-w-[380px]">
      <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-phone">
        <div className="flex items-center gap-3 border-b border-line-soft bg-raised px-4 py-3">
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-accent text-[13px] font-bold text-white">
            AB
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-[14px] font-semibold text-ink">Ama&apos;s Boutique</p>
            <p className="m-0 text-[11.5px] text-ink-muted">Accra · replies in minutes</p>
          </div>
        </div>
        <ol className="m-0 grid list-none gap-2.5 bg-paper px-3.5 py-4" aria-label="A buyer and a seller agree a sale with SnapDuka Protect">
          {lines(props).map((line, index) => {
            const delay = { animationDelay: `${index * 0.45}s` };
            if (line.kind === "event") {
              return (
                <li
                  key={line.title}
                  style={delay}
                  className={`motion-safe:animate-sd-fade-up mx-auto w-[92%] rounded-2xl border px-3.5 py-2.5 text-center ${EVENT_TONE[line.tone]}`}
                >
                  <p className="m-0 text-[13px] font-bold">{line.title}</p>
                  <p className="m-0 text-[11.5px] opacity-80">{line.detail}</p>
                </li>
              );
            }
            const buyer = line.kind === "buyer";
            return (
              <li
                key={line.text}
                style={delay}
                className={`motion-safe:animate-sd-fade-up max-w-[82%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-[1.45] ${
                  buyer
                    ? "justify-self-start rounded-bl-md bg-white text-ink shadow-card"
                    : "justify-self-end rounded-br-md bg-ink text-white"
                }`}
              >
                <span className="sr-only">{buyer ? "Buyer: " : "Seller: "}</span>
                {line.text}
              </li>
            );
          })}
        </ol>
      </div>
      <figcaption className="mt-3 text-center text-[12px] text-ink-muted">
        An example conversation. Amounts include the buyer-paid Protect fee.
      </figcaption>
    </figure>
  );
}
