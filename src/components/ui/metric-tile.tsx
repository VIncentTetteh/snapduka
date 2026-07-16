export function MetricTile({
  label,
  value,
  sub,
  subTone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "muted" | "success" | "warn";
}) {
  const subColor =
    subTone === "success"
      ? "text-success"
      : subTone === "warn"
        ? "text-warn"
        : "text-ink-muted";
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <p className="mb-2 text-[12.5px] font-semibold text-ink-muted">{label}</p>
      <p className="font-serif text-[28px] font-medium leading-none tracking-[-0.01em] text-ink">
        {value}
      </p>
      {sub ? <p className={`mt-2 text-[12.5px] ${subColor}`}>{sub}</p> : null}
    </div>
  );
}
