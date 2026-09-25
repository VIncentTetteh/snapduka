"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // The root layout itself failed; report it (no-op without a DSN).
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <html lang="en"><body><main style={{padding:24}}><h1>SnapDuka needs a refresh</h1><p>Check your connection and reload. Do not repeat a payment until you check the order receipt.</p></main></body></html>;
}
