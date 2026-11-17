// Owner: B. Health check. B owns everything under app/api/.
import { connection } from "next/server";
import { llmConfigured } from "@/lib/server/llm";
import { loadRelayer } from "@/lib/server/relayer";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET() {
  await connection(); // always run per request (never prerendered), so `time` is live
  return Response.json({
    ok: true,
    time: new Date().toISOString(),
    supabase: supabaseAdmin() !== null,
    relayer: loadRelayer() !== null,
    llm: llmConfigured(),
    webhookSecret: Boolean(process.env.STREAM_WEBHOOK_SECRET),
    demoDeadlines: process.env.DEMO_DEADLINES === "true",
  });
}
