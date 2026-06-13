import { readFile } from "node:fs/promises";

const prd = await readFile("docs/product/snapduka-product-requirements.md", "utf8");
const foundation = await readFile("docs/requirements/foundation-traceability.md", "utf8");
const growthScale = await readFile("docs/requirements/growth-scale-traceability.md", "utf8");
const ids = [...prd.matchAll(/\*\*([A-Z]{2,5}-\d{3}) \(P[012]\)/g)].map((match) => match[1]);
const matrix = `${foundation}\n${growthScale}`;
const missing = ids.filter((id) => !matrix.includes(`| ${id} |`));
if (missing.length) {
  console.error(`Missing P0/P1/P2 traceability rows: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`Traceability covers ${ids.length} P0/P1/P2 requirements.`);
