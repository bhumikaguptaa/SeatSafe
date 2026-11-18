// GET /api/agent-log/:id — decision log for one standing order, oldest first.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await dynamicRequest();
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data, error } = await db
    .from("agent_log")
    .select("id, standing_order_id, kind, message, at")
    .eq("standing_order_id", id)
    .order("at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    standingOrderId: id,
    entries: (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      message: row.message,
      at: row.at,
    })),
  });
}
