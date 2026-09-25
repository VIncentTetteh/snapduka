// CI gate for the shared message catalogues in packages/core/src/i18n.
//
//   node scripts/check-i18n.mjs            check; exit 1 on any error
//   node scripts/check-i18n.mjs --strict   also fail while any needsReview draft remains
//
// Checks every locale against English: identical key set, identical
// `{placeholder}` names per key, well-formed braces, and entries that are a
// plain (reviewed) string or `{ text, needsReview: true }` (machine draft).
// It then reports how many drafts each locale still carries, so the review
// backlog is visible on every CI run instead of discovered by a buyer.
//
// The catalogues and the checker are TypeScript with no imports, loaded here
// through Node 22's built-in type stripping; the checker is the same function
// the core unit tests call, so CI and tests cannot disagree.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = path.join(root, "packages/core/src/i18n");
const messagesDir = path.join(i18nDir, "messages");
const strict = process.argv.includes("--strict");

const { checkCatalogs } = await import(pathToFileURL(path.join(i18nDir, "icu-lite.ts")).href);

const files = (await readdir(messagesDir)).filter((file) => file.endsWith(".ts")).sort();
const catalogs = {};
for (const file of files) {
  const locale = path.basename(file, ".ts");
  const loaded = await import(pathToFileURL(path.join(messagesDir, file)).href);
  if (!loaded[locale] || typeof loaded[locale] !== "object") {
    console.error(`i18n: ${file} must export a const named "${locale}"`);
    process.exit(1);
  }
  catalogs[locale] = loaded[locale];
}

if (!catalogs.en) {
  console.error("i18n: messages/en.ts (the reference catalogue) is missing");
  process.exit(1);
}

const { en, ...others } = catalogs;
const { errors, drafts } = checkCatalogs(en, others);
const keyCount = Object.keys(en).length;

for (const error of errors) console.error(`i18n: ${error}`);

const summary = Object.entries(drafts)
  .map(([locale, keys]) => `${locale} ${keys.length}/${keyCount} needsReview`)
  .join(", ");
console.log(`i18n: ${Object.keys(catalogs).length} locales, ${keyCount} keys. Drafts: ${summary || "none"}.`);

const draftTotal = Object.values(drafts).reduce((sum, keys) => sum + keys.length, 0);
if (errors.length > 0) {
  console.error(`i18n: ${errors.length} error(s).`);
  process.exit(1);
}
if (strict && draftTotal > 0) {
  console.error(`i18n: --strict and ${draftTotal} string(s) still need review.`);
  process.exit(1);
}
