// Seeds devnet with demo data. Idempotent: safe to re-run; each step checks what already exists.
//
//   cd program && anchor run seed-devnet --provider.cluster devnet
//
// Payer     = deployer (ANCHOR_WALLET, default ~/.config/solana/id.json): pays every fee and rent.
// Organizer = ../.keys/seed-organizer.json (created if missing; git-ignored). Not the deployer: on
//             devnet the Config treasury IS the deployer, and organizer == treasury makes buy_primary
//             fail (same USDC account twice -> ConstraintDuplicateMutableAccount, see docs/program.md).
// Seller    = ../.keys/seed-seller.json (created if missing; git-ignored). Needs devnet USDC.
//
// 1. Three events (fixed event_ids under the organizer, so re-runs find them):
//      "Neon Harbor: Midnight Tides Tour"   $75, cap $120, royalty 5%
//      "UT vs. A&M: Rivalry Game"            $85, cap $130, royalty 3%
//      "Battle of the Bands: Dorm Edition"   $10, cap $15,  royalty 0%
// 2. The seller buys 2 Neon Harbor tickets. Funds the seller with 0.2 SOL from the deployer, and with
//    USDC if the deployer has devnet USDC; otherwise prints the seller address and stops so you can
//    fund it at https://faucet.circle.com (Solana devnet), then re-run.
// 3. Lists one of them for resale at $110 (under the cap).
// 4. One outside-ticket escrow listing for the UT game: $90, bond $9, 60-second windows.
// 5. Writes ../app/lib/event-meta.json (display data keyed by event PDA; escrow seat keyed by escrow PDA).
// 6. Prints every address. Never prints secret keys.
//
// The over-cap ($200) attempt is NOT seeded: it's done live in the demo from /tickets -> Resell.

import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
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
    },
  },
];

const RESALE_PRICE = 110;
const ESCROW = { orderId: 2001, price: 90, bond: 9, windowSecs: 60, seat: "Sec 112 Row 28 Seat 5" };
const SELLER_SOL = 0.2;
const TICKETS_TO_BUY = 2;

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
  const provider = new anchor.AnchorProvider(new Connection(env.connection.rpcEndpoint, "confirmed"), env.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program<Seatsafe>(idl as Seatsafe, provider);
  const conn = provider.connection;
  const deployer = provider.wallet.publicKey;
  const pid = program.programId;
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];

  const configPda = pda(Buffer.from("config"));
  const config = await program.account.config.fetch(configPda);
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
  console.log("Cluster    :", conn.rpcEndpoint);
  const organizer = loadOrCreateKeypair(ORGANIZER_FILE);
  if (organizer.publicKey.equals(config.treasury)) throw new Error("Organizer must differ from the Config treasury");
  console.log("Payer      :", deployer.toBase58(), "(deployer)");
  console.log("Organizer  :", organizer.publicKey.toBase58());
  console.log("USDC mint  :", usdcMint.toBase58());

  // ---- 1. Events -----------------------------------------------------------------------------
  const eventPdas: PublicKey[] = [];
  for (const e of EVENTS) {
    const ev = pda(Buffer.from("event"), organizer.publicKey.toBuffer(), u64(e.eventId));
    eventPdas.push(ev);
    if (await conn.getAccountInfo(ev)) {
      console.log(`Event exists : ${e.meta.title} -> ${ev.toBase58()}`);
      continue;
    }
    const sig = await program.methods
      .createEvent(new BN(e.eventId), USDC(e.price), e.supply, USDC(e.cap), e.royaltyBps, new BN(Math.floor(new Date(e.startsAt).getTime() / 1000)))
      .accountsPartial({ payer: deployer, organizer: organizer.publicKey, event: ev })
      .signers([organizer])
      .rpc({ commitment: "confirmed" });
    console.log(`Event created: ${e.meta.title} -> ${ev.toBase58()}  tx ${sig}`);
  }
  const [neon, utGame] = eventPdas;

  // ---- 5 (early). Display data, so the app shows titles even if we stop below -----------------
  const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf8")) : {};
  meta.events = meta.events ?? {};
  meta.escrows = meta.escrows ?? {};
  EVENTS.forEach((e, i) => (meta.events[eventPdas[i].toBase58()] = e.meta));
  const writeMeta = () => fs.writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  writeMeta();
  console.log("Wrote        :", path.relative(process.cwd(), META_FILE));

  // ---- 2. Seller wallet + funding ---------------------------------------------------------------
  const seller = loadOrCreateKeypair(SELLER_FILE);
  console.log("Seller       :", seller.publicKey.toBase58());

  const sol = await conn.getBalance(seller.publicKey);
  if (sol < (SELLER_SOL / 2) * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: deployer, toPubkey: seller.publicKey, lamports: SELLER_SOL * LAMPORTS_PER_SOL }),
    );
    const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    console.log(`Funded seller with ${SELLER_SOL} SOL  tx ${sig}`);
  }

  // How much USDC the remaining steps need.
  const records = await program.account.ticketRecord.all([{ memcmp: { offset: 8, bytes: neon.toBase58() } }]);
  const mine = records.filter((r) => r.account.originalBuyer.equals(seller.publicKey));
  const toBuy = Math.max(0, TICKETS_TO_BUY - mine.length);
  const escrowPda = pda(Buffer.from("escrow"), seller.publicKey.toBuffer(), u64(ESCROW.orderId));
  const escrowExists = !!(await conn.getAccountInfo(escrowPda));
  const needed = toBuy * EVENTS[0].price + (escrowExists ? 0 : ESCROW.bond);
  const have = await usdcBalance(seller.publicKey);

  if (have < needed) {
    const missing = Math.ceil((needed - have) * 100) / 100;
    const deployerUsdc = await usdcBalance(deployer);
    if (deployerUsdc >= missing) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(deployer, usdcAta(seller.publicKey), seller.publicKey, usdcMint, TOKEN_PROGRAM_ID),
        createTransferCheckedInstruction(usdcAta(deployer), usdcMint, usdcAta(seller.publicKey), deployer, BigInt(Math.round(missing * 1e6)), 6, [], TOKEN_PROGRAM_ID),
      );
      const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
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
  const mints = mine.map((r) => r.account.mint);
  for (let i = 0; i < toBuy; i++) {
    const ev = await program.account.event.fetch(neon);
    const mint = pda(Buffer.from("ticket_mint"), neon.toBuffer(), u32(ev.sold));
    const seat = `Sec 101 Row C Seat ${12 + mints.length}`;
    const sig = await program.methods
      .buyPrimary(seat)
      .accountsPartial({
        payer: deployer, buyer: seller.publicKey, event: neon, organizer: ev.organizer, treasury: config.treasury,
        usdcMint, buyerUsdc: usdcAta(seller.publicKey), ticketMint: mint,
        buyerTicketAccount: ticketAta(mint, seller.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID, ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .preInstructions(cu)
      .signers([seller])
      .rpc({ commitment: "confirmed" });
    mints.push(mint);
    console.log(`Bought ticket: ${seat} -> mint ${mint.toBase58()}  tx ${sig}`);
  }
  mints.forEach((m) => console.log("Seller ticket:", m.toBase58()));

  // ---- 3. Resale listing at $110 ------------------------------------------------------------------
  const listings = await program.account.listing.all([{ memcmp: { offset: 8, bytes: seller.publicKey.toBase58() } }]);
  if (listings.some((l) => l.account.event.equals(neon))) {
    listings.forEach((l) => console.log(`Listing exists: ${l.publicKey.toBase58()} at $${l.account.price.toNumber() / 1e6}`));
  } else {
    const mint = mints[0];
    const listing = pda(Buffer.from("listing"), mint.toBuffer());
    const sig = await program.methods
      .listResale(USDC(RESALE_PRICE))
      .accountsPartial({
        payer: deployer, seller: seller.publicKey, ticketMint: mint, event: neon,
        sellerTicketAccount: ticketAta(mint, seller.publicKey), listing,
        listingVault: ticketAta(mint, listing), ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .preInstructions(cu)
      .signers([seller])
      .rpc({ commitment: "confirmed" });
    console.log(`Listed for resale at $${RESALE_PRICE}: ${listing.toBase58()}  tx ${sig}`);
  }

  // ---- 4. Outside-ticket escrow listing --------------------------------------------------------
  if (escrowExists) {
    console.log("Escrow exists:", escrowPda.toBase58());
  } else {
    const sig = await program.methods
      .createEscrowListing(new BN(ESCROW.orderId), USDC(ESCROW.price), USDC(ESCROW.bond), new BN(ESCROW.windowSecs), new BN(ESCROW.windowSecs))
      .accountsPartial({
        payer: deployer, seller: seller.publicKey, escrow: escrowPda, usdcMint,
        sellerUsdc: usdcAta(seller.publicKey), escrowVault: usdcAta(escrowPda), tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc({ commitment: "confirmed" });
    console.log(`Escrow listing ($${ESCROW.price}, bond $${ESCROW.bond}, ${ESCROW.windowSecs}s windows): ${escrowPda.toBase58()}  tx ${sig}`);
  }
  meta.escrows[escrowPda.toBase58()] = { eventId: utGame.toBase58(), seat: ESCROW.seat, sellerName: "Seed seller" };
  writeMeta();

  console.log("\nDone. Addresses:");
  console.log({
    config: configPda.toBase58(),
    organizer: organizer.publicKey.toBase58(),
    events: Object.fromEntries(EVENTS.map((e, i) => [e.meta.title, eventPdas[i].toBase58()])),
    seller: seller.publicKey.toBase58(),
    sellerTickets: mints.map((m) => m.toBase58()),
    escrow: escrowPda.toBase58(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
