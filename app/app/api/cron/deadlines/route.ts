// GET /api/cron/deadlines — Vercel Cron, once a day on the Hobby plan.
// Calls refund_expired, release_expired and close_standing_order for accounts past their deadline.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/server/auth";
import { runDeadlines } from "@/lib/server/deadlines";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  await dynamicRequest();
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await runDeadlines();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
