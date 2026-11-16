"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Wallet } from "lucide-react";
import { PRIVY_ENABLED } from "@/lib/privy";
import { connection, USDC_MINT } from "@/lib/solana";
import { formatUsd } from "@/lib/format";

const REFRESH_MS = 15_000;

/** Devnet USDC balance of `owner`'s associated token account. 0 if the account doesn't exist yet. */
async function fetchUsdcBalance(owner: string): Promise<number> {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(owner));
  const info = await connection.getAccountInfo(ata);
  if (!info) return 0;
  const { value } = await connection.getTokenAccountBalance(ata);
  return Number(value.uiAmountString ?? "0");
}

export function UsdcBalance() {
  if (!PRIVY_ENABLED) return null;
  return <PrivyUsdcBalance />;
}

// Only rendered inside PrivyProvider.
function PrivyUsdcBalance() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  // Only embedded wallets are enabled (no external connectors), so the first Solana wallet is the user's.
  const address = authenticated ? wallets[0]?.address : undefined;
  const [balance, setBalance] = useState<{ address: string; usd: number } | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = async () => {
      try {
        const usd = await fetchUsdcBalance(address);
        if (!cancelled) setBalance({ address, usd });
      } catch (err) {
        console.warn("USDC balance fetch failed", err);
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  if (!address) return null;
  const text = balance?.address === address ? formatUsd(balance.usd) : "…";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium tabular-nums"
      title="Devnet USDC balance"
    >
      <Wallet className="size-3.5 text-vault" />
      {text}
    </span>
  );
}
