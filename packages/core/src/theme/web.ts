// Web-only design values: things a browser needs that React Native has no
// equivalent for (CSS font stacks, multi-layer box-shadows, keyframe
// animations). Everything else in the web theme is derived from ./tokens.ts.
//
// scripts/gen-tokens.mjs combines the two into the Tailwind v4 `@theme` block
// in src/app/globals.css. Not exported from the package index: mobile has no
// use for CSS strings. No imports, so the generator can load it directly.
export const webTokens = {
  font: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /** Appended after tokens.font.serif (Georgia). */
    serifFallback: '"Times New Roman", Times, serif',
    mono: "ui-monospace, Menlo, Consolas, monospace",
  },
  /**
   * Browser shadows are tuned separately from the RN `tokens.shadow` values
   * (RN has one blur radius and no spread). Still warm ink, never black.
   * The button shadow is not here: it is derived from tokens.shadow.button.
   */
  shadow: {
    card: "0 20px 44px -20px rgba(33, 27, 20, 0.25)",
    float: "0 16px 36px -14px rgba(33, 27, 20, 0.28)",
    panel: "0 14px 30px -12px rgba(33, 27, 20, 0.26)",
    phone: "0 24px 48px -18px rgba(33, 27, 20, 0.35), 0 4px 12px rgba(33, 27, 20, 0.12)",
  },
  /** Keyframes themselves stay hand-written in globals.css, below the generated block. */
  animate: {
    "sd-float": "sd-float 7s ease-in-out infinite",
    "sd-toast-in": "sd-toast-in 0.7s ease both",
    "sd-fade-up": "sd-fade-up 0.6s ease both",
    "sd-pulse": "sd-pulse 1.6s ease-in-out infinite",
  },
} as const;
