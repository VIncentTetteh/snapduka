import { ImageResponse } from "next/og";

import { getPublicShop } from "@/lib/storefront/queries";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getPublicShop(slug);

  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#022c22", color: "white", display: "flex", flexDirection: "column", height: "100%", justifyContent: "center", padding: 70, width: "100%" }}>
      <div style={{ color: "#a7f3d0", fontSize: 30, letterSpacing: 5 }}>SHOP ON SNAPDUKA</div>
      <div style={{ fontSize: 82, fontWeight: 900, marginTop: 30, textAlign: "center" }}>{shop?.display_name ?? "Store unavailable"}</div>
      <div style={{ fontSize: 30, marginTop: 32 }}>Simple, transparent social commerce</div>
    </div>,
    size,
  );
}
