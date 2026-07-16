import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { OfflineBanner } from "@/components/ui/offline-banner";
import { ServiceWorkerRegister } from "@/components/ui/service-worker-register";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: "SnapDuka | Social commerce, organized",
  description:
    "Turn Instagram, TikTok, Snapchat and WhatsApp interest into organized, trackable orders with a storefront built for African social sellers. GHS, NGN and XOF. Paystack payments. Guest checkout.",
  keywords: [
    "social commerce",
    "Ghana",
    "Nigeria",
    "Côte d'Ivoire",
    "online selling",
    "mobile storefront",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#211B14",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
      </head>
      <body><OfflineBanner />{children}<ServiceWorkerRegister /></body>
    </html>
  );
}
