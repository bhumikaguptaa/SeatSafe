// Owner: B to review. Added by A for integration: display data for events and escrow listings
// (see lib/event-meta.ts). Keyed by PDA.
//
// Storage, first available:
//   1. Supabase table `event_meta` (id text primary key, kind text, data jsonb, updated_at timestamptz)
//      when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.   TODO(B): create the table.
//   2. Local dev only (NODE_ENV=development): written into app/lib/event-meta.json.
//   3. Otherwise nothing is stored server-side ({ stored: "none" }); the browser keeps its own copy.

import { promises as fs } from "fs";
import path from "path";
import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase-url";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

// Node.js runtime (the default; Cache Components forbids the `runtime` segment config).

const TABLE = "event_meta";

const pubkey = z.string().refine((s) => {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}, "not a public key");

const Entry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event"),
    id: pubkey,
    data: z.object({
      title: z.string().min(1).max(120),
      category: z.enum(["concert", "sports", "campus"]),
      venue: z.string().max(120),
      city: z.string().max(80),
      imageGradient: z.string().max(200),
      organizerName: z.string().max(80),
      hidden: z.boolean().optional(),
    }),
  }),
  z.object({
    kind: z.literal("escrow"),
    id: pubkey,
    data: z.object({
      eventId: pubkey,
      seat: z.string().max(80),
      sellerName: z.string().max(80).optional(),
    }),
  }),
]);

function adminClient() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

const JSON_FILE = path.join(process.cwd(), "lib", "event-meta.json");

export async function GET() {
  await dynamicRequest();
  const db = adminClient();
  const out = { events: {} as Record<string, unknown>, escrows: {} as Record<string, unknown> };
  if (db) {
    const { data, error } = await db.from(TABLE).select("id, kind, data");
    if (error) console.warn("event_meta read failed:", error.message);
    for (const row of data ?? []) {
      if (row.kind === "event") out.events[row.id] = row.data;
      if (row.kind === "escrow") out.escrows[row.id] = row.data;
    }
  }
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const parsed = Entry.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid entry", issues: parsed.error.issues }, { status: 400 });
  }
  const entry = parsed.data;

  const db = adminClient();
  if (db) {
    const { error } = await db
      .from(TABLE)
      .upsert({ id: entry.id, kind: entry.kind, data: entry.data, updated_at: new Date().toISOString() });
    if (!error) return NextResponse.json({ stored: "supabase", entry });
    console.warn("event_meta write failed, falling back:", error.message);
  }

  if (process.env.NODE_ENV === "development") {
    try {
      const current = JSON.parse(await fs.readFile(JSON_FILE, "utf8"));
      const section = entry.kind === "event" ? "events" : "escrows";
      current[section] = { ...current[section], [entry.id]: entry.data };
      await fs.writeFile(JSON_FILE, `${JSON.stringify(current, null, 2)}\n`);
      return NextResponse.json({ stored: "file", entry });
    } catch (err) {
      console.warn("event-meta.json write failed:", err);
    }
  }

  // Nowhere to persist: the client keeps it in localStorage. Returned so it could be copied into the JSON.
  return NextResponse.json({ stored: "none", entry });
}
