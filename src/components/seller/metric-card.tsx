export function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="rounded-2xl border border-stone-300 bg-white p-4"><p className="m-0 text-sm font-bold text-stone-600">{label}</p><strong className="text-3xl">{value}</strong>{detail ? <p className="m-0 text-sm">{detail}</p> : null}</article>;
}
