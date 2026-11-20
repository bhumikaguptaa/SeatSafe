"use client";

// Header wallet chip: devnet USDC balance. Click -> popover with the short address, copy, and Explorer link.

import { useEffect, useState } from "react";
import { useSolanaWallet } from "@/lib/useSolanaWallet";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Check, Copy, ExternalLink, Wallet } from "lucide-react";
import { PRIVY_ENABLED } from "@/lib/privy";
import { connection, explorerAddress, USDC_MINT } from "@/lib/solana";
import { formatUsd, shortAddress } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const { address } = useSolanaWallet();
  const [balance, setBalance] = useState<{ address: string; usd: number } | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the address is still shown
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Devnet USDC in your SeatSafe wallet"
        aria-label={`Wallet: ${text} devnet USDC`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#26262E] bg-[#15151B] px-2.5 text-xs font-medium tabular-nums hover:border-[#3f3f46]"
      >
        <Wallet className="size-3.5 text-primary" aria-hidden />
        {text}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block text-xs font-normal text-muted-foreground">Devnet USDC in your SeatSafe wallet</span>
            <span className="num block text-lg font-bold">{text}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem closeOnClick={false} onClick={copy} title={address}>
          {copied ? <Check className="text-released" /> : <Copy />}
          <span className="font-mono">{shortAddress(address)}</span>
          <span className="ml-auto text-xs text-muted-foreground">{copied ? "Copied" : "Copy"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" />}>
          <ExternalLink /> View on Solana Explorer ↗
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
