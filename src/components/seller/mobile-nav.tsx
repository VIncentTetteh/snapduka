import Link from "next/link";

const items = [
  ["/dashboard", "Home"],
  ["/dashboard/orders", "Orders"],
  ["/dashboard/products", "Products"],
  ["/dashboard/growth", "Growth"],
] as const;

export function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-5xl justify-around border-t border-stone-300 bg-white/95 p-2 sm:sticky sm:top-0" aria-label="Seller dashboard">
      {items.map(([href, label]) => <Link className="grid min-h-11 place-items-center rounded-xl px-3 font-bold text-stone-800" href={href} key={href}>{label}</Link>)}
    </nav>
  );
}
