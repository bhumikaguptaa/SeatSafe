import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase-url";

let cached: SupabaseClient | null | undefined;

/** Service-role client. Null when the server env is not configured. Never import this from client code. */
export function supabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return cached;
}

export function resetSupabaseAdminForTests() {
  cached = undefined;
}
