# Homepage Redesign Spec
**Date:** 2026-06-15  
**Status:** Approved

## Goal
Replace the current minimal 3-section homepage with a modern marketing landing page that matches the visual design language of the seller onboarding page.

## Design Language
- **Font:** Inter (400–800 weight, already loaded)
- **Icons:** Material Symbols Outlined via Google Fonts (add to `layout.tsx`)
- **Colors:** existing CSS tokens (`--accent` #0050CB, `--bg` #F9FAFB, `--ink`, `--ink-2`, `--ink-3`, `--border`, `--amber`)
- **Cards:** `bg-white border border-[var(--border)] rounded-xl shadow-sm`
- **Primary CTA:** `bg-[var(--accent)] text-white rounded-lg h-11 px-6 font-bold`
- **Secondary CTA:** `border border-[var(--border)] bg-white text-[var(--ink)] rounded-lg h-11 px-6`
- **Background accents:** radial dot pattern + blur circle divs (same as onboarding side panel)

## Sections (in order)

### 1. Nav (fixed, full-width)
- White bg, bottom border, height 56px
- Left: "SnapDuka" in `--accent` bold
- Right: "Sign in" (ghost link) + "Start selling" (filled pill button)
- Max-width container centred

### 2. Hero (split layout, min-height 100svh)
- **Left column (text):**
  - Eyebrow badge: "BUILT FOR GHANA & NIGERIA" — blue pill on `--accent-lite` bg
  - H1: "Turn social posts into completed orders." — large, tracking-tight, `--ink`
  - Subtext: one sentence about mobile storefronts + WhatsApp + secure payments
  - Two CTAs: "Start selling free →" (filled) + "See how it works" (ghost)
  - Three trust chips inline: ✓ Verified stores · ✓ Paystack payments · ✓ WhatsApp orders
- **Right column:**
  - Light blue (`--accent-lite`) bg panel
  - Dot pattern overlay (radial-gradient same as onboarding)
  - Phone mockup card: white rounded card showing a mini storefront (shop name, verified badge, two product rows, "Order via WhatsApp" button)

### 3. Features (3-column grid)
- Section eyebrow: "HOW IT WORKS"
- Section heading: "Everything you need to sell online."
- Three feature cards (white, border, rounded-xl, shadow-sm):
  - **⚡ Go live in 2 minutes** — Shop name → verified URL → share the link
  - **💬 WhatsApp orders** — Every order lands in your WhatsApp chat, no missed sales
  - **🔒 Secure payments** — Paystack integration, GHS & NGN, funds to your bank

### 4. Testimonial
- Full-width accent-lite background band
- Single quote card (same style as onboarding side panel testimonial)
- "Amina, Lagos" — italic quote about setting up shop and selling out
- Stars / social proof line above: "Trusted by 5,000+ sellers"

### 5. Bottom CTA
- Dark bg (`--ink`) section
- Headline: "Ready to launch your empire?"
- Subtext: "Set up your free storefront in under 2 minutes."
- Single "Start selling free →" button (white text, `--accent` bg)

### 6. Footer
- Min height, simple row: "SnapDuka" logo left, links (Privacy · Terms) centre, "© 2026 SnapDuka · Built for Ghana & Nigeria" right

## Implementation Notes
- File to edit: `src/app/page.tsx` (full rewrite)
- Add Material Symbols font link to `src/app/layout.tsx` (in `<head>`)
- No new dependencies required
- The `main` element in `globals.css` has `width: min(100% - 2rem, 72rem)` — override with `max-w-none w-full` on the page wrapper to allow full-bleed sections
- Phone mockup is pure HTML/CSS, no image needed
- Blur accent divs are `pointer-events-none fixed` (same pattern as onboarding)
- All Tailwind classes use the v4 arbitrary-value syntax `bg-[var(--token)]`
