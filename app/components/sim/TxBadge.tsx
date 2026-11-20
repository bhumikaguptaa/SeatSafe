"use client";

// Owner: A. A transaction signature chip linking to Solana Explorer (devnet), or a "simulated" chip.

import { ExternalLink } from "lucide-react";
import { explorerTx } from "@/lib/solana";
import { cn } from "@/lib/utils";

export function TxBadge({ signature, label, failed = false }: { signature: string | null; label?: string; failed?: boolean }) {
  if (!signature) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]", failed ? "border-disputed/50 text-disputed" : "border-white/15 text-white/50")}>
        {label ?? (failed ? "rejected, nothing sent" : "simulated")}
      </span>
    );
  }
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-primary hover:border-primary"
      title="Open this transaction on Solana Explorer (devnet)"
    >
      {label ? `${label} · ` : ""}{signature.slice(0, 6)}…{signature.slice(-4)} <ExternalLink className="size-3" />
    </a>
  );
}
