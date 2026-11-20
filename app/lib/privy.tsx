"use client";

// Privy login (email + Google) with an embedded Solana wallet created on login.
// Config follows Privy React SDK v3 (docs.privy.io/basics/react/setup).
// With no NEXT_PUBLIC_PRIVY_APP_ID the app still runs: no PrivyProvider, login disabled, banner shown.

import { useState, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { X } from "lucide-react";
import { RPC_URL } from "./solana";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
/** Components that call Privy hooks must check this first (hooks throw outside PrivyProvider). */
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

// Privy needs @solana/kit RPC objects to sign/send from the embedded wallet UI.
const WS_URL = RPC_URL.replace(/^http/, "ws");

export function Providers({ children }: { children: ReactNode }) {
  if (!PRIVY_ENABLED) {
    return (
      <>
        <LoginDisabledBanner />
        {children}
      </>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google"],
        appearance: {
          theme: "dark",
          accentColor: "#e5383b",
          walletChainType: "solana-only",
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
        },
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL),
              blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

function LoginDisabledBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center justify-center gap-3 bg-transit/15 px-4 py-1.5 text-xs text-transit">
      <span>
        Login disabled: add <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="rounded p-0.5 hover:bg-transit/20"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
