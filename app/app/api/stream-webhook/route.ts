// POST /api/stream-webhook
// QuickNode Streams (Solana devnet, logs) lands here. See docs/backend.md for the filter.
// Duplicate signatures are ignored. Order state only moves forward.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { webhookAuthorized } from "@/lib/server/auth";
import { processTransaction } from "@/lib/server/apply-events";
import { extractTransactions } from "@/lib/webhook-payload";

export const maxDuration = 60;

const BATCH = 25;

export async function POST(req: NextRequest) {
  await dynamicRequest();
  const auth = webhookAuthorized(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });

  const txs = extractTransactions(body);
  const slice = txs.slice(0, BATCH);
  const results = [];
  for (const tx of slice) results.push(await processTransaction(tx));

  const failed = results.some((r) => r.error);
  const status = txs.length > BATCH || failed ? 500 : 200;
  return NextResponse.json({
    received: txs.length,
    processed: results.length,
    retry: txs.length > BATCH || failed,
    results,
  }, { status });
}
