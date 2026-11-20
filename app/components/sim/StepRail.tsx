"use client";

// Owner: A. Numbered steps with progress. Done = green check, current = glowing, upcoming = dim.

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepRail({ steps, current, onSelect }: { steps: { title: string }[]; current: number; onSelect?: (i: number) => void }) {
  return (
    <ol className="no-scrollbar flex w-full gap-1.5 overflow-x-auto pb-1" aria-label="Steps">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={s.title} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(i)}
              aria-current={state === "now" ? "step" : undefined}
              className={cn(
                "flex w-full min-w-24 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition-colors",
                state === "now" && "border-primary bg-primary/15 glow-primary",
                state === "done" && "border-released/40 bg-released/10",
                state === "next" && "border-white/10 bg-white/[0.03] text-white/50",
              )}
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", state === "done" ? "bg-released text-black" : state === "now" ? "bg-primary text-primary-foreground" : "bg-white/10")}>
                {state === "done" ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="truncate">{s.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
