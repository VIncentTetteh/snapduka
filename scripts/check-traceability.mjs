import { readFile } from "node:fs/promises";

const prd = await readFile("docs/product/snapduka-product-requirements.md", "utf8");
const matrix = await readFile("docs/requirements/foundation-traceability.md", "utf8");
const ids = [...prd.matchAll(/\*\*([A-Z]{2,5}-\d{3}) \(P0\)/g)].map((match) => match[1]);
const missing = ids.filter((id) => !matrix.includes(`| ${id} |`));
if (missing.length) {
  console.error(`Missing P0 traceability rows: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`Traceability covers ${ids.length} P0 requirements.`);
