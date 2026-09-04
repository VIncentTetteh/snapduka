// Shared design tokens — the single visual language for the Next.js web app and
// the Expo mobile app.
//
// The system is "warm paper · ink · terracotta". Two rules carry most of the
// look and are easy to break by accident:
//
//   1. Depth comes from a hairline border on warm paper, NOT from shadow.
//      Cards are flat. Elevation is reserved for buttons and floating overlays.
//   2. Green is reserved for `paid`, `active` and verification. Everything else
//      that needs emphasis uses terracotta. Spraying green on generic success
//      states is what made the two clients drift apart in the first place.
//
// These mirror `Snapduka/src/app/globals.css`, which is Tailwind v4 and holds
// the same values in an @theme block. When you change one, change both.
export const tokens = {
  color: {
    // ── Surfaces ──────────────────────────────────────────────────────────
    paper: "#FAF7F2", // page background (warm off-white)
    raised: "#FFFDF9", // subtly warmer band / sidebar / empty-state fill
    surface: "#FFFFFF", // card fill — pure white, not `raised`

    // ── Ink scale ─────────────────────────────────────────────────────────
    ink: "#211B14", // primary text, and the fill of dark surfaces
    ink2: "#3E3730", // secondary strong text, field labels
    inkSoft: "#57504A", // body copy on paper
    inkMuted: "#837A70", // meta / help text
    inkFaint: "#A79D91", // placeholders, disabled, strikethrough prices
    price: "#6B4F35", // dedicated warm brown, prices only

    // ── Accent: terracotta ────────────────────────────────────────────────
    accent: "#A8431A", // primary CTA, eyebrows, active nav, links
    accentDeep: "#8A3612", // pressed / hover, and text on accentTint
    accentTint: "#F6EDE2", // selected-control fill, badge bg, icon chips
    accentSoft: "#D9986F", // the accent as used ON dark surfaces
    accentInk: "#FFFFFF", // text on a solid accent fill
    accentDisabled: "#C08B6E", // accent button, disabled/pending

    // ── Hairlines ─────────────────────────────────────────────────────────
    line: "#EAE2D6", // default border: cards, headers, dividers
    lineInput: "#E2D9CC", // inputs and secondary controls
    lineStrong: "#DCD2C3", // secondary button border
    lineSoft: "#F0EAE0", // inner dividers, ghost-button pressed fill
    lineRow: "#F7F2EA", // list-row divider inside a card
    // On web this is the border *hover*. Touch has no hover, so it is our
    // pressed state — see `Button` / `Card` in the mobile UI kit.
    borderPressed: "#B9AC98",
    dashed: "#C9BBA6", // the dashed border that means "nothing here yet"

    // ── Semantic: success (paid / active / verified ONLY) ─────────────────
    success: "#047857",
    successDeep: "#036548",
    successTint: "#E7F4EE",
    successLine: "#BFE3D2",

    // ── Semantic: danger ──────────────────────────────────────────────────
    danger: "#B42318",
    dangerTint: "#FBEAE7",
    dangerLine: "#EFCCC5",

    // ── Semantic: warning / pending ───────────────────────────────────────
    warning: "#92600A",
    warningTint: "#FBF0DC",
    warningLine: "#EDD9B4",

    // ── Neutral badge ─────────────────────────────────────────────────────
    neutralTint: "#EDEBE7",

    // ── On-dark surfaces ──────────────────────────────────────────────────
    // When a panel flips to `ink`, borders and fills become paper at low alpha
    // and the accent switches to `accentSoft`.
    onDarkText: "#B8AEA1",
    onDarkList: "#D6CCBF",
  },

  /** Radii. `md` (10) is the workhorse — buttons, inputs, nav items. */
  radius: { xs: 7, sm: 9, md: 10, lg: 14, xl: 16, xxl: 24, pill: 999 },

  /** 2px base grid: the web scale uses half-steps throughout, so we do too. */
  spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },

  /** Fixed control heights, matching web's min-h scale. */
  control: { sm: 36, md: 44, lg: 48 },

  font: {
    // Georgia is the brand serif and ships on iOS. Android has no Georgia, so
    // the app loads a bundled fallback at runtime and registers it under this
    // same family name — see `apps/mobile/theme/fonts.ts`.
    serif: "Georgia",

    // Half-pixel sizes are deliberate, not a rounding error. React Native
    // accepts fractional fontSize.
    sizeXxs: 10.5,
    sizeXs: 11.5,
    sizeSm: 12.5,
    sizeBase: 13.5,
    sizeMd: 14.5,
    sizeLg: 15,
    sizeXl: 17,

    // Serif display sizes. The recipe is always: serif · 500 · tight leading ·
    // negative tracking. Never bold — the design uses bold serif in exactly one
    // place, the single-character logomark.
    displaySm: 19, // empty-state titles
    displayMd: 22, // card sub-headings
    displayLg: 24, // page titles
    displayXl: 28, // metric values, section headings
    display2xl: 34, // hero

    weightRegular: "400",
    weightMedium: "500", // the serif weight
    weightSemibold: "600", // every button and label
    weightBold: "700",

    /** Tracking for serif display text, by size band. */
    trackingDisplay: -0.01,
    trackingHero: -0.015,
    /** Uppercase eyebrow / column header tracking. */
    trackingEyebrow: 0.08,

    lineHeightBody: 1.55,
    lineHeightDisplay: 1.15,
  },

  /**
   * Shadows. Note two distinct systems: ink shadows are warm
   * (`rgba(33,27,20,α)`, never black), and the primary button's shadow is
   * *terracotta* — it glows in its own colour. Values are RN-shaped;
   * the web equivalents live in globals.css.
   */
  shadow: {
    button: { color: "#8A3612", opacity: 0.22, radius: 6, offsetY: 2 },
    card: { color: "#211B14", opacity: 0.14, radius: 26, offsetY: 12 },
    float: { color: "#211B14", opacity: 0.18, radius: 22, offsetY: 10 },
  },

  /** Focus / selection ring — terracotta at 12%. */
  focusRing: "rgba(168, 67, 26, 0.12)",
} as const;

export type Tokens = typeof tokens;
