import { createClient } from "@supabase/supabase-js";

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    throw new Error("Usage: create-operator.mjs <email> <password>");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY — run this via `pnpm create:operator`.",
    );
  }

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const match = existing.users.find((user) => user.email === email);

  if (match) {
    const { error } = await supabase.auth.admin.updateUserById(match.id, {
      password,
      app_metadata: { ...match.app_metadata, snapduka_role: "operator" },
    });
    if (error) throw error;
    console.log(`Updated existing operator: ${email}`);
    return;
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { snapduka_role: "operator" },
  });
  if (error) throw error;
  console.log(`Created operator: ${email}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
