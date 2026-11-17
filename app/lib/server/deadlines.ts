// Deadline crank. Anyone can call the program's refund / release / close instructions;
// this route does it every minute so a buyer who closes the tab still gets refunded.
// Windows are whatever the chain account was created with. The sell flow and the seed
// script use 60-second windows for the demo (DEMO_DEADLINES documents that for the API).

import { chainProgram } from "@/lib/chain";
import { closeStandingOrder, refundExpired, releaseExpired } from "@/lib/program";
import { loadRelayer } from "@/lib/server/relayer";
import { sendAsRelayer } from "@/lib/server/send";

export interface DeadlineReport {
  relayer: boolean;
  refunds: string[];
  releases: string[];
  closedStandingOrders: string[];
  overdue: { id: string; action: "refund" | "release" | "close" }[];
  errors: { id: string; error: string }[];
}

function stateName(state: object): string {
  return Object.keys(state)[0] ?? "";
}

export function demoDeadlineSecs(): number | null {
  return process.env.DEMO_DEADLINES === "true" ? 60 : null;
}

export async function runDeadlines(): Promise<DeadlineReport> {
  const report: DeadlineReport = {
    relayer: false,
    refunds: [],
    releases: [],
    closedStandingOrders: [],
    overdue: [],
    errors: [],
  };
  const relayer = loadRelayer();
  report.relayer = relayer !== null;
  const program = chainProgram();
  const now = Math.floor(Date.now() / 1000);

  const escrows = await program.account.escrowOrder.all();
  for (const row of escrows) {
    const state = stateName(row.account.state as object);
    const ship = Number(row.account.shipDeadline.toString());
    const confirm = Number(row.account.confirmDeadline.toString());
    const id = row.publicKey.toBase58();
    const action = state === "funded" && ship > 0 && now > ship
      ? "refund"
      : state === "sent" && confirm > 0 && now > confirm
        ? "release"
        : null;
    if (!action) continue;
    report.overdue.push({ id, action });
    if (!relayer) continue;
    try {
      const ctx = { program, user: relayer.publicKey, payer: relayer.publicKey };
      const built = action === "refund"
        ? await refundExpired(ctx, { escrow: row.publicKey })
        : await releaseExpired(ctx, { escrow: row.publicKey });
      const sig = await sendAsRelayer(built, relayer);
      (action === "refund" ? report.refunds : report.releases).push(sig);
    } catch (err) {
      report.errors.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const standing = await program.account.standingOrder.all();
  for (const row of standing) {
    const state = stateName(row.account.state as object);
    const deadline = Number(row.account.deadline.toString());
    if (state !== "open" || now <= deadline) continue;
    const id = row.publicKey.toBase58();
    report.overdue.push({ id, action: "close" });
    if (!relayer) continue;
    try {
      const built = await closeStandingOrder(
        { program, user: relayer.publicKey, payer: relayer.publicKey },
        { standingOrder: row.publicKey },
      );
      const sig = await sendAsRelayer(built, relayer);
      report.closedStandingOrders.push(sig);
    } catch (err) {
      report.errors.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return report;
}
