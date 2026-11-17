// POST /api/disputes/summarize  { orderId }
// Short evidence summary for an arbiter, from the order's chat. The chat is the record.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { summarizeDispute } from "@/lib/server/llm";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

const Body = z.object({ orderId: z.string().min(1).max(80) });

export async function POST(req: NextRequest) {
  await dynamicRequest();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data, error } = await db
    .from("chat_messages")
    .select("sender_id, body, risk")
    .eq("order_id", parsed.data.orderId)
    .order("at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summary = await summarizeDispute(
    (data ?? []).map((m) => ({ sender: m.sender_id as string, body: m.body as string, risk: m.risk as string })),
  );
  return NextResponse.json({ orderId: parsed.data.orderId, summary });
}
