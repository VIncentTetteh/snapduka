/**
 * Visual marker for required fields. Pair with `required` / `aria-required`
 * on the input itself; screen readers announce the attribute, the asterisk
 * is for sighted users.
 */
export function Req() {
  return (
    <span aria-hidden="true" className="ml-0.5 font-bold text-danger">
      *
    </span>
  );
}
