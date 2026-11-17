"use client";

// Owner: D. Approve agent purchases by voice (ElevenLabs), shown as an incoming call.
// Today it's tap-only: Approve / Decline buttons, with an animated waveform standing in for the voice.
// TODO(D): with ElevenLabs, read `prompt` aloud when the call opens and accept a spoken yes/no
// (needs an ELEVENLABS_API_KEY server route; see the agent PR for wiring).

import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, X } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";

export interface VoiceApprovalRequest {
  /** One line the agent says, e.g. "Found 2 tickets for UT vs. A&M at $85 each." */
  prompt: string;
  totalUsd: number;
  detail: string;
}

const BARS = [0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.8];

export function VoiceApproval({
  request,
  onApprove,
  onDecline,
}: {
  /** null = no call; the panel slides away */
  request: VoiceApprovalRequest | null;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <AnimatePresence>
      {request && (
        <motion.div
          role="alertdialog"
          aria-label="Your agent is asking for approval"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm overflow-hidden rounded-3xl border border-border bg-card/95 p-6 shadow-2xl backdrop-blur-xl md:inset-x-auto md:right-8 md:bottom-8 md:w-96"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklch,var(--primary)_30%,transparent),transparent)]"
          />

          <div className="relative flex flex-col items-center text-center">
            {/* Caller avatar with ringing pulses */}
            <div className="relative flex size-20 items-center justify-center">
              {[0, 0.6].map((delay) => (
                <motion.span
                  key={delay}
                  className="absolute inset-0 rounded-full border border-foreground/30"
                  animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, delay, ease: "easeOut" }}
                />
              ))}
              <span className="flex size-16 items-center justify-center rounded-full border border-border bg-muted">
                <Bot className="size-7" />
              </span>
            </div>

            <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              SeatSafe agent · calling
            </p>
            <p className="mt-2 text-sm">{request.prompt}</p>
            <p className="mt-3 text-4xl font-bold tracking-tight tabular-nums">{formatUsd(request.totalUsd)}</p>
            <p className="text-xs text-muted-foreground">{request.detail}</p>

            {/* Voice waveform placeholder */}
            <div aria-hidden className="mt-4 flex h-6 items-center gap-1">
              {BARS.map((h, i) => (
                <motion.span
                  key={i}
                  className="w-1 rounded-full bg-muted-foreground"
                  animate={{ height: [`${h * 40}%`, `${h * 100}%`, `${h * 40}%`] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.08 }}
                />
              ))}
            </div>

            <div className="mt-6 grid w-full grid-cols-2 gap-6">
              <div className="flex flex-col items-center gap-1.5">
                <Button
                  variant="outline"
                  className="size-16 rounded-full"
                  aria-label="Decline"
                  onClick={onDecline}
                >
                  <X className="size-6" />
                </Button>
                <span className="text-xs text-muted-foreground">Decline</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <Button className="size-16 rounded-full" aria-label="Approve" onClick={onApprove}>
                  <Check className="size-6" />
                </Button>
                <span className="text-xs text-muted-foreground">Approve</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
