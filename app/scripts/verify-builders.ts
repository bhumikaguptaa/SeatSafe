// Integration check for the app's transaction builders (app/lib/program.ts), the relayer policy
// (app/lib/relay-policy.ts), the chain readers (app/lib/chain.ts) and the friendly errors
// (app/lib/errors.ts), against a LOCAL validator with a test USDC mint.
//
// Every transaction goes through the same path as /api/relay: builder with feePayer = relayer,
// user signs, checkRelayTx, relayer co-signs, send, confirm. Users start with 0 SOL and must end
// with 0 SOL.
//
// Run:
//   cd program && solana-test-validator --reset --rpc-port 8999 --faucet-port 9911 \
//     --bpf-program 7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy target/deploy/seatsafe.so
//   cd app && npm run verify:local     (needs program/node_modules for ts-node)

/* eslint-disable @typescript-eslint/no-explicit-any -- test script */
import "./verify-env"; // must stay first: sets the local RPC before lib/solana.ts loads
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import * as P from "../lib/program";
import { checkRelayTx } from "../lib/relay-policy";
import * as chain from "../lib/chain";
import { friendlyError, TxError } from "../lib/errors";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL!;

const connection = new Connection(RPC, "confirmed");
const program = P.getProgram(connection);
const results: { step: string; ok: boolean; detail: string }[] = [];

function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`);
}

/** Same steps as app/app/api/relay/route.ts. Throws TxError with logs on failure. */
async function relay(relayer: Keypair, built: { tx: VersionedTransaction; lastValidBlockHeight: number }, user: Keypair) {
  built.tx.sign([user]);
  const verdict = checkRelayTx(built.tx, relayer.publicKey, program.programId);
  if (!verdict.ok) throw new TxError(`Rejected: ${verdict.reason}`);
  built.tx.sign([relayer]);
  let sig: string;
  try {
    sig = await connection.sendRawTransaction(built.tx.serialize(), { preflightCommitment: "confirmed" });
  } catch (e: any) {
    const logs = e?.getLogs ? await e.getLogs(connection).catch(() => e.logs ?? []) : e?.logs ?? [];
    throw new TxError(e?.message ?? String(e), logs);
  }
  const res = await connection.confirmTransaction(
    { signature: sig, blockhash: built.tx.message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    "confirmed",
  );
  if (res.value.err) throw new TxError(`failed: ${JSON.stringify(res.value.err)}`, [], sig);
  return sig;
}

async function chainTime(): Promise<number> {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  return Number(info!.data.readBigInt64LE(32));
}
async function waitPast(ts: number) {
  while ((await chainTime()) <= ts) await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  if (await connection.getAccountInfo(P.pdas(program.programId).config())) {
    throw new Error("Config already exists on this validator (it can only be set once). Restart it with --reset.");
  }
  const relayer = Keypair.generate();
  const admin = Keypair.generate();
  const arbiter = Keypair.generate();
  const treasury = Keypair.generate();
  const organizer = Keypair.generate();
  const wallet1 = Keypair.generate(); // primary buyer, then reseller
  const wallet2 = Keypair.generate(); // resale buyer
  const sam = Keypair.generate(); // outside-ticket seller
  const eve = Keypair.generate(); // escrow buyer
  const users = { organizer, wallet1, wallet2, sam, eve };

  await connection.confirmTransaction(await connection.requestAirdrop(relayer.publicKey, 50 * LAMPORTS_PER_SOL), "confirmed");

  // Test USDC (classic SPL Token, 6 decimals) and Config pointing at it.
  const mintAuth = Keypair.generate();
  const usdcMint = await createMint(connection, relayer, mintAuth.publicKey, null, 6, undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  for (const [kp, amount] of [[wallet1, 500], [wallet2, 500], [sam, 100], [eve, 200], [organizer, 0]] as [Keypair, number][]) {
    const ata = await getOrCreateAssociatedTokenAccount(connection, relayer, usdcMint, kp.publicKey, false, "confirmed", { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    if (amount) await mintTo(connection, relayer, usdcMint, ata.address, mintAuth, BigInt(amount * 1_000_000), [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  }
  {
    const ix = await program.methods
      .initConfig(arbiter.publicKey, treasury.publicKey, 300, new BN(3600))
      .accountsPartial({ payer: relayer.publicKey, admin: admin.publicKey, usdcMint })
      .instruction();
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: relayer.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message());
    tx.sign([relayer, admin]);
    await connection.confirmTransaction(await connection.sendTransaction(tx), "confirmed");
  }
  const usdc = (await P.getConfig(program)).usdc;
  const bal = async (k: PublicKey) => {
    try { return Number((await getAccount(connection, P.usdcAta(usdc, k), "confirmed")).amount) / 1e6; } catch { return 0; }
  };
  const ctx = (user: Keypair) => ({ program, user: user.publicKey, payer: relayer.publicKey });

  // a) create event: $75, supply 10, cap $120, royalty 5%
  const created = await P.createEvent(ctx(organizer), { priceUsd: 75, supply: 10, resaleCapUsd: 120, royaltyBps: 500, startsAt: new Date(Date.now() + 86_400_000) });
  const eventPda = created.address!;
  record("a) createEvent", true, await relay(relayer, created, organizer));
  const ev = await chain.getEvent(eventPda.toBase58());
  record("   chain.getEvent", ev?.priceUsd === 75 && ev?.resaleCapUsd === 120, JSON.stringify({ price: ev?.priceUsd, cap: ev?.resaleCapUsd, royalty: ev?.royaltyBps }));

  // b) buy primary
  const bought = await P.buyPrimary(ctx(wallet1), { event: eventPda, seat: "Sec 101 Row C Seat 12" });
  const mint = bought.address!;
  record("b) buyPrimary", true, await relay(relayer, bought, wallet1));
  record("   wallet1 USDC 500 -> 425", (await bal(wallet1.publicKey)) === 425, String(await bal(wallet1.publicKey)));

  // c) chain.getMyTickets
  const mine = await chain.getMyTickets(wallet1.publicKey.toBase58());
  record("c) chain.getMyTickets", mine.length === 1 && mine[0].section === "101" && mine[0].row === "C", JSON.stringify(mine.map((t) => [t.eventId === eventPda.toBase58(), t.seatLabel, t.listed])));

  // d) resell above cap -> AboveResaleCap -> friendly message
  try {
    await relay(relayer, await P.listResale(ctx(wallet1), { ticketMint: mint, priceUsd: 200 }), wallet1);
    record("d) over-cap listing rejected", false, "transaction succeeded");
  } catch (err) {
    const f = friendlyError(err, { resaleCapUsd: 120 });
    record("d) over-cap listing rejected", f.name === "AboveResaleCap", f.message);
  }

  // e) list under cap ($110), buyer 2 swaps
  record("e) listResale $110", true, await relay(relayer, await P.listResale(ctx(wallet1), { ticketMint: mint, priceUsd: 110 }), wallet1));
  const listings = await chain.getListingsForEvent(eventPda.toBase58());
  record("   chain.getListingsForEvent", listings.length === 1 && listings[0].priceUsd === 110 && listings[0].tier === 1, JSON.stringify(listings.map((l) => [l.tier, l.priceUsd, l.seat])));
  const before = { w1: await bal(wallet1.publicKey), org: await bal(organizer.publicKey), tre: await bal(treasury.publicKey) };
  record("e) swapResale by wallet2", true, await relay(relayer, await P.swapResale(ctx(wallet2), { ticketMint: mint }), wallet2));
  const after = { w1: await bal(wallet1.publicKey), org: await bal(organizer.publicKey), tre: await bal(treasury.publicKey), w2: await bal(wallet2.publicKey) };
  // $110: royalty 5% = 5.50, fee 3% = 3.30, seller 101.20
  const splitOk = +(after.w1 - before.w1).toFixed(2) === 101.2 && +(after.org - before.org).toFixed(2) === 5.5 && +(after.tre - before.tre).toFixed(2) === 3.3 && after.w2 === 390;
  record("   swap split (seller +101.20, royalty +5.50, fee +3.30)", splitOk, JSON.stringify({ seller: after.w1 - before.w1, royalty: after.org - before.org, fee: after.tre - before.tre, buyer: after.w2 }));
  const w2t = await chain.getMyTickets(wallet2.publicKey.toBase58());
  record("   ticket now with wallet2", w2t.length === 1 && w2t[0].id === mint.toBase58(), String(w2t.length));

  // listResale + cancelListing round trip (wallet2)
  await relay(relayer, await P.listResale(ctx(wallet2), { ticketMint: mint, priceUsd: 100 }), wallet2);
  record("   cancelListing", true, await relay(relayer, await P.cancelListing(ctx(wallet2), { ticketMint: mint }), wallet2));

  // f) escrow: list ($90, bond $9, 3 s windows), fund, let ship window pass, claim refund
  const listed = await P.createEscrowListing(ctx(sam), { priceUsd: 90, bondUsd: 9, shipWindowSecs: 3, confirmWindowSecs: 3 });
  const escrow = listed.address!;
  record("f) createEscrowListing", true, await relay(relayer, listed, sam));
  record("f) fundEscrow", true, await relay(relayer, await P.fundEscrow(ctx(eve), { escrow }), eve));
  const order = await chain.getEscrowOrder(escrow.toBase58());
  record("   chain.getEscrowOrder state", order?.state === "HELD", String(order?.state));
  try {
    await relay(relayer, await P.refundExpired(ctx(eve), { escrow }), eve);
    record("   early refund rejected", false, "succeeded");
  } catch (err) {
    const f = friendlyError(err, { action: "refund" });
    record("   early refund rejected", f.name === "DeadlineNotReached", f.message);
  }
  const e = await program.account.escrowOrder.fetch(escrow);
  await waitPast(Number(e.shipDeadline.toString()));
  const eveBefore = await bal(eve.publicKey);
  record("f) refundExpired", true, await relay(relayer, await P.refundExpired(ctx(eve), { escrow }), eve));
  const eveAfter = await bal(eve.publicKey);
  record("   buyer refunded price + bond (+99)", eveAfter - eveBefore === 99, `${eveBefore} -> ${eveAfter}`);
  record("   chain.getEscrowOrder state", (await chain.getEscrowOrder(escrow.toBase58()))?.state === "REFUNDED", "REFUNDED");

  // Other builders: markSent + confirmReceipt, markSent + releaseExpired, openDispute, standing order open/close
  const esc2 = await P.createEscrowListing(ctx(sam), { priceUsd: 20, bondUsd: 2, shipWindowSecs: 60, confirmWindowSecs: 60 });
  await relay(relayer, esc2, sam);
  await relay(relayer, await P.fundEscrow(ctx(eve), { escrow: esc2.address! }), eve);
  record("   markSent", true, await relay(relayer, await P.markSent(ctx(sam), { escrow: esc2.address! }), sam));
  record("   confirmReceipt", true, await relay(relayer, await P.confirmReceipt(ctx(eve), { escrow: esc2.address! }), eve));
  const esc3 = await P.createEscrowListing(ctx(sam), { priceUsd: 10, bondUsd: 1, shipWindowSecs: 60, confirmWindowSecs: 3 });
  await relay(relayer, esc3, sam);
  await relay(relayer, await P.fundEscrow(ctx(eve), { escrow: esc3.address! }), eve);
  await relay(relayer, await P.markSent(ctx(sam), { escrow: esc3.address! }), sam);
  await waitPast(Number((await program.account.escrowOrder.fetch(esc3.address!)).confirmDeadline.toString()));
  record("   releaseExpired", true, await relay(relayer, await P.releaseExpired(ctx(eve), { escrow: esc3.address! }), eve));
  const esc4 = await P.createEscrowListing(ctx(sam), { priceUsd: 10, bondUsd: 1, shipWindowSecs: 60, confirmWindowSecs: 60 });
  await relay(relayer, esc4, sam);
  await relay(relayer, await P.fundEscrow(ctx(eve), { escrow: esc4.address! }), eve);
  record("   openDispute", true, await relay(relayer, await P.openDispute(ctx(eve), { escrow: esc4.address! }), eve));
  const so = await P.openStandingOrder(ctx(wallet2), { event: eventPda, maxPriceUsd: 90, quantity: 2, deadlineSecs: 600 });
  record("   openStandingOrder", true, await relay(relayer, so, wallet2));
  const sos = await chain.getMyStandingOrders(wallet2.publicKey.toBase58());
  record("   chain.getMyStandingOrders", sos.length === 1 && sos[0].status === "OPEN" && sos[0].budgetUsd === 180, JSON.stringify(sos.map((s) => [s.status, s.budgetUsd])));
  record("   closeStandingOrder", true, await relay(relayer, await P.closeStandingOrder(ctx(wallet2), { standingOrder: so.address! }), wallet2));
  const sales = await chain.getMyEscrowSales(sam.publicKey.toBase58());
  record("   chain.getMyEscrowSales", sales.length === 4, JSON.stringify(sales.map((s) => s.state)));

  // Relayer policy: things it must refuse
  const { blockhash } = await connection.getLatestBlockhash();
  const mk = (payer: PublicKey, ixs: any[]) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const drain = mk(relayer.publicKey, [SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: wallet1.publicKey, lamports: LAMPORTS_PER_SOL })]);
  let v = checkRelayTx(drain, relayer.publicKey, program.programId);
  record("policy: refuses System transfer from relayer", !v.ok, v.ok ? "accepted!" : v.reason);
  const notRelayer = mk(wallet1.publicKey, [SystemProgram.transfer({ fromPubkey: wallet1.publicKey, toPubkey: wallet2.publicKey, lamports: 1 })]);
  v = checkRelayTx(notRelayer, relayer.publicKey, program.programId);
  record("policy: refuses fee payer != relayer", !v.ok, v.ok ? "accepted!" : v.reason);
  const memo = mk(relayer.publicKey, [{ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from("hi") }]);
  v = checkRelayTx(memo, relayer.publicKey, program.programId);
  record("policy: refuses non-allowlisted program", !v.ok, v.ok ? "accepted!" : v.reason);
  const unsigned = await P.markSent(ctx(sam), { escrow: esc4.address! });
  v = checkRelayTx(unsigned.tx, relayer.publicKey, program.programId);
  record("policy: refuses tx the user hasn't signed", !v.ok, v.ok ? "accepted!" : v.reason);

  // Users never needed SOL
  const sol = await Promise.all(Object.entries(users).map(async ([n, k]) => [n, await connection.getBalance(k.publicKey)] as const));
  record("relayer paid every fee: all users still hold 0 SOL", sol.every(([, b]) => b === 0), JSON.stringify(Object.fromEntries(sol)));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("CRASH", err, err?.logs);
  process.exit(1);
});
