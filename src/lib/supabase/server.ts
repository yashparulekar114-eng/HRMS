import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for server code, acting as the signed-in Clerk user.
 * The user's Clerk session token is passed on every request, so Postgres RLS
 * applies (auth.jwt()->>'sub' = Clerk user ID). The service-role key is never
 * used (CLAUDE.md rule 3).
 */
export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL or publishable key is not configured.");
  const { getToken } = await auth();
  return createClient(url, key, {
    accessToken: async () => (await getToken()) ?? null,
  });
}
