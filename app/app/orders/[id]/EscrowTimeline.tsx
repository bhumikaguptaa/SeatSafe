"use client";

// Owner: A (polish pass, inserted into D's tracker with one line). Vertical escrow stepper:
// Paid into vault → Seller sends ticket → You confirm / auto-release → Done, with a live countdown on the
// active step and an Explorer link for each completed step that has a transaction.

import { Check, Clock, ExternalLink, X } from "lucide-react";
import { formatCountdown } from "@/lib/format";
import { explorerTx } from "@/lib/solana";
import { cn } from "@/lib/utils";
import type { OrderEvent, OrderState } from "@/lib/types";

type StepState = "done" | "active" | "todo" | "failed";

interface Step {
  title: string;
  detail?: string;
  state: StepState;
  sig?: string;
  countdown?: boolean;
}

function steps(state: OrderState, events: OrderEvent[]): Step[] {
  const sig = (...types: OrderEvent["type"][]) => events.find((e) => types.includes(e.type) && e.txSignature)?.txSignature;
  const paid: Step = { title: "Paid into vault", detail: "Your money is locked by the SeatSafe program.", state: "done", sig: sig("FUNDED") };
  switch (state) {
    case "HELD":
      return [paid, { title: "Seller sends ticket", detail: "If they don't, you get a full refund.", state: "active", countdown: true }, { title: "You confirm / auto-release", state: "todo" }, { title: "Done", state: "todo" }];
    case "IN_TRANSIT":
      return [paid, { title: "Seller sends ticket", state: "done", sig: sig("TICKET_SENT") }, { title: "You confirm / auto-release", detail: "Check the ticket. If you don't respond, the seller is paid automatically.", state: "active", countdown: true }, { title: "Done", state: "todo" }];
    case "CONFIRMED":
    case "RELEASED":
    case "SWAPPED":
      return [paid, { title: "Seller sends ticket", state: "done", sig: sig("TICKET_SENT") }, { title: "You confirm / auto-release", state: "done", sig: sig("CONFIRMED") }, { title: "Done", detail: "Payment released to the seller.", state: "done", sig: sig("RELEASED", "SWAPPED") }];
    case "REFUNDED":
      return [paid, { title: "Seller sends ticket", detail: "The seller missed the deadline.", state: "failed" }, { title: "You confirm / auto-release", state: "todo" }, { title: "Done: refunded", detail: "Your money is back in your wallet.", state: "done", sig: sig("REFUNDED") }];
    case "DISPUTED":
      return [paid, { title: "Seller sends ticket", state: "done", sig: sig("TICKET_SENT") }, { title: "Dispute open", detail: "Funds stay locked until it's settled.", state: "active" }, { title: "Done", state: "todo" }];
  }
}

export function EscrowTimeline({ state, events, msLeft }: { state: OrderState; events: OrderEvent[]; msLeft: number | null }) {
  const list = steps(state, events);
  return (
    <section className="surface-solid rounded-3xl p-4 sm:p-5" aria-label="Order progress">
      <h2 className="text-lg font-bold">Progress</h2>
      <ol className="mt-3">
        {list.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.state === "active" ? "step" : undefined}>
            {i < list.length - 1 && (
              <span aria-hidden className={cn("absolute top-7 bottom-0 left-[13px] w-0.5", s.state === "done" ? "bg-released" : "bg-[#26262E]")} />
            )}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                s.state === "done" && "border-released bg-released text-black",
                s.state === "active" && "border-primary bg-[#0B0B0F] text-primary",
                s.state === "todo" && "border-[#26262E] bg-[#0B0B0F] text-[#A1A1AA]",
                s.state === "failed" && "border-disputed bg-[#0B0B0F] text-disputed",
              )}
            >
              {s.state === "done" ? <Check className="size-4" aria-hidden /> : s.state === "failed" ? <X className="size-4" aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn("font-semibold", s.state === "todo" && "text-[#A1A1AA]")}>{s.title}</p>
              {s.detail && <p className="text-sm text-[#A1A1AA]">{s.detail}</p>}
              {s.state === "active" && s.countdown && msLeft !== null && (
                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary tabular-nums">
                  <Clock className="size-3.5" aria-hidden /> {formatCountdown(msLeft)} left
                </p>
              )}
              {s.sig && (
                <a href={explorerTx(s.sig)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[#A1A1AA] hover:text-white">
                  View transaction <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
