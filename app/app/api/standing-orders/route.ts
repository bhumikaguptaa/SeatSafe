// POST /api/standing-orders
// One English sentence -> strict rules, validated, saved as a draft for the fan to approve.
// The budget is locked onchain by the client after that (open_standing_order). The stream
// links the draft to the new standing-order account and keeps minSellerRating.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEvents } from "@/lib/chain";
import { eventFromRow, type EventRow } from "@/lib/db-map";
import { parseOrderWithLlm } from "@/lib/server/llm";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { Event } from "@/lib/types";

const Body = z.object({
  text: z.string().trim().min(3).max(500),
  userId: z.string().trim().min(1).max(80),
});

const Rules = z.object({
  eventId: z.string().min(1),
  quantity: z.number().int().min(1).max(8),
  maxPrice: z.number().positive().max(100_000),
  minRating: z.number().min(0).max(5),
  deadline: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "deadline must be a date"),
});

async function catalog(): Promise<Event[]> {
  const db = supabaseAdmin();
  const fromDb = db
    ? await db.from("events").select("*").then(({ data }) => ((data ?? []) as EventRow[]).map(eventFromRow))
    : [];
  if (process.env.NEXT_PUBLIC_EVENTS_SOURCE === "supabase") return fromDb;
  try {
    const chain = await getEvents();
    if (process.env.NEXT_PUBLIC_EVENTS_SOURCE === "chain" || fromDb.length === 0) return chain.length ? chain : fromDb;
    const ids = new Set(fromDb.map((e) => e.id));
    return [...fromDb, ...chain.filter((e) => !ids.has(e.id))];
  } catch {
    return fromDb;
  }
}

export async function POST(req: NextRequest) {
  await dynamicRequest();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Say what you want in a sentence, and include userId.", issues: parsed.error.issues }, { status: 400 });
  }

  const events = await catalog();
  const understood = await parseOrderWithLlm(parsed.data.text, events);
  const event = events.find((e) => e.id === understood.eventId) ?? null;
  const deadline = understood.deadline ?? event?.startsAt ?? null;
  const minRating = understood.minRating ?? 0;
  const proposal = {
    eventId: understood.eventId,
    quantity: understood.quantity,
    maxPrice: understood.maxPrice,
    minRating,
    deadline,
  };
  const valid = Rules.safeParse(proposal);
  if (!valid.success) {
    return NextResponse.json({
      error: "Could not turn that into a complete order. Name the event, a max price, and how many tickets.",
      proposal,
      issues: valid.error.issues,
    }, { status: 422 });
  }

  const budgetUsd = valid.data.maxPrice * valid.data.quantity;
  const draft = {
    id: `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    user_id: parsed.data.userId,
    event_id: valid.data.eventId,
    quantity: valid.data.quantity,
    max_price_usd: valid.data.maxPrice,
    min_seller_rating: valid.data.minRating,
    deadline: new Date(valid.data.deadline).toISOString(),
    raw_text: parsed.data.text,
    proposal: valid.data,
  };
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from("standing_order_drafts").insert(draft);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    draftId: draft.id,
    proposal: valid.data,
    event,
    budgetUsd,
    approval: "rules",
  });
}
