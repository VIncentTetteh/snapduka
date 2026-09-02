// Shared design tokens mirroring the web Tailwind theme (paper / ink / accent).
// Consumed by the mobile RN theme so the two clients read as one product.
export const tokens = {
  color: {
    paper: "#FBFAF7", // page background
    ink: "#1A1A17", // primary text
    inkMuted: "#6B6B63", // secondary text
    line: "#E7E4DC", // borders / dividers
    surface: "#FFFFFF", // cards
    accent: "#0E7C5A", // brand green
    accentInk: "#FFFFFF", // text on accent
    warning: "#B4690E",
    danger: "#B42318",
    success: "#0E7C5A",
  },
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: {
    sizeXs: 12,
    sizeSm: 14,
    sizeMd: 16,
    sizeLg: 20,
    sizeXl: 28,
    weightRegular: "400",
    weightMedium: "500",
    weightSemibold: "600",
    weightBold: "700",
  },
} as const;

export type Tokens = typeof tokens;
