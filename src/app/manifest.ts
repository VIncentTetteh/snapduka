import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SnapDuka Social Commerce",
    short_name: "SnapDuka",
    description: "Mobile storefronts and trusted order operations for social sellers.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff8ed",
    theme_color: "#064e3b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
