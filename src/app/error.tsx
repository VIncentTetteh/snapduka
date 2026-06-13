"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid min-h-svh max-w-xl content-center gap-3 px-4"><p className="font-bold uppercase tracking-wide text-red-800">Something went wrong</p><h1 className="m-0 text-4xl font-black">This screen could not load.</h1><p>Your submitted order or payment should be checked from its receipt before retrying.</p><button className="min-h-11 rounded-xl bg-emerald-900 px-4 font-bold text-white" onClick={reset}>Try again</button></main>;
}
