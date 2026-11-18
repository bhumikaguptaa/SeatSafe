"use client";

// Owner: D. Buyer/seller chat on /orders/[id] with scam-risk warnings.
// The order (and who's buyer/seller) comes from useOrder(id). Messages are DEMO data seeded here,
// because lib/hooks.ts has no chat hook yet. TODO(B): add useOrderChat(orderId) (Supabase + Realtime)
// returning ChatMessage[] and a send(), then replace useOrderChatDemo below.
// Risk is a simple keyword check for now: off-platform payment apps and links.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ShieldAlert } from "lucide-react";
import { useOrder } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatMessage, Order } from "@/lib/types";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Risk check
// ---------------------------------------------------------------------------

const RISK_RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bzelle\b/i, reason: "Asks to pay with Zelle, outside SeatSafe." },
  { pattern: /\bvenmo\b/i, reason: "Asks to pay with Venmo, outside SeatSafe." },
  { pattern: /\bcash\s?app\b|\$[a-z][a-z0-9_]{2,}/i, reason: "Asks to pay with Cash App, outside SeatSafe." },
  { pattern: /\bpaypal\b/i, reason: "Asks to pay with PayPal, outside SeatSafe." },
  {
    pattern: /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|ly|me|app|co|xyz|link)\b/i,
    reason: "Contains a link. Links in chat can lead to fake ticket or payment pages.",
  },
];

/** Simple keyword check. Returns the first reason that matches, or null when the message looks fine. */
export function assessRisk(body: string): string | null {
  return RISK_RULES.find((r) => r.pattern.test(body))?.reason ?? null;
}

function withRisk(m: Omit<ChatMessage, "risk" | "riskReason">): ChatMessage {
  const reason = assessRisk(m.body);
  return reason ? { ...m, risk: "high", riskReason: reason } : { ...m, risk: "low" };
}

// ---------------------------------------------------------------------------
// Demo data (replace with useOrderChat from lib/hooks.ts)
// ---------------------------------------------------------------------------

/** Seed lines per mock order: [minutes after the order was funded, from seller?, text]. */
const DEMO_SEED: Record<string, [number, boolean, string][]> = {
  ord_held: [
    [2, false, "Hi! Just paid. When can you send the ticket?"],
    [6, true, "Thanks! I'll transfer it tonight after work."],
  ],
  ord_transit: [
    [10, false, "Hi! Just paid. Are these the floor seats in row A?"],
    [30, true, "Yep, Floor A seat 4. Sending it over now."],
    [60, true, "Actually can you cancel and just pay me on Zelle, faster that way"],
    [65, false, "I'll stick with SeatSafe, thanks."],
  ],
};

function seedFor(order: Order): ChatMessage[] {
  const funded = order.events[0]?.at;
  if (!funded) return [];
  const start = new Date(funded).getTime();
  return (DEMO_SEED[order.id] ?? []).map(([min, fromSeller, body], i) =>
    withRisk({
      id: `demo_${order.id}_${i}`,
      orderId: order.id,
      senderId: fromSeller ? order.sellerId : order.buyerId,
      body,
      at: new Date(start + min * 60_000).toISOString(),
    }),
  );
}

function useOrderChatDemo(order: Order | null) {
  const [sent, setSent] = useState<ChatMessage[]>([]);
  const messages = order ? [...seedFor(order), ...sent.filter((m) => m.orderId === order.id)] : [];
  // Mock orders always belong to the mock buyer.
  const me = order?.buyerId ?? null;

  function send(body: string) {
    if (!order || !me) return;
    const at = Date.now();
    setSent((s) => [
      ...s,
      withRisk({ id: `local_${at}`, orderId: order.id, senderId: me, body, at: new Date(at).toISOString() }),
    ]);
  }

  return { messages, me, send };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export function OrderChat() {
  const { id } = useParams<{ id: string }>();
  const { order } = useOrder(id);
  const { messages, me, send } = useOrderChatDemo(order);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  const flagged = messages.filter((m) => m.risk === "high");
  const draftRisk = draft.trim() ? assessRisk(draft) : null;

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!order) return null;
  const counterpart = me === order.buyerId ? "seller" : "buyer";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    send(draft.trim());
    setDraft("");
  }

  return (
    <section className="mt-4 surface-solid rounded-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold">Chat with the {counterpart}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Messages stay with this order. SeatSafe never asks you to pay outside the app.
      </p>

      <AnimatePresence initial={false}>
        {flagged.length > 0 && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex gap-3 rounded-xl border border-disputed bg-disputed/15 p-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-disputed" />
              <div className="text-sm">
                <p className="font-semibold text-disputed">Possible scam in this chat</p>
                <p className="mt-0.5 text-foreground/90">
                  {flagged[flagged.length - 1].riskReason} Never pay with Zelle, Venmo, Cash App or a link. Your
                  money is only protected while it&apos;s in the SeatSafe vault.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ol ref={listRef} className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">No messages yet. Say hi.</li>
        )}
        {messages.map((m) => {
          const mine = m.senderId === me;
          const risky = m.risk === "high";
          return (
            <motion.li
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex flex-col", mine ? "items-end" : "items-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                  mine ? "rounded-br-md bg-secondary" : "rounded-bl-md border border-border bg-muted",
                  risky && "border border-disputed",
                )}
              >
                {m.body}
              </div>
              <p className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
                {risky && (
                  <span className="inline-flex items-center gap-1 font-medium text-disputed">
                    <ShieldAlert className="size-3" />
                    Flagged ·
                  </span>
                )}
                {mine ? "You" : counterpart === "seller" ? "Seller" : "Buyer"} · {formatDate(m.at)}
              </p>
            </motion.li>
          );
        })}
      </ol>

      <form
        onSubmit={onSubmit}
        className={cn(
          "mt-4 flex items-center gap-2 rounded-full border bg-muted py-1.5 pr-1.5 pl-4 focus-within:border-ring",
          draftRisk ? "border-disputed" : "border-border",
        )}
      >
        <label htmlFor="order-chat-input" className="sr-only">
          Message
        </label>
        <input
          id="order-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message the ${counterpart}`}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          className="size-9 shrink-0 rounded-full"
          aria-label="Send"
          disabled={!draft.trim()}
        >
          <ArrowUp className="size-4" />
        </Button>
      </form>
      {draftRisk && <p className="mt-2 px-1 text-xs text-disputed">{draftRisk}</p>}
    </section>
  );
}
