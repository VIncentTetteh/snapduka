import { ImageResponse } from "next/og";

import { getPublicShop } from "@/lib/storefront/queries";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getPublicShop(slug);

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#211B14",
          color: "#FAF7F2",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          padding: 70,
          width: "100%",
        }}
      >
        <div style={{ color: "#D9986F", fontSize: 28, letterSpacing: 6, fontWeight: 600 }}>
          SHOP ON SNAPDUKA
        </div>
        <div
          style={{
            fontSize: 82,
            fontWeight: 500,
            marginTop: 30,
            textAlign: "center",
            fontFamily: "Georgia, serif",
          }}
        >
          {shop?.display_name ?? "Store unavailable"}
        </div>
        <div style={{ fontSize: 28, marginTop: 32, color: "#B8AEA1" }}>
          Secure Paystack checkout · Guest checkout · Order tracking
        </div>
      </div>
    ),
    size,
  );
}
