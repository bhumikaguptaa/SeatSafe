// Browser Supabase client (anon key only; never import the service role key in client code).
// It is `null` when NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set,
// which is the normal state while building against mocks. Always null-check before use.
// Schema and queries: owned by B (see supabase/).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./supabase-url";

const url = supabaseUrl();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
