// GET /api/cron/relayer — alert when the fee-payer wallet drops under 1 devnet SOL.
// At most one alert row per hour, so a low balance does not fill the table.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/server/auth";
import { loadRelayer, relayerBalance } from "@/lib/server/relayer";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET(req: NextRequest) {
  await dynamicRequest();
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const relayer = loadRelayer();
  if (!relayer) return NextResponse.json({ configured: false, low: null });

  try {
    const balance = await relayerBalance(relayer.publicKey);
    if (!balance) return NextResponse.json({ configured: true, low: null });
    let alerted = false;
    if (balance.low) {
      const message = `Relayer ${relayer.publicKey.toBase58()} is at ${balance.sol.toFixed(3)} SOL, under 1 SOL. Airdrop before the demo.`;
      console.error(message);
      const db = supabaseAdmin();
      if (db) {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await db.from("relayer_alerts").select("id").gte("created_at", since).limit(1);
        if (!recent || recent.length === 0) {
          await db.from("relayer_alerts").insert({ sol: balance.sol, message });
          alerted = true;
        }
      }
      const hook = process.env.ALERT_WEBHOOK_URL;
      if (hook && alerted) {
        await fetch(hook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: message }),
        }).catch(() => undefined);
      }
    }
    return NextResponse.json({
      configured: true,
      relayer: relayer.publicKey.toBase58(),
      sol: balance.sol,
      low: balance.low,
      alerted,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
