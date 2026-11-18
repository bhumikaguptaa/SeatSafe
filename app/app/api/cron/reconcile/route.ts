// GET /api/cron/reconcile — once a day on the Hobby plan. Repair rows the stream missed, then match listings.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/server/auth";
import { reconcileOrders } from "@/lib/server/reconcile";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  await dynamicRequest();
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await reconcileOrders();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
