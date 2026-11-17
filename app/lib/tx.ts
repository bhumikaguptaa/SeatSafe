"use client";

// Owner: A. Sending SeatSafe transactions so users never need SOL.
//
// Flow (sendWithRelayer):
//   1. Ask /api/relay whether gas sponsorship is on, and which key pays.
//   2. Build the tx with feePayer = relayer (the builder also uses it as the program's `payer`).
//   3. The user's Privy embedded Solana wallet SIGNS it (useSignTransaction; does not send).
//   4. POST the partially signed tx to /api/relay: the server checks it, co-signs, sends, confirms.
// Fallback when the relayer is off (no RELAYER_SECRET_KEY on the server): the user is fee payer
// and Privy signs and sends (useSignAndSendTransaction). Needs devnet SOL in the user's wallet.
//
// Privy API per docs.privy.io/wallets/using-wallets/solana/sign-a-transaction and
// .../send-a-transaction (React SDK v3: hooks from "@privy-io/react-auth/solana").

import { useCallback, useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { useSignAndSendTransaction, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { toast } from "sonner";
import { PRIVY_ENABLED } from "./privy";
import { connection, explorerTx } from "./solana";
import type { BuiltTx, TxCtx } from "./program";
import { chainProgram } from "./chain";
import { friendlyError, TxError, type ErrorContext } from "./errors";

const CHAIN = "solana:devnet" as const;

// ---------------------------------------------------------------------------
// Relayer discovery
// ---------------------------------------------------------------------------

interface RelayerStatus {
  enabled: boolean;
  relayer: PublicKey | null;
}

let relayerStatus: Promise<RelayerStatus> | null = null;

export function getRelayerStatus(): Promise<RelayerStatus> {
  if (!relayerStatus) {
    relayerStatus = fetch("/api/relay", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ enabled: boolean; relayer: string | null }>)
      .then(({ enabled, relayer }) => {
        const fromEnv = process.env.NEXT_PUBLIC_RELAYER_PUBKEY;
        if (enabled && fromEnv && relayer && fromEnv !== relayer) {
          console.warn("NEXT_PUBLIC_RELAYER_PUBKEY doesn't match the server's relayer; using the server's.");
        }
        return { enabled, relayer: enabled && relayer ? new PublicKey(relayer) : null };
      })
      .catch(() => ({ enabled: false, relayer: null }));
  }
  return relayerStatus;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** What sendWithRelayer needs from a wallet. useTxWallet() provides it from Privy. */
export interface TxWallet {
  address: PublicKey;
  /** Sign only; returns the serialized signed transaction. */
  signTransaction(tx: Uint8Array): Promise<Uint8Array>;
  /** Sign and send (fallback when the relayer is off); returns the base58 signature. */
  signAndSendTransaction(tx: Uint8Array): Promise<string>;
}

export interface SentTx {
  signature: string;
  explorerUrl: string;
  /** Main account the action created or acted on (from the builder). */
  address?: PublicKey;
  sponsored: boolean;
}

/**
 * Builds, signs and sends one SeatSafe transaction. `build` gets the fee payer chosen here
 * (relayer, or the user in fallback mode), e.g. `(payer) => buyPrimary({ program, user, payer }, args)`.
 * Throws TxError (with program logs and, if sent, the signature) on failure.
 */
export async function sendWithRelayer(
  build: (payer: PublicKey) => Promise<BuiltTx>,
  wallet: TxWallet,
): Promise<SentTx> {
  const { enabled, relayer } = await getRelayerStatus();

  if (enabled && relayer) {
    const built = await build(relayer);
    const signed = await wallet.signTransaction(built.tx.serialize());
    const res = await fetch("/api/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tx: Buffer.from(signed).toString("base64"),
        lastValidBlockHeight: built.lastValidBlockHeight,
      }),
    });
    const body = (await res.json()) as { signature?: string; error?: string; logs?: string[] };
    if (!res.ok || !body.signature) {
      throw new TxError(body.error ?? `Relay failed (${res.status})`, body.logs ?? [], body.signature);
    }
    return { signature: body.signature, explorerUrl: explorerTx(body.signature), address: built.address, sponsored: true };
  }

  console.warn("Relayer is off (no RELAYER_SECRET_KEY on the server): the user pays the fee and needs devnet SOL.");
  const built = await build(wallet.address);
  let signature: string;
  try {
    signature = await wallet.signAndSendTransaction(built.tx.serialize());
  } catch (err) {
    const logs = (err as { logs?: string[] })?.logs ?? [];
    throw new TxError(err instanceof Error ? err.message : String(err), logs);
  }
  const res = await connection.confirmTransaction(
    { signature, blockhash: built.tx.message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    "confirmed",
  );
  if (res.value.err) {
    const info = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    throw new TxError("Transaction failed", info?.meta?.logMessages ?? [], signature);
  }
  return { signature, explorerUrl: explorerTx(signature), address: built.address, sponsored: false };
}

// ---------------------------------------------------------------------------
// React: the user's Privy wallet as a TxWallet
// ---------------------------------------------------------------------------

function usePrivyTxWallet(): TxWallet | null {
  const { ready, wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const wallet = ready ? wallets[0] : undefined;

  return useMemo(() => {
    if (!wallet) return null;
    return {
      address: new PublicKey(wallet.address),
      signTransaction: async (tx) =>
        (await signTransaction({ transaction: tx, wallet, chain: CHAIN })).signedTransaction,
      signAndSendTransaction: async (tx) => {
        const { signature } = await signAndSendTransaction({ transaction: tx, wallet, chain: CHAIN });
        return utils.bytes.bs58.encode(signature);
      },
    };
  }, [wallet, signTransaction, signAndSendTransaction]);
}

function useNoTxWallet(): TxWallet | null {
  return null;
}

/** The logged-in user's wallet, or null (logged out, wallet still loading, or Privy disabled). */
export const useTxWallet: () => TxWallet | null = PRIVY_ENABLED ? usePrivyTxWallet : useNoTxWallet;

// ---------------------------------------------------------------------------
// React: run an action with loading / success / friendly error toasts
// ---------------------------------------------------------------------------

export interface RunTxOptions {
  /** Shown while signing and sending, e.g. "Buying ticket…" */
  pending: string;
  /** Shown on success, e.g. "Ticket bought" */
  success: string;
  /** Values for specific error messages (e.g. the event's resale cap). */
  errorContext?: ErrorContext;
}

/**
 * Returns run(build, opts): sends the transaction with sendWithRelayer and shows toasts.
 * Resolves to the SentTx, or null if it failed (the error toast is already shown).
 */
export function useRunTx() {
  const wallet = useTxWallet();
  const run = useCallback(
    async (build: (ctx: TxCtx) => Promise<BuiltTx>, opts: RunTxOptions): Promise<SentTx | null> => {
      if (!wallet) {
        toast.error("Log in first. Your wallet is created when you log in.");
        return null;
      }
      const id = toast.loading(opts.pending);
      try {
        const program = chainProgram();
        const sent = await sendWithRelayer(
          (payer) => build({ program, user: wallet.address, payer }),
          wallet,
        );
        toast.success(opts.success, {
          id,
          description: sent.sponsored ? "Gas paid by SeatSafe." : undefined,
          action: { label: "View tx", onClick: () => window.open(sent.explorerUrl, "_blank", "noopener") },
        });
        return sent;
      } catch (err) {
        console.error(opts.pending, err);
        const f = friendlyError(err, opts.errorContext);
        toast.error(f.message, {
          id,
          action: f.signature
            ? { label: "View tx", onClick: () => window.open(explorerTx(f.signature!), "_blank", "noopener") }
            : undefined,
        });
        return null;
      }
    },
    [wallet],
  );
  return { run, wallet };
}

/**
 * Mock mode stand-in for run(): same toasts, no transaction. Pass `error` to show a friendly
 * error instead (e.g. the over-cap rejection, so the demo moment works without devnet).
 */
export async function mockTx(opts: RunTxOptions, error?: string): Promise<boolean> {
  const id = toast.loading(opts.pending);
  await new Promise((r) => setTimeout(r, 700));
  if (error) {
    toast.error(error, { id, description: "Mock mode: no transaction sent." });
    return false;
  }
  toast.success(opts.success, { id, description: "Mock mode: no transaction sent." });
  return true;
}
