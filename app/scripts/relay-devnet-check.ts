// Smoke test of the REAL /api/relay route on devnet, from a brand-new wallet with 0 SOL.
// Uses create_event (the one action that needs no USDC). The test event is saved as hidden in
// event-meta so it stays off the app's lists.
//
//   (app running with NEXT_PUBLIC_USE_MOCK=false and RELAYER_SECRET_KEY set)
//   APP_URL=http://localhost:3100 RPC_URL=https://api.devnet.solana.com npm run check:relay

/* eslint-disable @typescript-eslint/no-explicit-any -- test script */
import "./verify-env";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as P from "../lib/program";
import * as chain from "../lib/chain";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!, "confirmed");
const program = P.getProgram(connection);

async function post(body: unknown) {
  const res = await fetch(`${APP}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

async function main() {
  const status = (await (await fetch(`${APP}/api/relay`)).json()) as { enabled: boolean; relayer: string };
  console.log("GET /api/relay:", status);
  if (!status.enabled) throw new Error("relayer disabled: start the app with RELAYER_SECRET_KEY");
  const relayer = new PublicKey(status.relayer);
  const relayerBefore = await connection.getBalance(relayer);

  // 1. Real sponsored transaction from a 0-SOL user.
  const user = Keypair.generate();
  const built = await P.createEvent(
    { program, user: user.publicKey, payer: relayer },
    { priceUsd: 1, supply: 1, resaleCapUsd: 1, royaltyBps: 0, startsAt: new Date(Date.now() + 86_400_000) },
  );
  built.tx.sign([user]); // the user only signs (what Privy's useSignTransaction does)
  const r = await post({ tx: Buffer.from(built.tx.serialize()).toString("base64"), lastValidBlockHeight: built.lastValidBlockHeight });
  console.log("POST create_event:", r.status, r.body);
  if (r.status !== 200) throw new Error("relay failed");

  const metaRes = await fetch(`${APP}/api/event-meta`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "event",
      id: built.address!.toBase58(),
      data: { title: "Relay smoke test", category: "campus", venue: "-", city: "-", imageGradient: "", organizerName: "test", hidden: true },
    }),
  });
  console.log("POST /api/event-meta:", metaRes.status, ((await metaRes.json()) as any).stored);

  const ev = await chain.getEvent(built.address!.toBase58());
  const userSol = await connection.getBalance(user.publicKey);
  const relayerAfter = await connection.getBalance(relayer);
  console.log("event onchain:", built.address!.toBase58(), ev ? `price $${ev.priceUsd}, organizer ${ev.organizer}` : "MISSING");
  console.log("user SOL (must be 0):", userSol / LAMPORTS_PER_SOL);
  console.log("relayer paid (fee + rent):", (relayerBefore - relayerAfter) / LAMPORTS_PER_SOL, "SOL");

  // 2. The route must refuse a tx that spends the relayer's SOL.
  const { blockhash } = await connection.getLatestBlockhash();
  const drain = new VersionedTransaction(
    new TransactionMessage({
      payerKey: relayer,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: relayer, toPubkey: user.publicKey, lamports: LAMPORTS_PER_SOL })],
    }).compileToV0Message(),
  );
  const bad = await post({ tx: Buffer.from(drain.serialize()).toString("base64") });
  console.log("POST drain attempt:", bad.status, bad.body);

  const ok = r.status === 200 && ev && userSol === 0 && bad.status === 400;
  console.log(ok ? "\nRELAY CHECK PASSED" : "\nRELAY CHECK FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
