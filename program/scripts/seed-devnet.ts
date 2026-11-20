// Seeds devnet with demo data. Idempotent: safe to re-run; each step checks what already exists.
//
//   cd program && anchor run seed-devnet --provider.cluster devnet
//   Slow/flaky public RPC? Use your own devnet endpoint (e.g. QuickNode):
//   anchor run seed-devnet --provider.cluster https://<your-devnet-endpoint>
//   (anchor run exports that URL as ANCHOR_PROVIDER_URL, which this script reads.)
//
// Every step and transaction is logged with its signature. Each transaction gets a fresh
// blockhash, is confirmed at "confirmed", waits at most 60 s, and is retried once on timeout.
//
// Payer     = deployer (ANCHOR_WALLET, default ~/.config/solana/id.json): pays every fee and rent.
// Organizer = ../.keys/seed-organizer.json (created if missing; git-ignored). Not the deployer: on
//             devnet the Config treasury IS the deployer, and organizer == treasury makes buy_primary
//             fail (same USDC account twice -> ConstraintDuplicateMutableAccount, see docs/program.md).
// Seller    = ../.keys/seed-seller.json (created if missing; git-ignored). Needs devnet USDC.
//
// 1. Eight events (fixed event_ids under the organizer, so re-runs find them):
//      "Neon Harbor: Midnight Tides Tour"   $75, cap $120, royalty 5%
//      "UT vs. A&M: Rivalry Game"            $85, cap $130, royalty 3%
//      "Battle of the Bands: Dorm Edition"   $10, cap $15,  royalty 0%
//      "Concert"                             $65, cap $110, royalty 6%
//      "Football Stadium"                    $95, cap $160, royalty 3%
//      "Opera"                               $45, cap $70,  royalty 5%
//      "Soccer Stadium"                      $40, cap $65,  royalty 4%
//      "Theatre"                             $15, cap $25,  royalty 0%
//    meta.imageUrl points at a photo in app/public/events/.
// Amounts are kept small so the Circle faucet covers them: everything uses the $10 campus event.
// 2. The seller buys 2 Battle of the Bands tickets ($10 each). Funds the seller with 0.2 SOL from the deployer, and with
//    USDC if the deployer has devnet USDC; otherwise prints the seller address and stops so you can
//    fund it at https://faucet.circle.com (Solana devnet), then re-run.
// 3. Lists one of them for resale at $14 (under the $15 cap).
// 4. One outside-ticket escrow listing for the same event: $20, bond $2, 60-second windows.
//    Seller needs 22 USDC in total (2 x $10 + $2 bond).
// 5. Writes ../app/lib/event-meta.json (display data keyed by event PDA; escrow seat keyed by escrow PDA).
// 6. Prints every address. Never prints secret keys.
//
// The over-cap ($200) attempt is NOT seeded: it's done live in the demo from /tickets -> Resell.

import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  Signer,
  TransactionInstruction,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import idl from "../target/idl/seatsafe.json";
import { Seatsafe } from "../target/types/seatsafe";

const USDC = (n: number) => new BN(Math.round(n * 1_000_000));
const u64 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 8);
const u32 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 4);
const cu = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })];

const SELLER_FILE = path.resolve(__dirname, "../../.keys/seed-seller.json");
const ORGANIZER_FILE = path.resolve(__dirname, "../../.keys/seed-organizer.json");
const META_FILE = path.resolve(__dirname, "../../app/lib/event-meta.json");

const EVENTS = [
  {
    eventId: 1001,
    price: 75, cap: 120, royaltyBps: 500, supply: 100,
    startsAt: "2026-11-21T20:00:00-06:00",
    meta: {
      title: "Neon Harbor: Midnight Tides Tour", category: "concert",
      venue: "Riverside Amphitheater", city: "Austin, TX", organizerName: "Neon Harbor",
      imageGradient: "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900",
      imageUrl: "/events/concert.jpg",
    },
  },
  {
    eventId: 1002,
    price: 85, cap: 130, royaltyBps: 300, supply: 200,
    startsAt: "2026-11-28T18:30:00-06:00",
    meta: {
      title: "UT vs. A&M: Rivalry Game", category: "sports",
      venue: "Memorial Stadium", city: "Austin, TX", organizerName: "UT Athletics",
      imageGradient: "bg-gradient-to-br from-orange-600 via-amber-700 to-red-950",
      imageUrl: "/events/football_stadium.jpg",
    },
  },
  {
    eventId: 1003,
    price: 10, cap: 15, royaltyBps: 0, supply: 150,
    startsAt: "2026-12-15T18:00:00-06:00",
    meta: {
      title: "Battle of the Bands: Dorm Edition", category: "campus",
      venue: "West Quad Lawn", city: "Austin, TX", organizerName: "Campus Radio KSRF",
      imageGradient: "bg-gradient-to-br from-yellow-400 via-lime-600 to-teal-900",
      imageUrl: "/events/concert.jpg",
    },
  },
  {
    eventId: 1004,
    price: 65, cap: 110, royaltyBps: 600, supply: 300,
    startsAt: "2026-12-19T20:00:00-06:00",
    meta: {
      title: "Concert", category: "concert",
      venue: "Lakeshore Festival Grounds", city: "Austin, TX", organizerName: "Lakeshore Live",
      imageGradient: "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900",
      imageUrl: "/events/concert.jpg",
    },
  },
  {
    eventId: 1005,
    price: 95, cap: 160, royaltyBps: 300, supply: 250,
    startsAt: "2027-01-09T19:00:00-06:00",
    meta: {
      title: "Football Stadium", category: "sports",
      venue: "Capital City Stadium", city: "Austin, TX", organizerName: "Capital City Athletics",
      imageGradient: "bg-gradient-to-br from-orange-600 via-amber-700 to-red-950",
      imageUrl: "/events/football_stadium.jpg",
    },
  },
  {
    eventId: 1006,
    price: 45, cap: 70, royaltyBps: 500, supply: 120,
    startsAt: "2026-12-11T19:30:00-06:00",
    meta: {
      title: "Opera", category: "concert",
      venue: "Meridian Symphony Hall", city: "Austin, TX", organizerName: "Meridian Philharmonic",
      imageGradient: "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900",
      imageUrl: "/events/opera.jpg",
    },
  },
  {
    eventId: 1007,
    price: 40, cap: 65, royaltyBps: 400, supply: 200,
    startsAt: "2027-01-16T17:00:00-06:00",
    meta: {
      title: "Soccer Stadium", category: "sports",
      venue: "Eastside Soccer Park", city: "Austin, TX", organizerName: "Austin United FC",
      imageGradient: "bg-gradient-to-br from-emerald-500 via-green-700 to-slate-900",
      imageUrl: "/events/soccer_stadium.jpg",
    },
  },
  {
    eventId: 1008,
    price: 15, cap: 25, royaltyBps: 0, supply: 100,
    startsAt: "2026-12-06T19:00:00-06:00",
    meta: {
      title: "Theatre", category: "campus",
      venue: "Old Main Lyric Theatre", city: "Austin, TX", organizerName: "Campus Theatre Guild",
      imageGradient: "bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-950",
      imageUrl: "/events/theatre.jpg",
    },
  },
];

const RESALE_PRICE = 14;
const ESCROW = { orderId: 2001, price: 20, bond: 2, windowSecs: 60, seat: "Lawn GA (outside ticket)" };
/** Index into EVENTS of the event used for the tickets, the resale and the escrow. */
const DEMO_EVENT = 2;
const SELLER_SOL = 0.2;
const TICKETS_TO_BUY = 2;

const CONFIRM_TIMEOUT_MS = 60_000;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/** Rejects if `p` takes longer than `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`timeout after ${ms / 1000}s: ${what}`)), ms))),
  ]);
}

/**
 * Sends instructions with a fresh blockhash, confirms at "confirmed" within 60 s, and retries once
 * (new blockhash) on timeout or an expired blockhash. Before retrying it checks whether the first
 * attempt landed, so nothing runs twice.
 */
async function send(
  conn: Connection,
  payer: anchor.Wallet,
  ixs: TransactionInstruction[],
  signers: Signer[],
  label: string,
): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { blockhash, lastValidBlockHeight } = await withTimeout(
      conn.getLatestBlockhash("confirmed"), CONFIRM_TIMEOUT_MS, `${label}: getLatestBlockhash`);
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    if (signers.length) tx.partialSign(...signers);
    const signed = await payer.signTransaction(tx);
    const sig = await withTimeout(
      conn.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 }),
      CONFIRM_TIMEOUT_MS, `${label}: send`);
    log(`  ${label}: sent (attempt ${attempt}) ${sig}, confirming...`);
    try {
      const res = await withTimeout(
        conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed"),
        CONFIRM_TIMEOUT_MS, `${label}: confirm`);
      if (res.value.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(res.value.err)} (tx ${sig})`);
      log(`  ${label}: confirmed ${sig}`);
      return sig;
    } catch (e) {
      const msg = (e as Error).message;
      if (!/timeout|expired|block height exceeded/i.test(msg)) throw e;
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
        log(`  ${label}: confirmed late ${sig}`);
        return sig;
      }
      if (attempt === 2) throw new Error(`${label}: not confirmed after 2 attempts (last tx ${sig}): ${msg}`);
      log(`  ${label}: ${msg}; retrying once with a new blockhash`);
    }
  }
  throw new Error("unreachable");
}

function loadOrCreateKeypair(file: string): Keypair {
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`Created keypair .keys/${path.basename(file)} (git-ignored)`);
  return kp;
}

async function main() {
  // "confirmed" everywhere: with AnchorProvider.env()'s default ("processed") the public devnet RPC
  // often answers "Blockhash not found" because the blockhash came from a node ahead of the sender.
  const env = anchor.AnchorProvider.env();
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? env.connection.rpcEndpoint;
  const rpc = new Connection(rpcUrl, { commitment: "confirmed", confirmTransactionInitialTimeout: CONFIRM_TIMEOUT_MS });
  const provider = new anchor.AnchorProvider(rpc, env.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program<Seatsafe>(idl as Seatsafe, provider);
  const conn = provider.connection;
  const deployer = provider.wallet.publicKey;
  const pid = program.programId;
  const wallet = provider.wallet as anchor.Wallet;
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];

  // Only the host is logged: provider URLs (QuickNode etc.) embed an API key.
  log("Step 0: connecting to", new URL(rpcUrl).host);
  const version = await withTimeout(conn.getVersion(), CONFIRM_TIMEOUT_MS, "getVersion");
  log("  RPC ok, solana-core", version["solana-core"]);
  const configPda = pda(Buffer.from("config"));
  log("  fetching Config", configPda.toBase58());
  const config = await withTimeout(program.account.config.fetch(configPda), CONFIRM_TIMEOUT_MS, "fetch Config");
  const usdcMint = config.usdcMint;
  const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(usdcMint, owner, true, TOKEN_PROGRAM_ID);
  const ticketAta = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  const usdcBalance = async (owner: PublicKey) => {
    try {
      return Number((await getAccount(conn, usdcAta(owner), "confirmed")).amount) / 1e6;
    } catch {
      return 0;
    }
  };

  console.log("Program ID :", pid.toBase58());
  console.log("Cluster    :", new URL(rpcUrl).host);
  const organizer = loadOrCreateKeypair(ORGANIZER_FILE);
  if (organizer.publicKey.equals(config.treasury)) throw new Error("Organizer must differ from the Config treasury");
  console.log("Payer      :", deployer.toBase58(), "(deployer)");
  console.log("Organizer  :", organizer.publicKey.toBase58());
  console.log("USDC mint  :", usdcMint.toBase58());

  // ---- 1. Events -----------------------------------------------------------------------------
  log("Step 1: events");
  const eventPdas: PublicKey[] = [];
  for (const e of EVENTS) {
    const ev = pda(Buffer.from("event"), organizer.publicKey.toBuffer(), u64(e.eventId));
    eventPdas.push(ev);
    if (await conn.getAccountInfo(ev)) {
      console.log(`Event exists : ${e.meta.title} -> ${ev.toBase58()}`);
      continue;
    }
    const ix = await program.methods
      .createEvent(new BN(e.eventId), USDC(e.price), e.supply, USDC(e.cap), e.royaltyBps, new BN(Math.floor(new Date(e.startsAt).getTime() / 1000)))
      .accountsPartial({ payer: deployer, organizer: organizer.publicKey, event: ev })
      .instruction();
    const sig = await send(conn, wallet, [ix], [organizer], `create_event ${e.eventId}`);
    console.log(`Event created: ${e.meta.title} -> ${ev.toBase58()}  tx ${sig}`);
  }
  const demoEvent = eventPdas[DEMO_EVENT];
  const demoPrice = EVENTS[DEMO_EVENT].price;

  // ---- 5 (early). Display data, so the app shows titles even if we stop below -----------------
  const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf8")) : {};
  meta.events = meta.events ?? {};
  meta.escrows = meta.escrows ?? {};
  EVENTS.forEach((e, i) => (meta.events[eventPdas[i].toBase58()] = e.meta));
  const writeMeta = () => fs.writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  writeMeta();
  console.log("Wrote        :", path.relative(process.cwd(), META_FILE));

  // ---- 2. Seller wallet + funding ---------------------------------------------------------------
  log("Step 2: seller wallet and funding");
  const seller = loadOrCreateKeypair(SELLER_FILE);
  console.log("Seller       :", seller.publicKey.toBase58());

  const sol = await conn.getBalance(seller.publicKey);
  if (sol < (SELLER_SOL / 2) * LAMPORTS_PER_SOL) {
    const sig = await send(conn, wallet,
      [SystemProgram.transfer({ fromPubkey: deployer, toPubkey: seller.publicKey, lamports: SELLER_SOL * LAMPORTS_PER_SOL })],
      [], "fund seller SOL");
    console.log(`Funded seller with ${SELLER_SOL} SOL  tx ${sig}`);
  }

  // How much USDC the remaining steps need.
  log("  seller SOL:", (await conn.getBalance(seller.publicKey)) / LAMPORTS_PER_SOL);
  log("  looking up the seller's existing tickets and escrow");
  const records = await program.account.ticketRecord.all([{ memcmp: { offset: 8, bytes: demoEvent.toBase58() } }]);
  const mine = records.filter((r) => r.account.originalBuyer.equals(seller.publicKey));
  const toBuy = Math.max(0, TICKETS_TO_BUY - mine.length);
  const escrowPda = pda(Buffer.from("escrow"), seller.publicKey.toBuffer(), u64(ESCROW.orderId));
  const escrowExists = !!(await conn.getAccountInfo(escrowPda));
  const needed = toBuy * demoPrice + (escrowExists ? 0 : ESCROW.bond);
  const have = await usdcBalance(seller.publicKey);
  log(`  seller USDC: ${have}, needed: ${needed} (tickets to buy: ${toBuy}, escrow exists: ${escrowExists})`);

  if (have < needed) {
    const missing = Math.ceil((needed - have) * 100) / 100;
    const deployerUsdc = await usdcBalance(deployer);
    if (deployerUsdc >= missing) {
      const sig = await send(conn, wallet, [
        createAssociatedTokenAccountIdempotentInstruction(deployer, usdcAta(seller.publicKey), seller.publicKey, usdcMint, TOKEN_PROGRAM_ID),
        createTransferCheckedInstruction(usdcAta(deployer), usdcMint, usdcAta(seller.publicKey), deployer, BigInt(Math.round(missing * 1e6)), 6, [], TOKEN_PROGRAM_ID),
      ], [], "fund seller USDC");
      console.log(`Sent seller ${missing} USDC from the deployer  tx ${sig}`);
    } else {
      console.log("");
      console.log(`STOP: the seller needs ${needed} devnet USDC (has ${have}); the deployer has ${deployerUsdc}.`);
      console.log("Fund it at https://faucet.circle.com -> Solana -> Devnet, address:");
      console.log(`  ${seller.publicKey.toBase58()}`);
      console.log("(or fund the deployer and re-run). Then re-run: anchor run seed-devnet --provider.cluster devnet");
      return;
    }
  }

  // ---- 2 (cont). Buy primary tickets ------------------------------------------------------------
  log("Step 2b: buy primary tickets");
  const mints = mine.map((r) => r.account.mint);
  for (let i = 0; i < toBuy; i++) {
    const ev = await program.account.event.fetch(demoEvent);
    const mint = pda(Buffer.from("ticket_mint"), demoEvent.toBuffer(), u32(ev.sold));
    const seat = `Lawn GA ${1 + mints.length}`;
    const ix = await program.methods
      .buyPrimary(seat)
      .accountsPartial({
        payer: deployer, buyer: seller.publicKey, event: demoEvent, organizer: ev.organizer, treasury: config.treasury,
        usdcMint, buyerUsdc: usdcAta(seller.publicKey), ticketMint: mint,
        buyerTicketAccount: ticketAta(mint, seller.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID, ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    const sig = await send(conn, wallet, [...cu, ix], [seller], `buy_primary ${seat}`);
    mints.push(mint);
    console.log(`Bought ticket: ${seat} -> mint ${mint.toBase58()}  tx ${sig}`);
  }
  mints.forEach((m) => console.log("Seller ticket:", m.toBase58()));

  // ---- 3. Resale listing at $14  ------------------------------------------------------------------
  log("Step 3: resale listing");
  const listings = await program.account.listing.all([{ memcmp: { offset: 8, bytes: seller.publicKey.toBase58() } }]);
  if (listings.some((l) => l.account.event.equals(demoEvent))) {
    listings.forEach((l) => console.log(`Listing exists: ${l.publicKey.toBase58()} at $${l.account.price.toNumber() / 1e6}`));
  } else {
    const mint = mints[0];
    const listing = pda(Buffer.from("listing"), mint.toBuffer());
    const ix = await program.methods
      .listResale(USDC(RESALE_PRICE))
      .accountsPartial({
        payer: deployer, seller: seller.publicKey, ticketMint: mint, event: demoEvent,
        sellerTicketAccount: ticketAta(mint, seller.publicKey), listing,
        listingVault: ticketAta(mint, listing), ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    const sig = await send(conn, wallet, [...cu, ix], [seller], "list_resale");
    console.log(`Listed for resale at $${RESALE_PRICE}: ${listing.toBase58()}  tx ${sig}`);
  }

  // ---- 4. Outside-ticket escrow listing --------------------------------------------------------
  log("Step 4: escrow listing");
  if (escrowExists) {
    console.log("Escrow exists:", escrowPda.toBase58());
  } else {
    const ix = await program.methods
      .createEscrowListing(new BN(ESCROW.orderId), USDC(ESCROW.price), USDC(ESCROW.bond), new BN(ESCROW.windowSecs), new BN(ESCROW.windowSecs))
      .accountsPartial({
        payer: deployer, seller: seller.publicKey, escrow: escrowPda, usdcMint,
        sellerUsdc: usdcAta(seller.publicKey), escrowVault: usdcAta(escrowPda), tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const sig = await send(conn, wallet, [ix], [seller], "create_escrow_listing");
    console.log(`Escrow listing ($${ESCROW.price}, bond $${ESCROW.bond}, ${ESCROW.windowSecs}s windows): ${escrowPda.toBase58()}  tx ${sig}`);
  }
  log("Step 5: writing event-meta.json");
  meta.escrows[escrowPda.toBase58()] = { eventId: demoEvent.toBase58(), seat: ESCROW.seat, sellerName: "Seed seller" };
  writeMeta();

  console.log("\nDone. Addresses:");
  console.log({
    config: configPda.toBase58(),
    organizer: organizer.publicKey.toBase58(),
    events: Object.fromEntries(EVENTS.map((e, i) => [e.meta.title, eventPdas[i].toBase58()])),
    seller: seller.publicKey.toBase58(),
    sellerTickets: mints.map((m) => m.toBase58()),
    resaleListings: (await program.account.listing.all([{ memcmp: { offset: 8, bytes: seller.publicKey.toBase58() } }]))
      .map((l) => l.publicKey.toBase58()),
    escrow: escrowPda.toBase58(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
