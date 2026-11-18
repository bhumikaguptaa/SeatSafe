// Owner: B. Health check. B owns everything under app/api/.
// Always answers 200 with JSON, even if a dependency can't load: the checks are imported inside the
// handler, so a broken module (e.g. Nov 18: Anchor -> rpc-websockets -> ESM-only uuid crashed every
// route at load time) shows up in `errors` instead of an empty 500. Names only, never values.
import { connection } from "next/server";

/** Server env vars production needs (names only). */
const SERVER_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STREAM_WEBHOOK_SECRET",
  "CRON_SECRET",
  "RELAYER_SECRET_KEY",
  "NEXT_PUBLIC_RELAYER_PUBKEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
  "NEXT_PUBLIC_PROGRAM_ID",
  "NEXT_PUBLIC_USDC_MINT",
  "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
  "NEXT_PUBLIC_APP_URL",
] as const;

async function check<T>(name: string, errors: Record<string, string>, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    errors[name] = err instanceof Error ? err.message.slice(0, 300) : String(err);
    return null;
  }
}

export async function GET() {
  await connection(); // always run per request (never prerendered), so `time` is live
  const errors: Record<string, string> = {};
  const missing: string[] = SERVER_ENV.filter((k) => !process.env[k]?.trim());
  if (!process.env.OPENAI_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()) missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");

  const supabase = await check("supabase", errors, async () => (await import("@/lib/server/supabase-admin")).supabaseAdmin() !== null);
  const relayer = await check("relayer", errors, async () => {
    if (!process.env.RELAYER_SECRET_KEY?.trim()) return false;
    const kp = (await import("@/lib/server/relayer")).loadRelayer();
    if (!kp) throw new Error("RELAYER_SECRET_KEY is set but invalid (expected a JSON byte array or base58 secret key)");
    return true;
  });
  const llm = await check("llm", errors, async () => (await import("@/lib/server/llm")).llmConfigured());

  return Response.json({
    ok: Object.keys(errors).length === 0,
    time: new Date().toISOString(),
    supabase,
    relayer,
    llm,
    webhookSecret: Boolean(process.env.STREAM_WEBHOOK_SECRET),
    demoDeadlines: process.env.DEMO_DEADLINES === "true",
    missing,
    errors,
  });
}
