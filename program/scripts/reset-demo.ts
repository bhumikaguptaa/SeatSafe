// Restocks devnet with FRESH demo data on Battle of the Bands. Not idempotent: every run creates new
// accounts, so use it before each demo (or after a rehearsal used up the previous listings).
//
//   cd program && anchor run reset-demo --provider.cluster devnet
//   Faster RPC: anchor run reset-demo --provider.cluster https://<your-devnet-endpoint>
//
// Seller = ../.keys/seed-seller.json (signs; needs 10 USDC: the $10 ticket; the escrow listing has bond 0).
// Payer  = deployer (ANCHOR_WALLET): pays every fee and rent.
// 1. Buys 1 primary ticket ($10)               -> new ticket mint, stored with a stadium seat code
//    (e.g. "WL R5 S4", varied per run) so the seat map shows it on a real row
// 1b. Tries to list it at $50 (simulation only)  -> the program rejects it (AboveResaleCap). If APP_URL is set,
//    the rejection is reported to APP_URL/api/stats so the Discover ticker's "scalpers blocked" counts it.
// 2. Lists it for resale at a fair price ≤ the $15 cap (varies $12–$15 per run) -> new listing PDA
// 3. Creates an outside-ticket escrow listing  -> new escrow PDA (order_id = Date.now())
//    $20, bond 0 (the program only needs price > 0 and windows > 0), 60-second ship/confirm windows
// 4. Adds the escrow's seat to ../app/lib/event-meta.json (commit it so Vercel shows the seat).
// Every tx: fresh blockhash, "confirmed", 60 s timeout, one retry. Never prints secret keys.

import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Signer, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import idl from "../target/idl/seatsafe.json";
import { Seatsafe } from "../target/types/seatsafe";

const EVENT = new PublicKey("EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE"); // Battle of the Bands: $10, cap $15
const CAP = 15;
const OVER_CAP = 50;
const RESALE_PRICES = [14, 12, 15, 13]; // all ≤ the cap; one per run (by the event's sold count)
const ESCROW = { price: 20, bond: 0, windowSecs: 60, seat: "Sec 112 Row 8 Seat 5 (outside ticket)" };
const APP_URL = process.env.APP_URL; // e.g. https://seat-safe-chi.vercel.app (set by demo-prep)
const SELLER_FILE = path.resolve(__dirname, "../../.keys/seed-seller.json");
const META_FILE = path.resolve(__dirname, "../../app/lib/event-meta.json");
const TIMEOUT_MS = 60_000;

const USDC = (n: number) => new BN(Math.round(n * 1_000_000));
const u32 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 4);
const u64 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 8);
const cu = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })];
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`timeout after 60s: ${what}`)), TIMEOUT_MS))),
  ]);
}

/** Fresh blockhash, confirm at "confirmed" within 60 s, one retry unless the first attempt landed. */
async function send(conn: Connection, payer: anchor.Wallet, ixs: TransactionInstruction[], signers: Signer[], label: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { blockhash, lastValidBlockHeight } = await withTimeout(conn.getLatestBlockhash("confirmed"), `${label}: blockhash`);
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.partialSign(...signers);
    const signed = await payer.signTransaction(tx);
    const sig = await withTimeout(conn.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 }), `${label}: send`);
    log(`  ${label}: sent (attempt ${attempt}) ${sig}`);
    try {
      const res = await withTimeout(conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed"), `${label}: confirm`);
      if (res.value.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(res.value.err)} (tx ${sig})`);
      log(`  ${label}: confirmed  ${explorer(sig)}`);
      return sig;
    } catch (e) {
      const msg = (e as Error).message;
      if (!/timeout|expired|block height exceeded/i.test(msg)) throw e;
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st && !st.err && st.confirmationStatus) return sig;
      if (attempt === 2) throw new Error(`${label}: not confirmed after 2 attempts (last tx ${sig}): ${msg}`);
      log(`  ${label}: ${msg}; retrying once with a new blockhash`);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const env = anchor.AnchorProvider.env();
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? env.connection.rpcEndpoint;
  const conn = new Connection(rpcUrl, { commitment: "confirmed", confirmTransactionInitialTimeout: TIMEOUT_MS });
  const provider = new anchor.AnchorProvider(conn, env.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<Seatsafe>(idl as Seatsafe, provider);
  const wallet = provider.wallet as anchor.Wallet;
  const deployer = wallet.publicKey;
  const pid = program.programId;
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];

  log("Connecting to", new URL(rpcUrl).host); // host only: provider URLs can embed an API key
  const config = await withTimeout(program.account.config.fetch(pda(Buffer.from("config"))), "fetch Config");
  const usdcMint = config.usdcMint;
  const usdcAta = (o: PublicKey) => getAssociatedTokenAddressSync(usdcMint, o, true, TOKEN_PROGRAM_ID);
  const ticketAta = (m: PublicKey, o: PublicKey) => getAssociatedTokenAddressSync(m, o, true, TOKEN_2022_PROGRAM_ID);
  const seller = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(SELLER_FILE, "utf8"))));

  console.log("Program ID :", pid.toBase58());
  console.log("Payer      :", deployer.toBase58(), "(deployer)");
  console.log("Seller     :", seller.publicKey.toBase58());
  console.log("Event      :", EVENT.toBase58(), "(Battle of the Bands)");

  const needed = 10 + ESCROW.bond;
  const have = Number((await getAccount(conn, usdcAta(seller.publicKey), "confirmed").catch(() => ({ amount: BigInt(0) }))).amount) / 1e6;
  log(`Seller USDC: ${have} (needs ${needed})`);
  if (have < needed) {
    console.log(`\nFund the seller with ${Math.ceil(needed - have)}+ devnet USDC at https://faucet.circle.com (Solana devnet):\n  ${seller.publicKey.toBase58()}\nthen re-run.`);
    process.exit(1);
  }

  // 1. Buy a primary ticket
  log("Step 1: buy primary ticket");
  const ev = await program.account.event.fetch(EVENT);
  const mint = pda(Buffer.from("ticket_mint"), EVENT.toBuffer(), u32(ev.sold));
  // Stadium seat code (lib/stadium-map.ts format), varied per run so the market shows different rows.
  const STANDS = ["WL", "EL", "N", "S", "NE", "SW"];
  const seat = `${STANDS[ev.sold % STANDS.length]} R${3 + (ev.sold % 9)} S${2 + ((ev.sold * 5) % 7)}`;
  const RESALE_PRICE = RESALE_PRICES[ev.sold % RESALE_PRICES.length];
  const buySig = await send(conn, wallet, [...cu, await program.methods
    .buyPrimary(seat)
    .accountsPartial({
      payer: deployer, buyer: seller.publicKey, event: EVENT, organizer: ev.organizer, treasury: config.treasury,
      usdcMint, buyerUsdc: usdcAta(seller.publicKey), ticketMint: mint, buyerTicketAccount: ticketAta(mint, seller.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID, ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction()], [seller], `buy_primary ${seat}`);

  const listing = pda(Buffer.from("listing"), mint.toBuffer());
  const listAccounts = {
    payer: deployer, seller: seller.publicKey, ticketMint: mint, event: EVENT,
    sellerTicketAccount: ticketAta(mint, seller.publicKey), listing,
    listingVault: ticketAta(mint, listing), ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
  };

  // 1b. Above-cap attempt: simulated (nothing lands, no fee); the program must reject it.
  log(`Step 1b: try to list at $${OVER_CAP} (cap $${CAP})`);
  {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: deployer, blockhash, lastValidBlockHeight: 0 }).add(...cu, await program.methods.listResale(USDC(OVER_CAP)).accountsPartial(listAccounts).instruction());
    const sim = await conn.simulateTransaction(tx);
    const rejected = (sim.value.logs ?? []).some((l) => /AboveResaleCap/.test(l));
    log(rejected ? "  rejected by the program: AboveResaleCap (as expected)" : `  unexpected: ${JSON.stringify(sim.value.err)}`);
    if (rejected && APP_URL) {
      const r = await fetch(`${APP_URL}/api/stats`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: EVENT.toBase58(), priceUsd: OVER_CAP, capUsd: CAP, wallet: seller.publicKey.toBase58() }),
      }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
      log("  reported to the ticker:", JSON.stringify(r));
    }
  }

  // 2. List it at a fair price
  log("Step 2: list for resale");
  const listSig = await send(conn, wallet, [...cu, await program.methods
    .listResale(USDC(RESALE_PRICE))
    .accountsPartial(listAccounts)
    .instruction()], [seller], `list_resale $${RESALE_PRICE}`);

  // 3. New escrow listing (timestamp order_id -> new PDA each run)
  log("Step 3: escrow listing");
  const orderId = Date.now();
  const escrow = pda(Buffer.from("escrow"), seller.publicKey.toBuffer(), u64(orderId));
  const escrowSig = await send(conn, wallet, [await program.methods
    .createEscrowListing(new BN(orderId), USDC(ESCROW.price), USDC(ESCROW.bond), new BN(ESCROW.windowSecs), new BN(ESCROW.windowSecs))
    .accountsPartial({
      payer: deployer, seller: seller.publicKey, escrow, usdcMint,
      sellerUsdc: usdcAta(seller.publicKey), escrowVault: usdcAta(escrow), tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction()], [seller], "create_escrow_listing");

  // 4. Escrow seat for the app
  const meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  meta.escrows = meta.escrows ?? {};
  meta.escrows[escrow.toBase58()] = { eventId: EVENT.toBase58(), seat: ESCROW.seat, sellerName: "Seed seller" };
  fs.writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  log("Wrote", path.relative(process.cwd(), META_FILE));

  console.log("\nDone. Fresh demo data:");
  console.log({
    event: EVENT.toBase58(),
    ticketMint: mint.toBase58(),
    seat,
    resaleListing: listing.toBase58(),
    resalePrice: `$${RESALE_PRICE}`,
    escrow: escrow.toBase58(),
    escrowOrderId: orderId,
    escrowTerms: `$${ESCROW.price}, bond $${ESCROW.bond}, ${ESCROW.windowSecs}s windows`,
    signatures: { buy_primary: buySig, list_resale: listSig, create_escrow_listing: escrowSig },
    orderPage: `/orders/${escrow.toBase58()}`,
  });
  console.log(`Seller USDC left: ${(have - needed).toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
