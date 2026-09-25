#!/usr/bin/env python3
"""Add new public Tables/Views/Functions/Enums from a fresh type generation into
the committed supabase-types.ts without touching existing entries.

Why not just regenerate: the local database is built from migrations, and the
local migration history has drifted from production (see the composite-FK
incident). A full regeneration rewrites unrelated relationship metadata and
would silently change PostgREST embed typing across the app. This only adds
names the committed file does not have yet, and replaces entries named with
--replace (for objects a migration deliberately redefined).

Usage:
  supabase gen types typescript --local > /tmp/types-new.ts
  python3 scripts/splice-db-types.py /tmp/types-new.ts [--replace name ...]
"""
import re
import sys

TARGET = "packages/core/src/supabase-types.ts"
SECTIONS = ("Tables", "Views", "Functions", "Enums")


def section_bounds(lines, section):
    """Return (start, end) line indexes of `    <section>: {` .. matching `    }`
    inside the public schema."""
    in_public = False
    for i, line in enumerate(lines):
        if line.startswith("  public: {"):
            in_public = True
        elif in_public and line.startswith(f"    {section}: {{"):
            for j in range(i + 1, len(lines)):
                if lines[j].startswith("    }"):
                    return i, j
    raise SystemExit(f"section {section} not found")


def entries(lines, start, end):
    """Map name -> (first, last) line indexes of each 6-space-indented entry.

    An entry runs until brackets balance again and the next line starts a new
    entry or closes the section. Tracking depth (rather than guessing from line
    shapes) matters for overloaded functions, which generate as a union of
    object types spread over many deeper-indented lines.
    """
    out = {}
    i = start + 1
    while i < end:
        m = re.match(r"^      ([a-z_][a-z0-9_]*):", lines[i])
        if not m:
            i += 1
            continue
        name = m.group(1)
        depth = 0
        j = i
        while True:
            line = lines[j]
            depth += line.count("{") + line.count("[") - line.count("}") - line.count("]")
            nxt = lines[j + 1] if j + 1 < len(lines) else ""
            if depth == 0 and (re.match(r"^      [a-z_]", nxt) or re.match(r"^    [}A-Z]", nxt) or j + 1 >= end):
                break
            j += 1
        out[name] = (i, j)
        i = j + 1
    return out


def main():
    fresh_path = sys.argv[1]
    replace = set(sys.argv[sys.argv.index("--replace") + 1:]) if "--replace" in sys.argv else set()
    fresh = open(fresh_path).read().splitlines()
    target = open(TARGET).read().splitlines()
    added = []
    for section in SECTIONS:
        fs, fe = section_bounds(fresh, section)
        f_entries = entries(fresh, fs, fe)
        ts, te = section_bounds(target, section)
        t_entries = entries(target, ts, te)
        for name, (a, b) in sorted(f_entries.items()):
            block = fresh[a:b + 1]
            if name in t_entries and name not in replace:
                continue
            ts, te = section_bounds(target, section)
            t_entries = entries(target, ts, te)
            if name in t_entries:
                x, y = t_entries[name]
                target[x:y + 1] = block
            else:
                later = [t_entries[n][0] for n in t_entries if n > name]
                insert_at = min(later) if later else te
                target[insert_at:insert_at] = block
            added.append(f"{section}.{name}")
    open(TARGET, "w").write("\n".join(target) + "\n")
    print("spliced:", ", ".join(added) if added else "nothing new")


if __name__ == "__main__":
    main()
