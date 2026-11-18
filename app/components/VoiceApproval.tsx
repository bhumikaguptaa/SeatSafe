"use client";

// Owner: D. Approve agent purchases by voice (ElevenLabs), shown as an incoming call.
// The call rings; "Answer" starts a voice session with our ElevenLabs agent (public agent, ID from
// NEXT_PUBLIC_ELEVENLABS_AGENT_ID), passing the match as dynamic variables. The agent calls the client
// tools approve_purchase / decline_purchase, which run the same onApprove / onDecline as the buttons.
// The Approve / Decline buttons always work as a fallback (no agent ID, mic blocked, network down).
// Answering needs a click on purpose: browsers block the mic and audio without a recent user gesture.
//
// ElevenLabs agent setup (dashboard): dynamic variables quantity, event_title, seat, price,
// seller_rating, max_price; client tools approve_purchase and decline_purchase with "Wait for
// response" on; end_call enabled; authentication off.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, Phone, X } from "lucide-react";
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";
/** After a spoken yes/no, wait for the agent to hang up (end_call), but never longer than this. */
const HANGUP_GRACE_MS = 6_000;

export interface VoiceApprovalRequest {
  /** One line shown on screen, e.g. "Found 2 tickets for UT vs. A&M at $85 each." */
  prompt: string;
  totalUsd: number;
  detail: string;
  /** Dynamic variables for the ElevenLabs agent (names must match the agent's {{variables}} exactly). */
  voice: {
    quantity: number;
    event_title: string;
    seat: string;
    price: string;
    seller_rating: string;
    max_price: string;
  };
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
    <ConversationProvider>
      <AnimatePresence>
        {request && (
          <CallPanel key={request.prompt} request={request} onApprove={onApprove} onDecline={onDecline} />
        )}
      </AnimatePresence>
    </ConversationProvider>
  );
}

type Decision = "approve" | "decline";

function CallPanel({
  request,
  onApprove,
  onDecline,
}: {
  request: VoiceApprovalRequest;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const [answered, setAnswered] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [spoken, setSpoken] = useState<Decision | null>(null);
  const finished = useRef(false);
  const hangupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectedOnce, setConnectedOnce] = useState(false);

  // Hand the decision to the parent exactly once (it closes the panel). Kept in a ref so the voice
  // callbacks always see the latest onApprove / onDecline.
  const finish = useRef<(d: Decision) => void>(() => {});
  useEffect(() => {
    finish.current = (d: Decision) => {
      if (finished.current) return;
      finished.current = true;
      if (hangupTimer.current) clearTimeout(hangupTimer.current);
      if (d === "approve") onApprove();
      else onDecline();
    };
  });

  const spokenRef = useRef<Decision | null>(null);
  const conversation = useConversation({
    onConnect: () => setConnectedOnce(true),
    onDisconnect: () => {
      // The agent hung up after confirming (end_call): now act on what was said.
      if (spokenRef.current) finish.current(spokenRef.current);
    },
    onError: () => setVoiceFailed(true),
  });
  const { status, isSpeaking, startSession, endSession } = conversation;
  const live = status === "connected" || status === "connecting";

  /** Spoken answer: remember it, let the agent confirm and hang up, then act. */
  function decideByVoice(d: Decision): string {
    spokenRef.current = d;
    setSpoken(d);
    hangupTimer.current = setTimeout(() => {
      endSession();
      finish.current(d);
    }, HANGUP_GRACE_MS);
    return d === "approve"
      ? "Approved. The purchase is going through now."
      : "Declined. Nothing was bought; the agent keeps watching.";
  }
  useConversationClientTool("approve_purchase", () => decideByVoice("approve"));
  useConversationClientTool("decline_purchase", () => decideByVoice("decline"));

  /** Tapped answer: end any call and act right away. */
  function decideByTap(d: Decision) {
    if (live) endSession();
    finish.current(d);
  }

  function answer() {
    setAnswered(true);
    setVoiceFailed(false);
    try {
      startSession({ agentId: AGENT_ID, dynamicVariables: { ...request.voice } });
    } catch (err) {
      console.error("voice session failed to start", err);
      setVoiceFailed(true);
    }
  }

  // Leaving the screen (or the parent closing the call) ends the voice session.
  useEffect(
    () => () => {
      if (hangupTimer.current) clearTimeout(hangupTimer.current);
      endSession();
    },
    [endSession],
  );

  const voiceAvailable = AGENT_ID.length > 0 && !voiceFailed && status !== "error";
  const ringing = voiceAvailable && !answered;
  const statusText = !voiceAvailable
    ? AGENT_ID
      ? "Voice unavailable. Tap to answer."
      : "Tap to answer."
    : ringing
      ? "SeatSafe agent · incoming call"
      : spoken
        ? spoken === "approve"
          ? "You said yes · buying"
          : "You said no"
        : status === "connected"
          ? isSpeaking
            ? "Agent speaking"
            : "Listening · say yes or no"
          : status === "connecting" || !connectedOnce
            ? "Connecting… allow the microphone if asked"
            : "Call ended · tap to answer";

  return (
    <motion.div
      role="alertdialog"
      aria-label="Your agent is asking for approval"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm overflow-hidden rounded-3xl border border-border bg-[#0b1430]/90 p-6 shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_24px_60px_-20px_rgb(2_6_15/0.8)] backdrop-blur-xl md:inset-x-auto md:right-8 md:bottom-8 md:w-96"
    >
      <div className="relative flex flex-col items-center text-center">
        {/* Caller avatar: rings while ringing, steady once answered */}
        <div className="relative flex size-20 items-center justify-center">
          {ringing &&
            [0, 0.6].map((delay) => (
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

        <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase" aria-live="polite">
          {statusText}
        </p>
        <p className="mt-2 text-sm">{request.prompt}</p>
        <p className="mt-3 text-4xl font-bold tracking-tight tabular-nums">{formatUsd(request.totalUsd)}</p>
        <p className="text-xs text-muted-foreground">{request.detail}</p>

        {/* Waveform: moves only while the agent is talking */}
        <div aria-hidden className="mt-4 flex h-6 items-center gap-1">
          {BARS.map((h, i) => (
            <motion.span
              key={i}
              className="w-1 rounded-full bg-muted-foreground"
              animate={
                isSpeaking
                  ? { height: [`${h * 40}%`, `${h * 100}%`, `${h * 40}%`] }
                  : { height: `${h * 30}%` }
              }
              transition={isSpeaking ? { duration: 0.9, repeat: Infinity, delay: i * 0.08 } : { duration: 0.2 }}
            />
          ))}
        </div>

        {ringing ? (
          <>
            <div className="mt-6 grid w-full grid-cols-2 gap-6">
              <RoundAction label="Decline" onClick={() => decideByTap("decline")} variant="outline">
                <X className="size-6" />
              </RoundAction>
              <RoundAction label="Answer" onClick={answer}>
                <Phone className="size-6" />
              </RoundAction>
            </div>
            <Button variant="link" size="sm" className="mt-2 text-muted-foreground" onClick={() => decideByTap("approve")}>
              Approve without a call
            </Button>
          </>
        ) : (
          <div className={cn("mt-6 grid w-full grid-cols-2 gap-6", spoken && "pointer-events-none opacity-50")}>
            <RoundAction label="Decline" onClick={() => decideByTap("decline")} variant="outline">
              <X className="size-6" />
            </RoundAction>
            <RoundAction label="Approve" onClick={() => decideByTap("approve")}>
              <Check className="size-6" />
            </RoundAction>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function RoundAction({
  label,
  onClick,
  variant = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline";
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button variant={variant} className="size-16 rounded-full" aria-label={label} onClick={onClick}>
        {children}
      </Button>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
