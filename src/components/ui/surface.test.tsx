import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-012 — Panel applies only a border, radius and background,
// so every caller has to supply its own padding. The creators screens passed
// `mb-5` and nothing else, and shipped with headings sitting flush against the
// panel border. Reported from production on the Creators page.
// Found by /qa on 2026-09-01
// Report: .gstack/qa-reports/qa-report-snapduka-2026-09-01.md

const SRC = join(process.cwd(), "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") && !entry.endsWith(".test.tsx") ? [full] : [];
  });
}

/**
 * Collects each `<Panel ...>` opening tag, spanning lines, so a multi-line tag
 * is judged on its whole attribute list rather than its first line.
 */
function panelTags(source: string): string[] {
  const tags: string[] = [];
  let index = source.indexOf("<Panel");
  while (index !== -1) {
    const next = source[index + 6];
    // Skip `<PanelSomethingElse`; only the Panel component itself.
    if (next === " " || next === ">" || next === "\n") {
      const end = source.indexOf(">", index);
      tags.push(source.slice(index, end === -1 ? index + 200 : end));
    }
    index = source.indexOf("<Panel", index + 6);
  }
  return tags;
}

// A Panel whose children run edge to edge (a list, a table, a header strip)
// opts out deliberately with overflow-hidden and pads its own rows instead.
const HAS_SPACING = /\bp-[0-9]|\bpx-|\bpy-|\bp-4\.5|overflow-hidden/;

describe("Panel usage", () => {
  it("never renders content flush against its own border", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      for (const tag of panelTags(readFileSync(file, "utf8"))) {
        if (!HAS_SPACING.test(tag)) {
          offenders.push(`${file.replace(`${process.cwd()}/`, "")}: ${tag.replace(/\s+/g, " ").trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the Panels it is meant to be scanning", () => {
    const total = tsxFiles(SRC).reduce((sum, f) => sum + panelTags(readFileSync(f, "utf8")).length, 0);
    // Guards the scanner itself: a regex that silently matched nothing would
    // make the check above pass forever.
    expect(total).toBeGreaterThan(50);
  });
});
