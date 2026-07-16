export type TimelineStep = {
  title: string;
  detail?: string;
  state: "done" | "current" | "pending";
};

/** Vertical progress timeline (order tracking, order detail). */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="grid list-none gap-0 p-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={step.title} className="relative flex gap-3.5 pb-0">
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 ${
                  step.state === "done"
                    ? "border-success bg-success"
                    : step.state === "current"
                      ? "border-accent bg-white"
                      : "border-[#C9BBA6] bg-white"
                }`}
              >
                {step.state === "done" ? (
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M3 7.4 5.8 10l5.2-6"
                      stroke="#fff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : step.state === "current" ? (
                  <span className="h-2 w-2 rounded-full bg-accent" />
                ) : null}
              </span>
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={`w-0.5 flex-1 ${step.state === "done" ? "bg-success-line" : "bg-line"}`}
                />
              ) : null}
            </div>
            <div className={isLast ? "pb-0" : "pb-5"}>
              <p
                className={`text-[14.5px] font-semibold leading-[22px] ${
                  step.state === "pending" ? "text-ink-faint" : "text-ink"
                }`}
              >
                {step.title}
              </p>
              {step.detail ? (
                <p className="mt-0.5 text-[12.5px] text-ink-muted">{step.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
