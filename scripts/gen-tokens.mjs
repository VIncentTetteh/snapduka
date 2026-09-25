// Generates the Tailwind v4 `@theme` block in src/app/globals.css from the
// shared design tokens, so web and mobile cannot drift apart again.
//
//   node scripts/gen-tokens.mjs           rewrite the block in place
//   node scripts/gen-tokens.mjs --check   exit 1 if the block is out of date (CI)
//
// Sources: packages/core/src/theme/tokens.ts (shared with the Expo app) and
// packages/core/src/theme/web.ts (browser-only values such as font stacks).
// Both are import-free TypeScript loaded through Node 22's type stripping.
//
// Only the region between the BEGIN/END markers is owned by this script;
// everything else in globals.css (keyframes, base styles, the legacy layer)
// stays hand-written.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themeDir = path.join(root, "packages/core/src/theme");
const cssPath = path.join(root, "src/app/globals.css");
const check = process.argv.includes("--check");

const BEGIN =
  "/* BEGIN GENERATED: design tokens. Source: packages/core/src/theme/{tokens,web}.ts. Run `pnpm tokens:gen`; do not edit by hand. */";
const END = "/* END GENERATED: design tokens */";

const { tokens } = await import(pathToFileURL(path.join(themeDir, "tokens.ts")).href);
const { webTokens } = await import(pathToFileURL(path.join(themeDir, "web.ts")).href);

/**
 * Web CSS variable names that differ from a plain kebab-case of the token key.
 * The web shipped first with these names and hundreds of class names depend
 * on them (`text-warn`, `text-ink-2`), so the mapping bends, not the classes.
 */
const COLOR_RENAMES = {
  ink2: "ink-2",
  warning: "warn",
  warningTint: "warn-tint",
  warningLine: "warn-line",
};

/** Colour groups in the order and with the headings the stylesheet uses. */
const COLOR_GROUPS = [
  ["Surfaces", ["paper", "raised"]],
  ["Ink scale", ["ink", "ink2", "inkSoft", "inkMuted", "inkFaint", "price"]],
  ["Accent — terracotta", ["accent", "accentDeep", "accentTint", "accentSoft"]],
  ["Hairlines", ["line", "lineInput", "lineStrong", "lineSoft"]],
  ["Semantic — success (verification / payment only)", ["success", "successDeep", "successTint", "successLine"]],
  ["Semantic — danger", ["danger", "dangerTint", "dangerLine"]],
  ["Semantic — warning / pending", ["warning", "warningTint", "warningLine"]],
  ["Neutral badge", ["neutralTint"]],
];

function kebab(key) {
  return COLOR_RENAMES[key] ?? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`gen-tokens: token "${name}" is missing from packages/core/src/theme`);
  }
  return value;
}

function rgba(hex, opacity) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`gen-tokens: expected #RRGGBB, got ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => Number.parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** The primary button glows in its own terracotta; derived from the RN shadow so both agree. */
function buttonShadow({ color, opacity, radius, offsetY }) {
  return `0 ${offsetY}px ${radius}px ${rgba(color, opacity)}`;
}

function renderThemeBlock() {
  const lines = ["@theme {"];
  const group = (heading, entries) => {
    if (lines.length > 1) lines.push("");
    lines.push(`  /* ${heading} */`);
    for (const [name, value] of entries) lines.push(`  ${name}: ${value};`);
  };

  for (const [heading, keys] of COLOR_GROUPS) {
    group(
      heading,
      keys.map((key) => [`--color-${kebab(key)}`, required(tokens.color[key], `color.${key}`)]),
    );
  }
  group("Typography", [
    ["--font-sans", webTokens.font.sans],
    ["--font-serif", `${required(tokens.font.serif, "font.serif")}, ${webTokens.font.serifFallback}`],
    ["--font-mono", webTokens.font.mono],
  ]);
  group("Warm shadows", [
    ["--shadow-card", webTokens.shadow.card],
    ["--shadow-float", webTokens.shadow.float],
    ["--shadow-panel", webTokens.shadow.panel],
    ["--shadow-phone", webTokens.shadow.phone],
    ["--shadow-btn", buttonShadow(required(tokens.shadow.button, "shadow.button"))],
  ]);
  group(
    "Motion",
    Object.entries(webTokens.animate).map(([name, value]) => [`--animate-${name}`, value]),
  );
  lines.push("}");
  return lines.join("\n");
}

function splice(css, block) {
  const begin = css.indexOf(BEGIN);
  const end = css.indexOf(END);
  if (begin === -1 || end === -1 || end < begin || css.indexOf(BEGIN, begin + 1) !== -1) {
    throw new Error(`gen-tokens: ${path.relative(root, cssPath)} must contain exactly one BEGIN/END generated marker pair`);
  }
  return `${css.slice(0, begin + BEGIN.length)}\n${block}\n${css.slice(end)}`;
}

const css = await readFile(cssPath, "utf8");
const next = splice(css, renderThemeBlock());

if (check) {
  if (next !== css) {
    console.error("tokens: src/app/globals.css @theme block is out of date with packages/core/src/theme. Run `pnpm tokens:gen` and commit.");
    process.exit(1);
  }
  console.log("tokens: globals.css @theme block matches packages/core/src/theme.");
} else if (next === css) {
  console.log("tokens: globals.css already up to date.");
} else {
  await writeFile(cssPath, next);
  console.log("tokens: regenerated the @theme block in src/app/globals.css.");
}
