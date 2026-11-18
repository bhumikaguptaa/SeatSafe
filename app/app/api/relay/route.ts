// Owner: B to review. Minimal relayer added by A for integration.
//
// GET  /api/relay -> { enabled, relayer }   (is gas sponsorship available, and which key pays)
// POST /api/relay  { tx: base64, lastValidBlockHeight? } -> { signature } | 400/500 { error, logs? }
//
// The client builds a v0 transaction with feePayer = relayer, the user signs it (Privy), and posts it
// here. We check it against lib/relay-policy.ts, co-sign with RELAYER_SECRET_KEY, send and confirm.
// Rate limit: 20 sponsored transactions per IP per minute. A low relayer balance is
// reported by GET /api/cron/relayer (under 1 devnet SOL).

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import {
  Connection,
  PublicKey,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { checkRelayTx } from "@/lib/relay-policy";
import { PROGRAM_ID, RPC_URL } from "@/lib/solana";
import idl from "@/lib/idl/seatsafe.json";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { loadRelayer } from "@/lib/server/relayer";

// Node.js runtime (the default; Cache Components forbids the `runtime` segment config).

const RELAY_LIMIT = 20;
const RELAY_WINDOW_MS = 60_000;

const programId = PROGRAM_ID ?? new PublicKey(idl.address);

/** Why the relayer is off: missing vs. set-but-unparseable (names only, never the value). */
function relayerProblem(): string {
  return process.env.RELAYER_SECRET_KEY?.trim()
    ? "RELAYER_SECRET_KEY is set but invalid (expected a JSON byte array or base58 secret key)"
    : "RELAYER_SECRET_KEY not configured";
}

export async function GET() {
  await dynamicRequest(); // read env at request time, never at build time
  const relayer = loadRelayer();
  return NextResponse.json({
    enabled: relayer !== null,
    relayer: relayer?.publicKey.toBase58() ?? null,
    ...(relayer ? {} : { error: relayerProblem() }),
  });
}

export async function POST(req: NextRequest) {
  const relayer = loadRelayer();
  if (!relayer) {
    return NextResponse.json({ error: relayerProblem() }, { status: 503 });
  }
  if (!rateLimit(`relay:${clientIp(req.headers)}`, RELAY_LIMIT, RELAY_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many relay requests. Try again in a minute." }, { status: 429 });
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
