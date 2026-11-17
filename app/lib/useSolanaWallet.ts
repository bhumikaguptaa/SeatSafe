"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";

/**
 * The logged-in user's Solana embedded wallet address.
 *
 * Per Privy's React SDK docs, Solana wallets come from `useWallets()` in
 * `@privy-io/react-auth/solana`, which returns `{ ready, wallets }`. `ready` is
 * false while Privy loads the embedded wallet iframe. Only embedded wallets are
 * enabled (no external connectors), so the first Solana wallet is the user's.
 *
 * `address` is undefined while logged out, while wallets are loading, or right
 * after signup before `createOnLogin` has finished. Callers must handle that.
 * Only call inside PrivyProvider.
 */
export function useSolanaWallet(): { ready: boolean; address: string | undefined } {
  const { ready: authReady, authenticated } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const address = authenticated ? wallets?.[0]?.address : undefined;
  return { ready: authReady && walletsReady, address };
}

export function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
