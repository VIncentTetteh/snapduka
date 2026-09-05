/**
 * The outcome of a server action, said out loud.
 *
 * Server actions here refuse by redirecting back with `?error=`, and a page
 * that does not render it is indistinguishable from one where the action
 * silently did nothing — which is the defect this component exists to close, so
 * it is worth having in one place rather than six slightly different copies.
 */
export function ActionBanner({ error, saved }: { error?: string; saved?: string }) {
  if (!error && !saved) return null;

  return error ? (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
    >
      {error}
    </div>
  ) : (
    <div
      role="status"
      className="mb-4 rounded-xl border border-line bg-raised px-4 py-3 text-[13px] font-semibold text-ink"
    >
      {saved}
    </div>
  );
}
