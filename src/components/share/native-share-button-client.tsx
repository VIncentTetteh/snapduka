"use client";

import type { ReactNode } from "react";

import { NativeShareButton, useCanNativeShare } from "./native-share-button";

/**
 * Renders NativeShareButton only once hydrated on a browser that supports
 * it, with a caller-supplied fallback otherwise. Exists so a Server
 * Component (which can't call the useCanNativeShare hook itself) can still
 * offer image sharing without becoming a client component wholesale.
 */
export function NativeShareButtonClient({
  fallback,
  ...shareButtonProps
}: {
  fallback: ReactNode;
  imageUrl: string;
  imageFilename: string;
  title: string;
  text: string;
  fallbackUrl: string;
  label?: string;
  pendingLabel?: string;
  className?: string;
}) {
  const canNativeShare = useCanNativeShare();
  if (!canNativeShare) return fallback;
  return <NativeShareButton {...shareButtonProps} />;
}
