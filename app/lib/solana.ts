// Solana client config shared by the app. Devnet only.
import { Connection, PublicKey } from "@solana/web3.js";

export const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export const connection = new Connection(RPC_URL, "confirmed");

// Circle's devnet USDC. Verify at https://developers.circle.com if balances look wrong.
const DEFAULT_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || DEFAULT_DEVNET_USDC,
);

/** USDC has 6 decimals: 1 USDC = 1_000_000 base units. */
export const USDC_DECIMALS = 6;

/** SeatSafe program ID. `null` until NEXT_PUBLIC_PROGRAM_ID is set. */
export const PROGRAM_ID: PublicKey | null = process.env.NEXT_PUBLIC_PROGRAM_ID
  ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
  : null;

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
