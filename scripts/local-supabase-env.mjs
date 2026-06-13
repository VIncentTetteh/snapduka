import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parseLocalSupabaseEnv(output) {
  const values = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );

  return {
    NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      values.PUBLISHABLE_KEY ?? values.ANON_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY,
  };
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command) throw new Error("A command is required.");

  const status = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
    encoding: "utf8",
  });
  const localEnv = parseLocalSupabaseEnv(status);
  for (const [name, value] of Object.entries(localEnv)) {
    if (!value) throw new Error(`Supabase status did not provide ${name}.`);
  }

  const child = spawn(command, args, {
    env: { ...process.env, ...localEnv },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
