// Owner: B to review, added by A.
// Live mode of /simulator. Off unless SIM_LIVE_ENABLED=true; devnet only; rate-limited.
// GET  -> { enabled, reason?, balances? }                    (is live mode available, and the demo wallets)
// POST { action, context } -> StepResult + balances          (one real devnet transaction, or a rejection)
// See lib/server/sim.ts. Never returns secret keys.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { balances, runStep, simWallets, type StepContext } from "@/lib/server/sim";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import type { LiveAction } from "@/app/simulator/scenarios";

export const maxDuration = 60;

const ACTIONS: LiveAction[] = ["a_prepare", "a_list_over", "a_list", "a_buy", "b_list", "b_fund", "b_steal", "b_refund", "c_sent", "c_confirm"];
const isKey = (v: unknown) => typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);

export async function GET() {
  await dynamicRequest();
  const s = await simWallets();
  if (!s.ok) return NextResponse.json({ enabled: false, reason: s.reason });
  return NextResponse.json({ enabled: true, balances: await balances(s.w).catch(() => null) });
}

export async function POST(req: NextRequest) {
  await dynamicRequest();
  if (!rateLimit(`sim:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, message: "Too many steps in a minute. Wait a moment." }, { status: 429 });
  }
  const s = await simWallets();
  if (!s.ok) return NextResponse.json({ ok: false, message: s.reason }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; context?: { ticketMint?: unknown; escrow?: unknown } } | null;
  const action = body?.action as LiveAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ ok: false, message: "Unknown step" }, { status: 400 });
  const context: StepContext = {
    ticketMint: isKey(body?.context?.ticketMint) ? (body!.context!.ticketMint as string) : undefined,
    escrow: isKey(body?.context?.escrow) ? (body!.context!.escrow as string) : undefined,
  };

  try {
    const result = await runStep(s.w, action, context);
    return NextResponse.json({ ...result, balances: await balances(s.w).catch(() => null) });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err), context }, { status: 500 });
  }
}
