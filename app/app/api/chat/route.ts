// POST /api/chat — save one message on the order's thread and flag scam risk.
// GET  /api/chat?orderId= — read that thread (the UI prefers the Supabase subscription).

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { chatFromRow, type ChatRow } from "@/lib/db-map";
import { assessWithLlm } from "@/lib/server/llm";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

const Body = z.object({
  orderId: z.string().min(1).max(80),
  senderId: z.string().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
});

export async function GET(req: NextRequest) {
  await dynamicRequest();
  const orderId = req.nextUrl.searchParams.get("orderId") ?? "";
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data, error } = await db
    .from("chat_messages")
    .select("id, order_id, sender_id, body, risk, risk_reason, at")
    .eq("order_id", orderId)
    .order("at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: ((data ?? []) as ChatRow[]).map(chatFromRow) });
}

export async function POST(req: NextRequest) {
  await dynamicRequest();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message", issues: parsed.error.issues }, { status: 400 });
  }
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const verdict = await assessWithLlm(parsed.data.body);
  const row = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    order_id: parsed.data.orderId,
    sender_id: parsed.data.senderId,
    body: parsed.data.body,
    risk: verdict.risk,
    risk_reason: verdict.reason ?? null,
    at: new Date().toISOString(),
  };
  const { error } = await db.from("chat_messages").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: chatFromRow(row) });
}
