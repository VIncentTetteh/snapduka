import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Origins allowed to reach the dev server (e.g. testing from a phone on
  // the same network). Extend via ALLOWED_DEV_ORIGINS="ip1,ip2" if needed.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.100.43",
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map((origin) => origin.trim()) ?? []),
  ],
};

export default nextConfig;
