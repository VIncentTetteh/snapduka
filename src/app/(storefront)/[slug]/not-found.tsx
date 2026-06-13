import Link from "next/link";

export default function StorefrontNotFound() {
  return (
    <main className="mx-auto grid min-h-svh max-w-xl content-center gap-3 px-4">
      <p className="font-bold uppercase tracking-wide text-emerald-900">Store unavailable</p>
      <h1 className="m-0 text-4xl font-black">This shop or product is not available.</h1>
      <p>It may be hidden, sold elsewhere, or the link may be incorrect.</p>
      <Link className="font-bold text-emerald-900" href="/">Return to SnapDuka</Link>
    </main>
  );
}
