import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { Seatsafe } from "../target/types/seatsafe";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USDC = (n: number) => new BN(Math.round(n * 1_000_000));
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));
const u64 = (n: number | BN) => new BN(n).toArrayLike(Buffer, "le", 8);
const u32 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 4);
const cu = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })];
const WINDOW = 3; // seconds: ship / confirm / dispute windows in tests

async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    const got = e?.error?.errorCode?.code ?? "";
    const text = got || String(e) + (e?.logs ?? []).join("\n");
    assert.include(text, code, `expected ${code}, got: ${String(e).slice(0, 300)}`);
    return;
  }
  assert.fail(`expected ${code} but the transaction succeeded`);
}

describe("seatsafe", () => {
  const env = anchor.AnchorProvider.env();
  const connection = env.connection;
  const workspace = anchor.workspace.seatsafe as Program<Seatsafe>;

  // The relayer pays every fee and every rent. Users hold 0 SOL for the whole suite.
  const relayer = Keypair.generate();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(relayer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program<Seatsafe>(workspace.idl, provider);
  const pid = program.programId;

  const admin = Keypair.generate();
  const arbiter = Keypair.generate();
  const treasury = Keypair.generate();
  const organizer = Keypair.generate();
  const alice = Keypair.generate(); // primary buyer, then reseller
  const bob = Keypair.generate(); // primary buyer, later lists for the agent
  const dave = Keypair.generate(); // resale buyer
  const carol = Keypair.generate(); // standing order owner
  const sam = Keypair.generate(); // Tier 2 escrow seller
  const eve = Keypair.generate(); // Tier 2 escrow buyer
  const usdcAuthority = Keypair.generate();
  let usdcMint: PublicKey;

  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];
  const configPda = pda(Buffer.from("config"));
  const ticketAuthority = pda(Buffer.from("ticket_authority"));
  const eventPda = (org: PublicKey, id: number) =>
    pda(Buffer.from("event"), org.toBuffer(), u64(id));
  const ticketMintPda = (event: PublicKey, sold: number) =>
    pda(Buffer.from("ticket_mint"), event.toBuffer(), u32(sold));
  const listingPda = (mint: PublicKey) => pda(Buffer.from("listing"), mint.toBuffer());
  const escrowPda = (seller: PublicKey, id: number) =>
    pda(Buffer.from("escrow"), seller.toBuffer(), u64(id));
  const standingPda = (owner: PublicKey, id: number) =>
    pda(Buffer.from("standing"), owner.toBuffer(), u64(id));
  const usdcAta = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(usdcMint, owner, true, TOKEN_PROGRAM_ID);
  const ticketAta = (mint: PublicKey, owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  const usdcBal = async (owner: PublicKey) => {
    try {
      return (await getAccount(connection, usdcAta(owner), "confirmed", TOKEN_PROGRAM_ID)).amount;
    } catch {
      return 0n;
    }
  };
  const ticketAcct = (mint: PublicKey, owner: PublicKey) =>
    getAccount(connection, ticketAta(mint, owner), "confirmed", TOKEN_2022_PROGRAM_ID);

  /** Cluster clock (the same Clock sysvar the program reads): unix_timestamp is the i64 at offset 32. */
  async function chainTime(): Promise<number> {
    const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
    return Number(info!.data.readBigInt64LE(32));
  }

  /** Waits until the cluster clock is past `unixTs` (gives up after 60 s). */
  async function waitUntilPast(unixTs: number) {
    const giveUp = Date.now() + 60_000;
    while ((await chainTime()) <= unixTs) {
      if (Date.now() > giveUp) throw new Error(`clock never passed ${unixTs}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const event = eventPda(organizer.publicKey, 1);
  let aliceTicket: PublicKey; // minted to alice, resold to dave
  let bobTicket: PublicKey; // minted to bob, later sold to carol's agent

  async function buyPrimary(buyer: Keypair, ev: PublicKey, seat: string) {
    const sold = (await program.account.event.fetch(ev)).sold;
    const mint = ticketMintPda(ev, sold);
    await program.methods
      .buyPrimary(seat)
      .accountsPartial({
        payer: relayer.publicKey,
        buyer: buyer.publicKey,
        event: ev,
        organizer: organizer.publicKey,
        treasury: treasury.publicKey,
        usdcMint,
        buyerUsdc: usdcAta(buyer.publicKey),
        ticketMint: mint,
        buyerTicketAccount: ticketAta(mint, buyer.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
        ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .preInstructions(cu)
      .signers([buyer])
      .rpc();
    return mint;
  }

  async function listResale(seller: Keypair, mint: PublicKey, price: BN) {
    return program.methods
      .listResale(price)
      .accountsPartial({
        payer: relayer.publicKey,
        seller: seller.publicKey,
        ticketMint: mint,
        event,
        sellerTicketAccount: ticketAta(mint, seller.publicKey),
        listing: listingPda(mint),
        listingVault: ticketAta(mint, listingPda(mint)),
        ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .preInstructions(cu)
      .signers([seller])
      .rpc();
  }

  // -------------------------------------------------------------------------
  before(async () => {
    const sig = await connection.requestAirdrop(relayer.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");

    usdcMint = await createMint(connection, relayer, usdcAuthority.publicKey, null, 6, undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    for (const [kp, amount] of [
      [alice, 500], [bob, 500], [dave, 500], [carol, 500], [sam, 500], [eve, 1000], [organizer, 0],
    ] as [Keypair, number][]) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, relayer, usdcMint, kp.publicKey, false, "confirmed", { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
      if (amount > 0) {
        await mintTo(connection, relayer, usdcMint, ata.address, usdcAuthority, usdc(amount), [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
      }
    }
  });

  // -------------------------------------------------------------------------
  describe("setup", () => {
    it("initializes config", async () => {
      await program.methods
        .initConfig(arbiter.publicKey, treasury.publicKey, 300, new BN(WINDOW))
        .accountsPartial({ payer: relayer.publicKey, admin: admin.publicKey, usdcMint })
        .signers([admin])
        .rpc();
      const c = await program.account.config.fetch(configPda);
      assert.equal(c.feeBps, 300);
      assert.ok(c.arbiter.equals(arbiter.publicKey));
      assert.ok(c.usdcMint.equals(usdcMint));
    });

    it("rejects an event whose resale cap is below face price", async () => {
      await expectError(
        program.methods
          .createEvent(new BN(99), USDC(50), 2, USDC(40), 500, new BN(1_800_000_000))
          .accountsPartial({ payer: relayer.publicKey, organizer: organizer.publicKey, event: eventPda(organizer.publicKey, 99) })
          .signers([organizer])
          .rpc(),
        "InvalidResaleCap"
      );
    });

    it("rejects royalty + fee above 50%", async () => {
      await expectError(
        program.methods
          .createEvent(new BN(98), USDC(50), 2, USDC(100), 4800, new BN(1_800_000_000))
          .accountsPartial({ payer: relayer.publicKey, organizer: organizer.publicKey, event: eventPda(organizer.publicKey, 98) })
          .signers([organizer])
          .rpc(),
        "InvalidRoyalty"
      );
    });

    it("creates an event: $50, supply 2, cap $100, 5% royalty", async () => {
      await program.methods
        .createEvent(new BN(1), USDC(50), 2, USDC(100), 500, new BN(1_800_000_000))
        .accountsPartial({ payer: relayer.publicKey, organizer: organizer.publicKey, event })
        .signers([organizer])
        .rpc();
      const e = await program.account.event.fetch(event);
      assert.equal(e.supply, 2);
      assert.equal(e.sold, 0);
      assert.ok(e.resaleCap.eq(USDC(100)));
    });
  });

  // -------------------------------------------------------------------------
  describe("tier 1: primary sale", () => {
    it("buy_primary splits USDC and mints a frozen ticket to the buyer", async () => {
      const relayerBefore = await connection.getBalance(relayer.publicKey);
      const [orgBefore, aliceBefore] = [await usdcBal(organizer.publicKey), await usdcBal(alice.publicKey)];

      aliceTicket = await buyPrimary(alice, event, "Sec 101 Row C Seat 12");

      assert.equal(await usdcBal(alice.publicKey), aliceBefore - usdc(50));
      assert.equal(await usdcBal(organizer.publicKey), orgBefore + usdc(48.5)); // 50 - 3% fee
      assert.equal(await usdcBal(treasury.publicKey), usdc(1.5));
      const t = await ticketAcct(aliceTicket, alice.publicKey);
      assert.equal(t.amount, 1n);
      assert.isTrue(t.isFrozen, "ticket account must be frozen");
      const rec = await program.account.ticketRecord.fetch(pda(Buffer.from("ticket"), aliceTicket.toBuffer()));
      assert.equal(rec.seat, "Sec 101 Row C Seat 12");
      assert.ok(rec.originalBuyer.equals(alice.publicKey));

      // Relayer paid rent for mint + ATA + record; the buyer holds no SOL at all.
      assert.equal(await connection.getBalance(alice.publicKey), 0);
      assert.isBelow(await connection.getBalance(relayer.publicKey), relayerBefore);
    });

    it("enforces supply (SoldOut)", async () => {
      bobTicket = await buyPrimary(bob, event, "Sec 101 Row C Seat 13");
      assert.equal((await program.account.event.fetch(event)).sold, 2);
      await expectError(buyPrimary(dave, event, "Sec 101 Row C Seat 14"), "SoldOut");
    });

    it("the holder cannot transfer the ticket directly (plain Token-2022 transfer fails)", async () => {
      const bobAta = ticketAta(aliceTicket, bob.publicKey);
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, bobAta, bob.publicKey, aliceTicket, TOKEN_2022_PROGRAM_ID),
        createTransferCheckedInstruction(ticketAta(aliceTicket, alice.publicKey), aliceTicket, bobAta, alice.publicKey, 1, 0, [], TOKEN_2022_PROGRAM_ID)
      );
      try {
        await provider.sendAndConfirm(tx, [alice]);
        assert.fail("peer-to-peer transfer should have failed");
      } catch (e: any) {
        assert.match(String(e) + (e?.logs ?? []).join("\n"), /frozen|0x11/i);
      }
      assert.equal((await ticketAcct(aliceTicket, alice.publicKey)).amount, 1n);
    });
  });

  // -------------------------------------------------------------------------
  describe("tier 1: resale", () => {
    it("rejects a listing above the resale cap (AboveResaleCap)", async () => {
      await expectError(listResale(alice, aliceTicket, USDC(150)), "AboveResaleCap");
    });

    it("lists at the cap or below; ticket moves into the frozen listing vault", async () => {
      await listResale(alice, aliceTicket, USDC(80));
      const vault = await getAccount(connection, ticketAta(aliceTicket, listingPda(aliceTicket)), "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(vault.amount, 1n);
      assert.isTrue(vault.isFrozen);
      assert.equal((await ticketAcct(aliceTicket, alice.publicKey)).amount, 0n);
    });

    it("cancel_listing returns the ticket (frozen) and closes the listing", async () => {
      await program.methods
        .cancelListing()
        .accountsPartial({
          payer: relayer.publicKey,
          seller: alice.publicKey,
          ticketMint: aliceTicket,
          listing: listingPda(aliceTicket),
          listingVault: ticketAta(aliceTicket, listingPda(aliceTicket)),
          sellerTicketAccount: ticketAta(aliceTicket, alice.publicKey),
          ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .preInstructions(cu)
        .signers([alice])
        .rpc();
      const t = await ticketAcct(aliceTicket, alice.publicKey);
      assert.equal(t.amount, 1n);
      assert.isTrue(t.isFrozen);
      assert.isNull(await connection.getAccountInfo(listingPda(aliceTicket)));
      await listResale(alice, aliceTicket, USDC(80)); // relist for the swap
    });

    const swapAccounts = (buyer: Keypair, mint: PublicKey, seller: PublicKey) => ({
      payer: relayer.publicKey,
      buyer: buyer.publicKey,
      ticketMint: mint,
      listing: listingPda(mint),
      event,
      seller,
      organizer: organizer.publicKey,
      treasury: treasury.publicKey,
      usdcMint,
      buyerUsdc: usdcAta(buyer.publicKey),
      listingVault: ticketAta(mint, listingPda(mint)),
      buyerTicketAccount: ticketAta(mint, buyer.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    // buyer == seller makes buyer_usdc and seller_usdc the same account, so Anchor's own
    // duplicate-account check rejects it before the handler's BuyerIsSeller check runs.
    it("rejects buyer == seller", async () => {
      await expectError(
        program.methods.swapResale().accountsPartial(swapAccounts(alice, aliceTicket, alice.publicKey)).preInstructions(cu).signers([alice]).rpc(),
        "ConstraintDuplicateMutableAccount"
      );
    });

    it("swap_resale: exact split and the ticket lands frozen with the buyer", async () => {
      const before = {
        alice: await usdcBal(alice.publicKey),
        dave: await usdcBal(dave.publicKey),
        org: await usdcBal(organizer.publicKey),
        tre: await usdcBal(treasury.publicKey),
      };
      await program.methods.swapResale().accountsPartial(swapAccounts(dave, aliceTicket, alice.publicKey)).preInstructions(cu).signers([dave]).rpc();

      // $80: royalty 5% = $4, fee 3% = $2.40, seller $73.60
      assert.equal(await usdcBal(dave.publicKey), before.dave - usdc(80));
      assert.equal(await usdcBal(alice.publicKey), before.alice + usdc(73.6));
      assert.equal(await usdcBal(organizer.publicKey), before.org + usdc(4));
      assert.equal(await usdcBal(treasury.publicKey), before.tre + usdc(2.4));
      const t = await ticketAcct(aliceTicket, dave.publicKey);
      assert.equal(t.amount, 1n);
      assert.isTrue(t.isFrozen);
      assert.isNull(await connection.getAccountInfo(listingPda(aliceTicket)), "listing closed");
      assert.isNull(await connection.getAccountInfo(ticketAta(aliceTicket, listingPda(aliceTicket))), "vault closed");
    });
  });

  // -------------------------------------------------------------------------
  describe("tier 2: escrow", () => {
    const settle = (id: number, caller: Keypair) => ({
      payer: relayer.publicKey,
      caller: caller.publicKey,
      escrow: escrowPda(sam.publicKey, id),
      seller: sam.publicKey,
      buyer: eve.publicKey,
      treasury: treasury.publicKey,
      usdcMint,
      escrowVault: usdcAta(escrowPda(sam.publicKey, id)),
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const signersFor = (caller: Keypair) => (caller.publicKey.equals(relayer.publicKey) ? [] : [caller]);

    async function list(id: number) {
      await program.methods
        .createEscrowListing(new BN(id), USDC(40), USDC(5), new BN(WINDOW), new BN(WINDOW))
        .accountsPartial({
          payer: relayer.publicKey,
          seller: sam.publicKey,
          escrow: escrowPda(sam.publicKey, id),
          usdcMint,
          sellerUsdc: usdcAta(sam.publicKey),
          escrowVault: usdcAta(escrowPda(sam.publicKey, id)),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([sam])
        .rpc();
    }
    async function fund(id: number) {
      await program.methods
        .fundEscrow()
        .accountsPartial({
          buyer: eve.publicKey,
          escrow: escrowPda(sam.publicKey, id),
          usdcMint,
          buyerUsdc: usdcAta(eve.publicKey),
          escrowVault: usdcAta(escrowPda(sam.publicKey, id)),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([eve])
        .rpc();
    }
    const markSent = (id: number) =>
      program.methods.markSent().accountsPartial({ seller: sam.publicKey, escrow: escrowPda(sam.publicKey, id) }).signers([sam]).rpc();
    const openDispute = (id: number, caller: Keypair) =>
      program.methods.openDispute().accountsPartial({ caller: caller.publicKey, escrow: escrowPda(sam.publicKey, id) }).signers([caller]).rpc();
    const state = async (id: number) =>
      Object.keys((await program.account.escrowOrder.fetch(escrowPda(sam.publicKey, id))).state)[0];

    it("happy path: list (bond) -> fund -> sent -> confirm", async () => {
      const samStart = await usdcBal(sam.publicKey);
      const treStart = await usdcBal(treasury.publicKey);
      await list(1);
      assert.equal(await usdcBal(sam.publicKey), samStart - usdc(5));
      await fund(1);
      assert.equal(await state(1), "funded");
      await markSent(1);
      assert.equal(await state(1), "sent");
      await program.methods.confirmReceipt().accountsPartial(settle(1, eve)).signers([eve]).rpc();
      assert.equal(await state(1), "completed");
      // seller paid a $5 bond, then gets 40 - 1.20 fee + 5 bond back: net +38.80
      assert.equal(await usdcBal(sam.publicKey), samStart + usdc(38.8));
      assert.equal(await usdcBal(treasury.publicKey), treStart + usdc(1.2));
    });

    it("only the buyer can confirm (Unauthorized)", async () => {
      await list(6);
      await fund(6);
      await markSent(6);
      await expectError(
        program.methods.confirmReceipt().accountsPartial(settle(6, sam)).signers([sam]).rpc(),
        "Unauthorized"
      );
    });

    it("refund_expired: early call rejected, then anyone refunds price + bond to the buyer", async () => {
      await list(2);
      await fund(2);
      await expectError(
        program.methods.refundExpired().accountsPartial(settle(2, relayer)).signers(signersFor(relayer)).rpc(),
        "DeadlineNotReached"
      );
      const eveBefore = await usdcBal(eve.publicKey);
      const esc = await program.account.escrowOrder.fetch(escrowPda(sam.publicKey, 2));
      await waitUntilPast(esc.shipDeadline.toNumber());
      await program.methods.refundExpired().accountsPartial(settle(2, relayer)).rpc();
      assert.equal(await state(2), "refunded");
      assert.equal(await usdcBal(eve.publicKey), eveBefore + usdc(45));
    });

    it("release_expired: buyer goes silent, anyone releases to the seller", async () => {
      await list(3);
      await fund(3);
      await markSent(3);
      const samBefore = await usdcBal(sam.publicKey);
      const esc = await program.account.escrowOrder.fetch(escrowPda(sam.publicKey, 3));
      await waitUntilPast(esc.confirmDeadline.toNumber());
      await program.methods.releaseExpired().accountsPartial(settle(3, relayer)).rpc();
      assert.equal(await state(3), "completed");
      assert.equal(await usdcBal(sam.publicKey), samBefore + usdc(43.8));
    });

    it("cancel_escrow_listing returns the bond", async () => {
      await list(7);
      const samBefore = await usdcBal(sam.publicKey);
      await program.methods
        .cancelEscrowListing()
        .accountsPartial({
          seller: sam.publicKey,
          escrow: escrowPda(sam.publicKey, 7),
          usdcMint,
          sellerUsdc: usdcAta(sam.publicKey),
          escrowVault: usdcAta(escrowPda(sam.publicKey, 7)),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([sam])
        .rpc();
      assert.equal(await state(7), "cancelled");
      assert.equal(await usdcBal(sam.publicKey), samBefore + usdc(5));
    });

    it("dispute: only the arbiter can resolve; split by buyer_bps", async () => {
      await list(4);
      await fund(4);
      await openDispute(4, eve);
      assert.equal(await state(4), "disputed");
      await expectError(
        program.methods.resolveDispute(7000).accountsPartial(settle(4, eve)).signers([eve]).rpc(),
        "Unauthorized"
      );
      const [eveBefore, samBefore] = [await usdcBal(eve.publicKey), await usdcBal(sam.publicKey)];
      await program.methods.resolveDispute(7000).accountsPartial(settle(4, arbiter)).signers([arbiter]).rpc();
      assert.equal(await state(4), "resolved");
      // (40 + 5) * 70% = 31.50 to buyer, 13.50 to seller
      assert.equal(await usdcBal(eve.publicKey), eveBefore + usdc(31.5));
      assert.equal(await usdcBal(sam.publicKey), samBefore + usdc(13.5));
    });

    it("dispute_timeout: price to buyer, bond to seller after the window", async () => {
      await list(5);
      await fund(5);
      await markSent(5);
      await openDispute(5, sam);
      await expectError(
        program.methods.disputeTimeout().accountsPartial(settle(5, relayer)).rpc(),
        "DeadlineNotReached"
      );
      const [eveBefore, samBefore] = [await usdcBal(eve.publicKey), await usdcBal(sam.publicKey)];
      const esc = await program.account.escrowOrder.fetch(escrowPda(sam.publicKey, 5));
      await waitUntilPast(esc.disputeDeadline.toNumber());
      await program.methods.disputeTimeout().accountsPartial(settle(5, relayer)).rpc();
      assert.equal(await state(5), "resolved");
      assert.equal(await usdcBal(eve.publicKey), eveBefore + usdc(40));
      assert.equal(await usdcBal(sam.publicKey), samBefore + usdc(5));
    });
  });

  // -------------------------------------------------------------------------
  describe("standing orders", () => {
    const order = standingPda(carol.publicKey, 1);

    const fillAccounts = (mint: PublicKey, seller: PublicKey) => ({
      payer: relayer.publicKey,
      crank: relayer.publicKey,
      standingOrder: order,
      owner: carol.publicKey,
      ticketMint: mint,
      listing: listingPda(mint),
      event,
      seller,
      organizer: organizer.publicKey,
      treasury: treasury.publicKey,
      usdcMint,
      budgetVault: usdcAta(order),
      listingVault: ticketAta(mint, listingPda(mint)),
      ownerTicketAccount: ticketAta(mint, carol.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    it("opens with a locked budget of max_price x quantity", async () => {
      const before = await usdcBal(carol.publicKey);
      await program.methods
        .openStandingOrder(new BN(1), USDC(90), 2, new BN(600))
        .accountsPartial({
          payer: relayer.publicKey,
          owner: carol.publicKey,
          event,
          standingOrder: order,
          usdcMint,
          ownerUsdc: usdcAta(carol.publicKey),
          budgetVault: usdcAta(order),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([carol])
        .rpc();
      assert.equal(await usdcBal(carol.publicKey), before - usdc(180));
      assert.equal(await usdcBal(order), usdc(180));
    });

    it("rejects a listing above max_price (PriceAboveMax)", async () => {
      await listResale(dave, aliceTicket, USDC(95)); // under the $100 cap, over the $90 max
      await expectError(
        program.methods.fillStandingOrder().accountsPartial(fillAccounts(aliceTicket, dave.publicKey)).preInstructions(cu).rpc(),
        "PriceAboveMax"
      );
    });

    it("a crank fills from a matching listing: ticket to the owner, paid from the budget", async () => {
      await listResale(bob, bobTicket, USDC(85));
      const bobBefore = await usdcBal(bob.publicKey);
      await program.methods
        .fillStandingOrder()
        .accountsPartial(fillAccounts(bobTicket, bob.publicKey))
        .preInstructions(cu)
        .rpc();
      const t = await ticketAcct(bobTicket, carol.publicKey);
      assert.equal(t.amount, 1n);
      assert.isTrue(t.isFrozen);
      assert.equal(await usdcBal(order), usdc(180 - 85));
      // $85: royalty $4.25, fee $2.55, seller $78.20
      assert.equal(await usdcBal(bob.publicKey), bobBefore + usdc(78.2));
      assert.equal((await program.account.standingOrder.fetch(order)).filled, 1);
    });

    it("only the owner can close before the deadline; close refunds the remainder", async () => {
      const closeAccts = (caller: Keypair) => ({
        payer: relayer.publicKey,
        caller: caller.publicKey,
        standingOrder: order,
        owner: carol.publicKey,
        usdcMint,
        budgetVault: usdcAta(order),
        tokenProgram: TOKEN_PROGRAM_ID,
      });
      await expectError(
        program.methods.closeStandingOrder().accountsPartial(closeAccts(dave)).signers([dave]).rpc(),
        "DeadlineNotReached"
      );
      const before = await usdcBal(carol.publicKey);
      await program.methods.closeStandingOrder().accountsPartial(closeAccts(carol)).signers([carol]).rpc();
      assert.equal(await usdcBal(carol.publicKey), before + usdc(95));
      assert.equal(await usdcBal(order), 0n);
      assert.deepEqual((await program.account.standingOrder.fetch(order)).state, { closed: {} });
    });
  });

  // -------------------------------------------------------------------------
  // Last suite (mocha runs a suite's own tests before nested suites, so this must be a describe).
  describe("relayer", () => {
    it("no user ever needed SOL: the relayer paid every fee and rent", async () => {
      for (const kp of [admin, arbiter, organizer, alice, bob, dave, carol, sam, eve]) {
        assert.equal(await connection.getBalance(kp.publicKey), 0, `${kp.publicKey.toBase58()} holds SOL`);
      }
    });
  });
});
