# SeatSafe program reference

Anchor program `seatsafe` on Solana **devnet**. B (backend, QuickNode Stream) and D (agent crank) build against this file. The generated IDL and TypeScript types are in `app/lib/idl/` (refresh with `cd program && npm run sync-idl`).

- **Program ID:** `7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy`
- **Anchor:** 1.2.2 (TS client in tests: `@anchor-lang/core`; the app's `@coral-xyz/anchor` 0.32 also reads this IDL)
- **USDC:** whatever mint `Config.usdc_mint` holds (devnet: Circle `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, classic SPL Token, 6 decimals)
- **Tickets:** Token-2022, one mint per ticket, decimals 0, supply 1

## Conventions

- **Amounts** are USDC base units, `u64`, 6 decimals (`$1 = 1_000_000`). **Percentages** are basis points, `u16` (`10_000 = 100%`). All math is checked (`MathOverflow`); fees and royalties round down.
- **Times** are `i64` unix seconds from the cluster `Clock`. Deadlines are created from durations (`*_secs`) passed at creation.
- **Relayer pays.** Every instruction that creates accounts takes `payer: Signer` (our relayer) separately from the user's signer. The user signs to authorize; the payer pays fees and rent. Users can hold 0 SOL (the test suite proves this).
- **Two token programs.** `token_program` is the USDC mint's program (classic SPL Token on devnet). `ticket_token_program` is always Token-2022.
- **Missing USDC accounts** for recipients (seller, organizer, treasury, buyer on refund) are created as ATAs by the instruction (`init_if_needed`, paid by `payer`). Source accounts (whoever pays USDC) must already exist.
- **Everything emits an event.** See [Events](#events).

## Accounts (PDAs)

| Account | Seeds | Fields |
| --- | --- | --- |
| `Config` | `["config"]` | `admin`, `arbiter`, `treasury` (owner of the fee ATA), `usdc_mint`, `fee_bps`, `dispute_window_secs`, `bump` |
| `Event` | `["event", organizer, event_id u64 LE]` | `organizer`, `event_id`, `price`, `supply` (u32), `sold` (u32), `resale_cap`, `royalty_bps`, `starts_at`, `bump` |
| ticket mint | `["ticket_mint", event, sold u32 LE]` | Token-2022 mint; `sold` is the value **before** the purchase |
| `ticket_authority` | `["ticket_authority"]` | no data; mint authority + freeze authority of every ticket |
| `TicketRecord` | `["ticket", ticket_mint]` | `event`, `mint`, `seat` (≤ 32 bytes), `original_buyer`, `bump` |
| `Listing` | `["listing", ticket_mint]` | `seller`, `ticket_mint`, `event`, `price`, `created_at`, `bump` |
| listing vault | Token-2022 ATA of the `Listing` PDA for the ticket mint | holds the listed ticket (frozen) |
| `EscrowOrder` | `["escrow", seller, order_id u64 LE]` | `seller`, `buyer: Option`, `order_id`, `price`, `bond`, `state`, `ship_deadline`, `confirm_deadline`, `ship_window_secs`, `confirm_window_secs`, `dispute_deadline`, `bump` |
| escrow vault | USDC ATA of the `EscrowOrder` PDA | bond, then bond + price |
| `StandingOrder` | `["standing", owner, order_id u64 LE]` | `owner`, `order_id`, `event`, `max_price`, `quantity` (u32), `filled` (u32), `deadline`, `state`, `bump` |
| budget vault | USDC ATA of the `StandingOrder` PDA | locked budget |

`EscrowState`: `Listed → Funded → Sent → Completed`, plus `Refunded`, `Cancelled`, `Disputed → Resolved`.
`StandingOrderState`: `Open → Filled` (all bought) `→ Closed`.

Order and event IDs (`event_id`, `order_id`) are chosen by the client; they only need to be unique per organizer / seller / owner.

## Instructions

"Anyone" means any signer; they pay nothing but the transaction fee (the relayer usually sends it).

### Setup

| Instruction | Signers | Checks | Effect | Emits |
| --- | --- | --- | --- | --- |
| `init_config(arbiter, treasury, fee_bps, dispute_window_secs)` + `usdc_mint` account | `payer`, `admin` | `fee_bps ≤ 5000`, window > 0; can only run once | creates `Config` | `ConfigInitialized` |

### Tier 1: onchain tickets

| Instruction | Signers | Checks | Effect | Emits |
| --- | --- | --- | --- | --- |
| `create_event(event_id, price, supply, resale_cap, royalty_bps, starts_at)` | `payer`, `organizer` | price, supply > 0; `resale_cap ≥ price` (`InvalidResaleCap`); `royalty_bps + fee_bps ≤ 5000` (`InvalidRoyalty`) | creates `Event` | `EventCreated` |
| `buy_primary(seat)` | `payer`, `buyer` | `sold < supply` (`SoldOut`); buyer ≠ organizer; seat ≤ 32 bytes | USDC: `price − fee` buyer → organizer, `fee` → treasury. Creates the ticket mint (Plan B), the buyer's frozen ticket ATA with 1 token, and `TicketRecord`; `sold += 1` | `TicketMinted` |
| `list_resale(price)` | `payer`, `seller` | `price ≤ event.resale_cap` (**`AboveResaleCap`**); seller holds the ticket | creates `Listing` + vault; ticket seller → vault | `ListingCreated` |
| `cancel_listing()` | `payer`, `seller` (= listing.seller) | | ticket vault → seller (frozen); closes vault + listing, rent → `payer` | `ListingCancelled` |
| `swap_resale()` | `payer`, `buyer` | buyer ≠ seller (Anchor rejects it first with `ConstraintDuplicateMutableAccount` because the two USDC accounts match; the UI should hide Buy on your own listing) | **one instruction:** USDC buyer → seller (`price − royalty − fee`), → organizer (`royalty`), → treasury (`fee`); ticket vault → buyer (frozen); closes vault + listing, rent → `payer` | `TicketSwapped` |

`swap_resale` and `fill_standing_order` take `ticket_mint` and derive the listing from it, so the client only needs the mint.

### Tier 2: escrow for outside tickets

| Instruction | Signers | Checks | Effect | Emits |
| --- | --- | --- | --- | --- |
| `create_escrow_listing(order_id, price, bond, ship_window_secs, confirm_window_secs)` | `payer`, `seller` | price > 0, windows > 0 | creates `EscrowOrder` (`Listed`) + vault; `bond` seller → vault | `EscrowListed` |
| `fund_escrow()` | `buyer` | `Listed`; buyer ≠ seller | `price` buyer → vault; `buyer` set; `ship_deadline = now + ship_window`; `Funded` | `OrderFunded` |
| `mark_sent()` | `seller` | `Funded`; `now ≤ ship_deadline` (`DeadlinePassed`) | `confirm_deadline = now + confirm_window`; `Sent` | `TicketSent` |
| `confirm_receipt()` | `payer`, `caller` = buyer | `Sent` | `price − fee + bond` → seller, `fee` → treasury; `Completed` | `OrderCompleted { auto: false }` |
| `refund_expired()` | `payer`, `caller` = anyone | `Funded`; `now > ship_deadline` (`DeadlineNotReached`) | `price + bond` → buyer; `Refunded` | `OrderRefunded` |
| `release_expired()` | `payer`, `caller` = anyone | `Sent`; `now > confirm_deadline` | same payout as confirm; `Completed` | `OrderCompleted { auto: true }` |
| `cancel_escrow_listing()` | `seller` | `Listed` | `bond` → seller; `Cancelled` | `EscrowCancelled` |
| `open_dispute()` | `caller` = buyer or seller | `Funded` and `now ≤ ship_deadline`, or `Sent` and `now ≤ confirm_deadline` | `dispute_deadline = now + config.dispute_window_secs`; `Disputed` | `DisputeOpened` |
| `resolve_dispute(buyer_bps)` | `payer`, `caller` = `config.arbiter` | `Disputed`; `buyer_bps ≤ 10000` | `(price + bond) × buyer_bps` → buyer, rest → seller; `Resolved` | `DisputeResolved { timeout: false }` |
| `dispute_timeout()` | `payer`, `caller` = anyone | `Disputed`; `now > dispute_deadline` | `price` → buyer, `bond` → seller; `Resolved` | `DisputeResolved { timeout: true }` |

The five payout instructions share one account list (`SettleEscrow`: payer, caller, config, escrow, seller, buyer, treasury, usdc_mint, escrow_vault, seller/buyer/treasury USDC ATAs, programs). The escrow must have a buyer, so they only work after `fund_escrow`.

No fee is taken on refunds or dispute outcomes.

### Standing orders (agents)

| Instruction | Signers | Checks | Effect | Emits |
| --- | --- | --- | --- | --- |
| `open_standing_order(order_id, max_price, quantity, deadline_secs)` + `event` account | `payer`, `owner` | max_price, quantity > 0; deadline_secs > 0 | creates `StandingOrder` (`Open`) + budget vault; `max_price × quantity` owner → vault | `StandingOrderOpened` |
| `fill_standing_order()` | `payer`, `crank` = anyone | `Open` and `filled < quantity` (`OrderFilled`); `now ≤ deadline` (`DeadlinePassed`); `listing.event == order.event` (`WrongEvent`); `listing.price ≤ max_price` (`PriceAboveMax`); seller ≠ owner | same settlement as `swap_resale`, paid from the budget vault, ticket → owner (frozen); `filled += 1` (`Filled` when complete) | `TicketSwapped`, `StandingOrderFilled` |
| `close_standing_order()` | `payer`, `caller` = owner (any time) or anyone (after deadline) | not already `Closed` | whole remaining budget → owner; `Closed` | `StandingOrderClosed` |

## Events

Every event has `at: i64` (unix seconds). Amounts are USDC base units. Anchor encodes events as base64 in `Program data:` log lines; decode with the IDL (`new EventParser(programId, new BorshCoder(idl))`).

| Event | Fields |
| --- | --- |
| `ConfigInitialized` | config, admin, arbiter, treasury, usdc_mint, fee_bps: u16, at |
| `EventCreated` | event, organizer, event_id: u64, price, supply: u32, resale_cap, royalty_bps: u16, starts_at: i64, at |
| `TicketMinted` | event, ticket_mint, buyer, seat: string, price, organizer_amount, fee, sold: u32, at |
| `ListingCreated` | listing, ticket_mint, event, seller, price, at |
| `ListingCancelled` | listing, ticket_mint, seller, at |
| `TicketSwapped` | listing, ticket_mint, event, seller, buyer, price, seller_amount, royalty, fee, at |
| `EscrowListed` | escrow, seller, order_id: u64, price, bond, ship_window_secs: i64, confirm_window_secs: i64, at |
| `OrderFunded` | escrow, buyer, seller, price, ship_deadline: i64, at |
| `TicketSent` | escrow, seller, buyer, confirm_deadline: i64, at |
| `OrderCompleted` | escrow, buyer, seller, seller_amount, fee, bond_returned, auto: bool, at |
| `OrderRefunded` | escrow, buyer, seller, amount (price + bond), at |
| `EscrowCancelled` | escrow, seller, bond_returned, at |
| `DisputeOpened` | escrow, opened_by, dispute_deadline: i64, at |
| `DisputeResolved` | escrow, buyer, seller, buyer_amount, seller_amount, timeout: bool, at |
| `StandingOrderOpened` | standing_order, owner, order_id: u64, event, max_price, quantity: u32, budget, deadline: i64, at |
| `StandingOrderFilled` | standing_order, owner, listing, ticket_mint, price, filled: u32, quantity: u32, crank, at |
| `StandingOrderClosed` | standing_order, owner, refunded, filled: u32, closed_by, at |

All unlisted field types are `pubkey` (accounts) or `u64` (amounts). In `TicketSwapped` emitted by a fill, `buyer` is the standing order owner.

### Mapping to `app/lib/types.ts`

| OrderEvent.type | Program event |
| --- | --- |
| `FUNDED` | `OrderFunded` (and `EscrowListed` for the seller bond) |
| `TICKET_SENT` | `TicketSent` |
| `CONFIRMED` / `RELEASED` | `OrderCompleted` (`auto` tells which) |
| `REFUNDED` | `OrderRefunded` |
| `DISPUTE_OPENED` | `DisputeOpened` |
| `DISPUTE_RESOLVED` | `DisputeResolved` |
| `SWAPPED` | `TicketSwapped` |

## Plan B ticket design (why the cap can't be bypassed)

1. Each ticket is its own Token-2022 mint (decimals 0, supply 1), created by `buy_primary` at a PDA.
2. The mint has the **DefaultAccountState = Frozen** extension, so **every token account ever created for it starts frozen**.
3. Mint authority and freeze authority are the `["ticket_authority"]` PDA. No one can mint a second copy, and only the program can thaw.
4. A frozen account can't transfer, burn, approve or close. So a holder can't sell the ticket peer to peer; the only way to move it is through `list_resale` → `swap_resale` / `fill_standing_order` / `cancel_listing`, which enforce the cap, royalty and fee.
5. When the program moves a ticket it thaws the source and destination, transfers 1, and re-freezes the destination (the emptied listing vault is closed instead). Invariant: **outside a SeatSafe instruction, every ticket account is frozen.**
6. Tested: a plain Token-2022 `transferChecked` by the holder fails with "Account is frozen".

Plan A (a transfer hook) is not implemented.

## Economics

| Flow | Buyer pays | Seller / organizer gets | Royalty | Fee (treasury) |
| --- | --- | --- | --- | --- |
| Primary (`buy_primary`) | face `price` | organizer: `price − fee` | – | `fee_bps` of price |
| Resale (`swap_resale`, `fill_standing_order`) | listing `price` (≤ cap) | seller: `price − royalty − fee` | organizer: `royalty_bps` of price | `fee_bps` of price |
| Escrow complete | `price` | seller: `price − fee`, plus bond back | – | `fee_bps` of price |
| Escrow refund | gets back `price + bond` | loses bond | – | – |
| Dispute resolved | `(price + bond) × buyer_bps` | rest | – | – |
| Dispute timeout | gets back `price` | bond back | – | – |

`royalty_bps + fee_bps ≤ 50%`, enforced at `create_event`. The fee is read from `Config` at settlement time.

## Trust and risk assumptions

- **Resale cap** is enforced in `list_resale` (`price ≤ resale_cap`). Because tickets are frozen outside the program, there is no other path to sell a Tier 1 ticket. Off-chain side deals (paying cash, then listing at the cap) can't be stopped by any onchain design.
- **Seller bond** (Tier 2) is the seller's skin in the game: they lose it to the buyer if they never mark the ticket sent before `ship_deadline`.
- **Tier 2 is trust-minimized, not trustless.** The program can't see an outside ticket. `mark_sent` is the seller's claim; the buyer's protection is the confirm window plus disputes. If the buyer doesn't confirm or dispute before `confirm_deadline`, anyone can release funds to the seller.
- **Deadlines** use the cluster clock, which can drift a few seconds from wall time. Demo windows of 60 s are fine.
- **Arbiter** can only split a **disputed** escrow's own vault between its buyer and seller. It can't touch other funds, can't take a fee, and can't act before a dispute is opened. If it never acts, `dispute_timeout` returns the price to the buyer and the bond to the seller.
- **No admin backdoor.** No instruction lets the admin or anyone else withdraw user funds. There's no instruction to change Config after init (redeploying to change fees is a program upgrade by the upgrade authority).
- **Crank trust (standing orders).** Anyone can call `fill_standing_order`, but the program checks event, max price, quantity, deadline and seller ≠ owner. The worst a malicious crank can do is fill with any listing that matches the owner's own rules (e.g. a worse seat at the same event). Ratings aren't onchain, so `minSellerRating` is enforced by our backend crank only.
- **Config init** is first-come: whoever calls `init_config` first becomes admin. We call it right after deploy (`program/scripts/init-devnet.ts`).
- **Rent refunds** for closed listings go to whichever `payer` signs the closing transaction. With our relayer as the only payer that's the relayer itself.
- **Duplicate accounts.** An instruction fails if two of its USDC ATAs are the same account (e.g. organizer == treasury, or seller == organizer in a resale). Keep the treasury, organizers and fans as different wallets.
- **Upgrade authority** is the deployer key. Whoever holds it can replace the program, so it's the real trust root on devnet.
