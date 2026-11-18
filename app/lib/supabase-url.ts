// Owner: A (shared helper). NEXT_PUBLIC_SUPABASE_URL must be the project root
// (https://<ref>.supabase.co). People often paste the REST URL (…/rest/v1/) from the dashboard;
// supabase-js then requests /rest/v1/rest/v1/… and every query fails with
// "Invalid path specified in request URL". Strip that suffix and trailing slashes.
export function supabaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "").replace(/\/(rest|auth|realtime|storage)\/v1$/, "").replace(/\/+$/, "");
}
