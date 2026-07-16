import Link from "next/link";

/** Serif "S" logomark in a terracotta rounded square. */
export function LogoMark({ className = "h-7 w-7 rounded-lg text-base" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid place-items-center bg-accent font-serif font-bold text-white ${className}`}
    >
      S
    </span>
  );
}

export function BrandLink({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label="SnapDuka home"
      className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <LogoMark />
      SnapDuka
    </Link>
  );
}
