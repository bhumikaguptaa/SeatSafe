// Owner: B. Health check. B owns everything under app/api/.
import { connection } from "next/server";

export async function GET() {
  await connection(); // always run per request (never prerendered), so `time` is live
  return Response.json({ ok: true, time: new Date().toISOString() });
}
