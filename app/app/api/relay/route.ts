// Owner: B to review. Minimal relayer added by A for integration.
//
// GET  /api/relay -> { enabled, relayer }   (is gas sponsorship available, and which key pays)
// POST /api/relay  { tx: base64, lastValidBlockHeight? } -> { signature } | 400/500 { error, logs? }
//
// The client builds a v0 transaction with feePayer = relayer, the user signs it (Privy), and posts it
// here. We check it against lib/relay-policy.ts, co-sign with RELAYER_SECRET_KEY, send and confirm.
// TODO(B): rate-limit per IP/user before this is public; every accepted tx costs the relayer fees
// and possibly rent for new accounts.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { checkRelayTx } from "@/lib/relay-policy";
import { PROGRAM_ID, RPC_URL } from "@/lib/solana";
import idl from "@/lib/idl/seatsafe.json";

// Node.js runtime (the default; Cache Components forbids the `runtime` segment config).

/** RELAYER_SECRET_KEY as a JSON byte array ("[12,34,...]") or a base58 string. Server only. */
function loadRelayer(): Keypair | null {
  const raw = process.env.RELAYER_SECRET_KEY?.trim();
  if (!raw) return null;
  try {
    const bytes = raw.startsWith("[")
      ? Uint8Array.from(JSON.parse(raw) as number[])
      : utils.bytes.bs58.decode(raw);
    return Keypair.fromSecretKey(bytes);
  } catch {
    console.error("RELAYER_SECRET_KEY is set but could not be parsed");
    return null;
  }
}

const programId = PROGRAM_ID ?? new PublicKey(idl.address);

export async function GET() {
  await dynamicRequest(); // read env at request time, never at build time
  const relayer = loadRelayer();
  return NextResponse.json({
    enabled: relayer !== null,
    relayer: relayer?.publicKey.toBase58() ?? null,
  });
}

export async function POST(req: NextRequest) {
  const relayer = loadRelayer();
  if (!relayer) {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
  }

  let body: { tx?: string; lastValidBlockHeight?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.tx !== "string" || body.tx.length > 4096) {
    return NextResponse.json({ error: "Missing or oversized tx" }, { status: 400 });
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(body.tx, "base64"));
  } catch {
    return NextResponse.json({ error: "Could not decode transaction" }, { status: 400 });
  }

  const verdict = checkRelayTx(tx, relayer.publicKey, programId);
  if (!verdict.ok) {
    return NextResponse.json({ error: `Rejected: ${verdict.reason}` }, { status: 400 });
  }

  tx.sign([relayer]);

  const conn = new Connection(RPC_URL, "confirmed");
  let signature: string;
  try {
    // Preflight simulation catches program errors (e.g. AboveResaleCap) before anything lands.
    signature = await conn.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
  } catch (err) {
    const logs = err instanceof SendTransactionError ? await err.getLogs(conn).catch(() => []) : [];
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), logs },
      { status: 400 },
    );
  }

  try {
    const lastValidBlockHeight =
      body.lastValidBlockHeight ?? (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;
    const res = await conn.confirmTransaction(
      { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (res.value.err) {
      const info = await conn.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      return NextResponse.json(
        { error: "Transaction failed", signature, logs: info?.meta?.logMessages ?? [] },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Sent but not confirmed: ${err instanceof Error ? err.message : String(err)}`, signature },
      { status: 504 },
    );
  }

  return NextResponse.json({ signature });
}
