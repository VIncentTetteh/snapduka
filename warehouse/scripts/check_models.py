#!/usr/bin/env python3
"""Validate the dbt models against a Postgres database without dbt.

dbt is not a project dependency yet (ADR-0011: the vendor is not chosen), but
the models must not rot in the meantime. This renders the small subset of
Jinja the models use -- source(), ref(), dbt.date_trunc(), dbt.dateadd() --
exactly as dbt-postgres would, creates every model as a view in a scratch
schema in dependency order, selects from each, and ROLLS BACK. Nothing is left
behind in the database.

Any other Jinja in a model is an error here, which is deliberate: it keeps the
models plain enough to move to whichever warehouse is chosen.

    python3 warehouse/scripts/check_models.py            # render, create, query
    python3 warehouse/scripts/check_models.py --verify   # ...and check the numbers
    DATABASE_URL=postgresql://... python3 warehouse/scripts/check_models.py

--verify snapshots every mart, runs tests/postgres/seed.sql (real money paths:
Paystack capture, delivery-code confirmation, a dispute), then
tests/postgres/expect.sql, which asserts each mart moved by exactly what the
fixtures should produce. Still inside the same rolled-back transaction.

Exit status is non-zero if any model fails to render, create or run.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
FIXTURES = ROOT / "tests" / "postgres"
DEFAULT_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SCRATCH = "dbt_check"
SOURCE_SCHEMA = "warehouse"

SOURCE = re.compile(r"\{\{\s*source\(\s*'snapduka'\s*,\s*'(\w+)'\s*\)\s*\}\}")
REF = re.compile(r"\{\{\s*ref\(\s*'(\w+)'\s*\)\s*\}\}")
DATE_TRUNC = re.compile(r"\{\{\s*dbt\.date_trunc\(\s*\"(\w+)\"\s*,\s*\"([^\"]+)\"\s*\)\s*\}\}")
DATEADD = re.compile(r"\{\{\s*dbt\.dateadd\(\s*\"(\w+)\"\s*,\s*(-?\d+)\s*,\s*\"([^\"]+)\"\s*\)\s*\}\}")


def render(sql: str) -> str:
    sql = SOURCE.sub(lambda m: f"{SOURCE_SCHEMA}.{m.group(1)}", sql)
    sql = REF.sub(lambda m: f"{SCRATCH}.{m.group(1)}", sql)
    # What dbt-postgres's date_trunc and dateadd macros emit.
    sql = DATE_TRUNC.sub(lambda m: f"date_trunc('{m.group(1)}', {m.group(2)})", sql)
    sql = DATEADD.sub(
        lambda m: f"{m.group(3)} + ((interval '1 {m.group(1)}') * ({m.group(2)}))", sql
    )
    leftover = re.search(r"\{\{.*?\}\}|\{%.*?%\}", sql, re.S)
    if leftover:
        raise ValueError(f"unsupported Jinja: {leftover.group(0)}")
    return sql


def load_models() -> dict[str, tuple[str, list[str]]]:
    models: dict[str, tuple[str, list[str]]] = {}
    for path in sorted(MODELS.rglob("*.sql")):
        raw = path.read_text()
        models[path.stem] = (raw, REF.findall(raw))
    return models


def ordered(models: dict[str, tuple[str, list[str]]]) -> list[str]:
    done: list[str] = []
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in done:
            return
        if name in visiting:
            raise ValueError(f"ref cycle at {name}")
        if name not in models:
            raise ValueError(f"ref('{name}') names no model")
        visiting.add(name)
        for dep in models[name][1]:
            visit(dep)
        visiting.discard(name)
        done.append(name)

    for name in models:
        visit(name)
    return done


def main() -> int:
    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    verify = "--verify" in sys.argv[1:]
    models = load_models()
    names = ordered(models)
    marts = {p.stem for p in (MODELS / "marts").glob("*.sql")}

    script = ["\\set ON_ERROR_STOP on", "begin;", f"create schema {SCRATCH};"]
    for name in names:
        script.append(f"\\echo -- {name}")
        script.append(f"create view {SCRATCH}.{name} as\n{render(models[name][0]).rstrip().rstrip(';')};")
    for name in names:
        if name in marts:
            script.append(f"\\echo == {name}")
            script.append(f"select * from {SCRATCH}.{name} order by 1 limit 5;")
            script.append(f"select '{name}' as model, count(*) as rows from {SCRATCH}.{name};")
    if verify:
        for name in sorted(marts):
            script.append(f"create temporary table before_{name} as select * from {SCRATCH}.{name};")
        script.append("\\echo == seed")
        script.append((FIXTURES / "seed.sql").read_text())
        script.append("\\echo == expectations")
        script.append((FIXTURES / "expect.sql").read_text())
    script.append("rollback;")

    result = subprocess.run(
        ["psql", url, "-X", "-q", "-P", "pager=off"],
        input="\n".join(script),
        text=True,
        capture_output=True,
    )
    sys.stdout.write(result.stdout)
    # Expectation notices arrive on stderr; show them either way.
    sys.stdout.write("".join(line + "\n" for line in result.stderr.splitlines() if "ok " in line))
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        print(f"FAILED: {len(names)} models checked", file=sys.stderr)
        return 1
    checked = " and verified against fixtures" if verify else ""
    print(f"OK: {len(names)} models rendered, created and queried{checked} ({len(marts)} marts); rolled back")
    return 0


if __name__ == "__main__":
    sys.exit(main())
