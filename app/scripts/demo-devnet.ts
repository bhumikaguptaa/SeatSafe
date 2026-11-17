// Devnet proof of the demo checklist (docs/demo-checklist.md) without a browser.
//
// Every SeatSafe action is built by app/lib/program.ts and sent the way app/app/api/relay/route.ts
// does it: feePayer = relayer, user signs, checkRelayTx, relayer co-signs, preflight send, confirm.
// Users are throwaway keypairs with 0 SOL; their USDC comes from the seed seller / deployer.
// The seeded $20 escrow is left alone for the browser demo; this creates its own $1 one.
//
//   cd app && npm run demo:devnet          (RPC_URL=<devnet endpoint> optional)
//
// Prints signatures and addresses only, never secret keys.

/* eslint-disable @typescript-eslint/no-explicit-any -- test script */
process.env.RPC_URL ??= "https://api.devnet.solana.com";
import "./verify-env";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as P from "../lib/program";
import { checkRelayTx } from "../lib/relay-policy";
import { programErrorName, TxError } from "../lib/errors";

const TIMEOUT = 60_000;
const EVENT = new PublicKey("EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE"); // Battle of the Bands: $10, cap $15
const RESALE = 11; // under the $15 cap (the checklist uses $14; kept low so the faucet covers it)
const OVER_CAP = 50;
const ESCROW = { price: 1, bond: 1, window: 60 };

const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!, "confirmed");
const program = P.getProgram(connection);
const root = path.resolve(__dirname, "../..");
const loadKey = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const relayer = loadKey(path.join(root, ".keys/relayer.json"));
const seller = loadKey(path.join(root, ".keys/seed-seller.json"));
const deployer = loadKey(process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json"));

const proof: { step: string; sig: string; status: string }[] = [];
const explorer = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const ok = (step: string, sig: string) => {
  proof.push({ step, sig, status: "PASS" });
  log(`PASS ${step}\n       ${explorer(sig)}`);
};

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`timeout after 60s: ${what}`)), TIMEOUT))),
  ]);
}

/** Same steps as /api/relay. One retry with a fresh blockhash if confirmation times out. */
async function relay(label: string, build: () => Promise<P.BuiltTx>, user: Keypair): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const built = await build(); // fresh blockhash each attempt
    built.tx.sign([user]);
    const verdict = checkRelayTx(built.tx, relayer.publicKey, program.programId);
    if (!verdict.ok) throw new TxError(`Rejected by relay policy: ${verdict.reason}`);
    built.tx.sign([relayer]);
    let sig: string;
    try {
      sig = await withTimeout(connection.sendRawTransaction(built.tx.serialize(), { preflightCommitment: "confirmed" }), `${label} send`);
    } catch (e: any) {
      const logs = e?.getLogs ? await e.getLogs(connection).catch(() => e.logs ?? []) : e?.logs ?? [];
      throw new TxError(e?.message ?? String(e), logs);
    }
    log(`  ${label}: sent ${sig} (attempt ${attempt})`);
    try {
      const res = await withTimeout(connection.confirmTransaction(
        { signature: sig, blockhash: built.tx.message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight },
        "confirmed"), `${label} confirm`);
      if (res.value.err) throw new TxError(`${label} failed: ${JSON.stringify(res.value.err)}`, [], sig);
      return sig;
    } catch (e) {
      if (e instanceof TxError || attempt === 2) throw e;
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st && !st.err && st.confirmationStatus) return sig;
      log(`  ${label}: ${(e as Error).message}; retrying once`);
    }
  }
}

/** Plain (non-relayed) setup transfer signed by `from`. */
async function transfer(label: string, from: Keypair, ixs: TransactionInstruction[]) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: deployer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...[deployer, from].filter((k, i, a) => a.findIndex((x) => x.publicKey.equals(k.publicKey)) === i));
  const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  const res = await withTimeout(connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed"), label);
  if (res.value.err) throw new Error(`${label} failed ${sig}`);
  log(`  setup ${label}: ${sig}`);
  return sig;
}

async function chainTime(): Promise<number> {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  return Number(info!.data.readBigInt64LE(32));
}

async function main() {
  const cfg = await P.getConfig(program);
  const mint = cfg.usdc.mint;
  const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true, TOKEN_PROGRAM_ID);
  const usdc = async (o: PublicKey) => Number((await connection.getTokenAccountBalance(ata(o)).catch(() => null))?.value.uiAmount ?? 0);
  const fund = (from: Keypair, to: PublicKey, usd: number) => [
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, ata(to), to, mint, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(ata(from.publicKey), mint, ata(to), from.publicKey, BigInt(Math.round(usd * 1e6)), 6, [], TOKEN_PROGRAM_ID),
  ];

  const a = Keypair.generate(); // "wallet 1": buys primary, lists, funds escrow, claims refund
  const b = Keypair.generate(); // "wallet 2": buys the resale
  log("RPC      :", new URL(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!).host);
  log("Relayer  :", relayer.publicKey.toBase58(), "SOL", (await connection.getBalance(relayer.publicKey)) / 1e9);
  log("Wallet A :", a.publicKey.toBase58());
  log("Wallet B :", b.publicKey.toBase58());

  // Setup: A needs $10 + $1 escrow, B needs $11. Seller pays A; deployer tops up B.
  const needA = 10 + ESCROW.price, needB = RESALE;
  const deployerUsdc = await usdc(deployer.publicKey);
  const fromDeployerB = Math.min(needB, Math.floor(deployerUsdc));
  await transfer("USDC -> A", seller, fund(seller, a.publicKey, needA));
  if (fromDeployerB > 0) await transfer("USDC -> B (deployer)", deployer, fund(deployer, b.publicKey, fromDeployerB));
  if (needB > fromDeployerB) await transfer("USDC -> B (seller)", seller, fund(seller, b.publicKey, needB - fromDeployerB));

  // b. Buy primary
  const ctxA = (payer = relayer.publicKey) => ({ program, user: a.publicKey, payer });
  const ev = await program.account.event.fetch(EVENT);
  const ticketMint = P.pdas(program.programId).ticketMint(EVENT, ev.sold);
  ok("b. buy_primary ($10, wallet A)", await relay("buy_primary", () => P.buyPrimary(ctxA(), { event: EVENT, seat: `GA ${ev.sold + 1}` }), a));

  // d. Over-cap resale must be rejected with AboveResaleCap (preflight: nothing lands, no fee)
  try {
    await relay("list_resale over cap", () => P.listResale(ctxA(), { ticketMint, priceUsd: OVER_CAP }), a);
    proof.push({ step: `d. list_resale $${OVER_CAP} (over $15 cap)`, sig: "-", status: "FAIL (was accepted)" });
  } catch (e) {
    const name = programErrorName(e);
    const st = name === "AboveResaleCap" ? "PASS" : `FAIL (${name ?? (e as Error).message})`;
    proof.push({ step: `d. list_resale $${OVER_CAP} rejected: ${name}`, sig: "rejected in preflight (no tx)", status: st });
    log(`${st.startsWith("PASS") ? "PASS" : "FAIL"} d. over-cap listing rejected: ${name}`);
  }

  // e1. Resale under cap; e2. swap from wallet B
  ok(`e1. list_resale $${RESALE} (wallet A)`, await relay("list_resale", () => P.listResale(ctxA(), { ticketMint, priceUsd: RESALE }), a));
  const aBefore = await usdc(a.publicKey);
  ok(`e2. swap_resale (wallet B buys A's listing)`, await relay("swap_resale",
    () => P.swapResale({ program, user: b.publicKey, payer: relayer.publicKey }, { ticketMint }), b));
  const bTicket = await connection.getTokenAccountBalance(P.ticketAta(ticketMint, b.publicKey));
  log(`  B holds ticket: ${bTicket.value.uiAmount}; A received $${(await usdc(a.publicKey)) - aBefore}`);

  // f. Escrow: seed seller lists, A funds, seller never ships, A refunds after the window
  const ctxS = { program, user: seller.publicKey, payer: relayer.publicKey };
  let escrow!: PublicKey;
  ok(`f0. create_escrow_listing ($${ESCROW.price}, bond $${ESCROW.bond}, ${ESCROW.window}s)`, await relay("create_escrow_listing", async () => {
    const built = await P.createEscrowListing(ctxS, { priceUsd: ESCROW.price, bondUsd: ESCROW.bond, shipWindowSecs: ESCROW.window, confirmWindowSecs: ESCROW.window });
    escrow = built.address!;
    return built;
  }, seller));
  log("  escrow:", escrow.toBase58());
  ok("f1. fund_escrow (wallet A)", await relay("fund_escrow", () => P.fundEscrow(ctxA(), { escrow }), a));
  const deadline = (await program.account.escrowOrder.fetch(escrow)).shipDeadline.toNumber();
  log(`  waiting for chain time > ship deadline ${deadline}...`);
  while ((await chainTime()) <= deadline) await new Promise((r) => setTimeout(r, 3000));
  const aPre = await usdc(a.publicKey);
  ok("f3. refund_expired (wallet A)", await relay("refund_expired", () => P.refundExpired(ctxA(), { escrow }), a));
  log(`  A refunded $${(await usdc(a.publicKey)) - aPre} (price + bond)`);

  const solA = await connection.getBalance(a.publicKey), solB = await connection.getBalance(b.publicKey);
  proof.push({ step: "gas: wallets A and B SOL stay 0", sig: "-", status: solA === 0 && solB === 0 ? "PASS" : `FAIL (${solA}, ${solB})` });

  console.log("\n| Step | Signature | Status |\n| --- | --- | --- |");
  for (const p of proof) console.log(`| ${p.step} | ${p.sig.length > 60 ? `[${p.sig.slice(0, 8)}…](${explorer(p.sig)})` : p.sig} | ${p.status} |`);
  console.log("\nFull signatures:");
  for (const p of proof) if (p.sig.length > 60) console.log(`${p.step}: ${p.sig}`);
  process.exit(proof.every((p) => p.status === "PASS") ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof TxError ? `${e.message}\n${e.logs.join("\n")}` : e);
  process.exit(1);
});
