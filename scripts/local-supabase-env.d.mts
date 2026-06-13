export function parseLocalSupabaseEnv(output: string): {
  NEXT_PUBLIC_SUPABASE_URL: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  SUPABASE_SECRET_KEY: string | undefined;
};
