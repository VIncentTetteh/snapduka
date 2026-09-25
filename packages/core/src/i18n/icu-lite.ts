// ICU-lite message formatting and catalogue checks.
//
// This file has ZERO imports on purpose: scripts/check-i18n.mjs loads it
// straight into Node (type stripping, no bundler), and a relative import
// without a `.ts` extension would not resolve there. The same checker then
// runs in CI and in the core unit tests, so the two cannot disagree.
//
// Syntax is deliberately tiny: `{name}` placeholders only. No plurals, no
// select, no nesting. If a string needs plural rules, add two keys; if that
// becomes common, adopt real ICU MessageFormat rather than growing this.

/** A reviewed message is a plain string. */
export type ReviewedMessage = string;

/**
 * A machine-drafted message that no fluent speaker has approved yet. The
 * `needsReview: true` literal is the machine-checkable marker: the runtime
 * refuses to show it by default (English is shown instead), and the CI check
 * counts them so the backlog is visible. A reviewer approves a string by
 * replacing the object with the plain string.
 */
export type DraftMessage = { readonly text: string; readonly needsReview: true };

export type MessageEntry = ReviewedMessage | DraftMessage;

/** `{name}`: a letter or underscore, then word characters. */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function isDraft(entry: MessageEntry): entry is DraftMessage {
  return typeof entry === "object" && entry !== null && entry.needsReview === true;
}

export function entryText(entry: MessageEntry): string {
  return isDraft(entry) ? entry.text : entry;
}

/** Placeholder names in a template, sorted and de-duplicated. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Replace `{name}` with `params.name`. A missing param leaves the `{name}`
 * text in place: a visible "{amount}" in the UI gets reported and fixed, an
 * empty string silently tells a buyer the wrong thing.
 */
export function interpolate(template: string, params: MessageParams = {}): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** Braces that are not part of a well-formed `{name}` placeholder. */
function strayBraces(template: string): boolean {
  return /[{}]/.test(template.replace(PLACEHOLDER, ""));
}

export type CatalogCheck = {
  errors: string[];
  /** Keys still marked needsReview, per locale. */
  drafts: Record<string, string[]>;
};

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function checkEntry(locale: string, key: string, entry: unknown, reference: string, errors: string[]): boolean {
  const valid =
    typeof entry === "string" ||
    (typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { text?: unknown }).text === "string" &&
      (entry as { needsReview?: unknown }).needsReview === true);
  if (!valid) {
    errors.push(`${locale}.${key}: must be a string or { text, needsReview: true }`);
    return false;
  }
  const text = entryText(entry as MessageEntry);
  if (text.trim() === "") errors.push(`${locale}.${key}: empty message`);
  if (strayBraces(text)) errors.push(`${locale}.${key}: malformed placeholder braces in "${text}"`);
  const expected = placeholdersOf(reference);
  const actual = placeholdersOf(text);
  if (!sameList(expected, actual)) {
    errors.push(`${locale}.${key}: placeholders {${actual.join(", ")}} do not match en {${expected.join(", ")}}`);
  }
  return isDraft(entry as MessageEntry);
}

/**
 * Verify every locale against the English reference: same keys, same
 * placeholders, well-formed entries. English itself must be fully reviewed
 * (it is the fallback for every draft).
 */
export function checkCatalogs(
  reference: Readonly<Record<string, unknown>>,
  locales: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): CatalogCheck {
  const errors: string[] = [];
  const drafts: Record<string, string[]> = {};
  const referenceKeys = Object.keys(reference).sort();

  for (const key of referenceKeys) {
    const value = reference[key];
    if (typeof value !== "string") errors.push(`en.${key}: English is the fallback and must be a reviewed plain string`);
    else if (strayBraces(value)) errors.push(`en.${key}: malformed placeholder braces in "${value}"`);
  }

  for (const [locale, catalog] of Object.entries(locales)) {
    drafts[locale] = [];
    const keys = Object.keys(catalog);
    for (const key of referenceKeys.filter((k) => !keys.includes(k))) errors.push(`${locale}: missing key "${key}"`);
    for (const key of keys.filter((k) => !referenceKeys.includes(k))) errors.push(`${locale}: unknown key "${key}"`);
    for (const key of keys) {
      const reference_ = reference[key];
      if (typeof reference_ !== "string") continue;
      if (checkEntry(locale, key, catalog[key], reference_, errors)) drafts[locale].push(key);
    }
  }
  return { errors, drafts };
}
