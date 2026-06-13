import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { OfflineBanner } from "@/components/ui/offline-banner";
import { ServiceWorkerRegister } from "@/components/ui/service-worker-register";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: "SnapDuka | Social commerce for Ghana and Nigeria",
  description:
    "Turn social attention into trusted, completed orders with a mobile storefront built for sellers and buyers in Ghana and Nigeria.",
  keywords: [
    "social commerce",
    "Ghana",
    "Nigeria",
    "online selling",
    "mobile storefront",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fff8ed",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><OfflineBanner />{children}<ServiceWorkerRegister /></body>
    </html>
  );
}
