"use client";

// Owner: A. First-visit intro on Discover: three cards and "Got it". Shows on the first visit (remembered in
// localStorage, wrapped in try/catch) or whenever the URL has ?intro=1 (for recording). Esc dismisses.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Lock, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "seatsafe:intro-seen";

const CARDS = [
  { icon: ShieldCheck, title: "Resale capped by the artist", text: "Fans can resell, but never above the price the artist sets. The program rejects anything higher." },
  { icon: Lock, title: "Outside tickets held in escrow", text: "Bought a ticket from another site? Your money waits in a vault until the ticket works, or comes back to you." },
  { icon: Mail, title: "No crypto needed: log in with email", text: "Your wallet is created when you log in. SeatSafe pays the network fees." },
];

export function FirstVisitIntro() {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let show = new URLSearchParams(window.location.search).get("intro") === "1";
    try {
      if (!localStorage.getItem(KEY)) show = true;
    } catch {
      // storage blocked: only ?intro=1 shows it
    }
    if (!show) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // fine
    }
  };

  useEffect(() => {
    if (!open) return;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="intro-title"
            className="w-full max-w-3xl rounded-3xl border border-[#26262E] bg-[#0B0B0F] p-5 sm:p-7"
            initial={reduced ? false : { y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="intro-title" className="text-2xl font-bold tracking-tight">Tickets you can trust</h2>
            <p className="mt-1 text-sm text-[#A1A1AA]">Your money only moves when the ticket does.</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-3">
              {CARDS.map(({ icon: Icon, title, text }, i) => (
                <motion.li
                  key={title}
                  className="rounded-2xl border border-[#26262E] bg-[#15151B] p-4"
                  initial={reduced ? false : { y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: reduced ? 0 : 0.08 + i * 0.08 }}
                >
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <p className="mt-3 font-semibold">{title}</p>
                  <p className="mt-1 text-sm text-[#A1A1AA]">{text}</p>
                </motion.li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs text-[#A1A1AA]">Press Esc to close</p>
              <Button ref={button} onClick={close} className="h-10 px-6">Got it</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
