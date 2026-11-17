# Devnet demo checklist

Click-through for the live demo on devnet: every step is a real transaction, gas paid by the relayer.
Logging in needs a real Privy email/Google sign-in, so this is done by hand in a browser. The same
flows run automatically on a local validator with `cd app && npm run verify:local` (32 checks).

## 0. One-time setup

1. **Env** in `app/.env.local` (and the same in Vercel):
   - `NEXT_PUBLIC_USE_MOCK=false`
   - `NEXT_PUBLIC_RELAYER_PUBKEY=7r2SszeUx3xyJsjAeUYvveMMmvkjjvxbPhxUGiP78g61`
   - `RELAYER_SECRET_KEY=` the contents of `.keys/relayer.json` (server only; never `NEXT_PUBLIC_`)
2. **Relayer SOL:** `solana balance 7r2SszeUx3xyJsjAeUYvveMMmvkjjvxbPhxUGiP78g61 --url devnet` should be ≥ 0.5.
   Each action costs it about 0.00001 SOL in fees, plus rent (≈ 0.002–0.004 SOL) when it creates accounts.
3. **Devnet USDC** (no SOL needed: the relayer pays gas). Get it at <https://faucet.circle.com>
   (Solana → Devnet). Amounts are kept small; the demo uses the $10 campus event:
   - Seed seller `29ZQN6eHpp5VJH3zLSgC7UVUYsrb6czgrqEKb61LnzUs`: **22 USDC** (2 × $10 tickets + $2 bond)
   - Wallet 1 (your demo login): **30 USDC** (a $10 ticket, then a $20 escrow buy)
   - Wallet 2 (a second login, e.g. another Google account or a private window): **14 USDC** (the $14 resale)
   Each wallet's address is in the avatar menu (top right) after logging in, with a copy button.
4. **Seed** (after funding the seed seller):
   `cd program && anchor run seed-devnet --provider.cluster devnet`
   It's idempotent; on Battle of the Bands it buys 2 tickets for the seller, lists one at $14 (cap $15)
   and creates an outside-ticket escrow listing ($20, $2 bond, 60 s windows). Commit the updated `app/lib/event-meta.json` so Vercel shows the escrow seat.
5. `cd app && npm run dev`, open <http://localhost:3000>.

Seeded events (already on devnet):

| Event | PDA | Price / cap / royalty |
| --- | --- | --- |
| Neon Harbor: Midnight Tides Tour | `Hw1cWsKxef959oD338Qx86TjDt2km4XXRBqPgxjjvL7a` | $75 / $120 / 5% |
| UT vs. A&M: Rivalry Game | `6hW7X8JNFfwhU7Qx3dFTyy3LUa5tsCvMWyFhREdZZXzs` | $85 / $130 / 3% |
| Battle of the Bands: Dorm Edition | `EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE` | $10 / $15 / 0% |

Discover (D's page, via B's `useEvents`) is empty in real mode until B wires `useEvents` to
`getEvents()` from `lib/chain.ts`. Until then open events directly: `/events/<PDA>`.

## 1. Demo steps

Write down each signature from the success toast ("View tx").

All steps use **Battle of the Bands** (`/events/EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE`): $10, cap $15.

| # | Who | Where | Do | Expect |
| --- | --- | --- | --- | --- |
| a | Wallet 1 | `/creator` | Create an event: price 10, supply 10, cap 15, royalty 5 | Toast "Event created", link to the event page |
| b | Wallet 1 | `/events/<Battle of the Bands PDA>` | **Buy ticket** | Toast "Ticket bought!"; USDC −$10 in the nav |
| c | Wallet 1 | `/tickets` | See the new ticket (seat `GA n`) | Ticket listed with Resell |
| d | Wallet 1 | `/tickets` → Resell | Price **50** (hint turns red: Max $15) → List | Error toast: **"This artist caps resale at $15…"**. Nothing listed. |
| e1 | Wallet 1 | `/tickets` → Resell | Price **14** → List | Toast "Listed for $14.00"; ticket shows "Listed · $14" |
| e2 | Wallet 2 | `/events/<Battle of the Bands PDA>` | Fan resale → **Buy** on wallet 1's $14 listing (not the seed seller's) | Toast "Ticket bought!"; it's in wallet 2's `/tickets`; wallet 1 gets $13.58 (no royalty on this event, 3% fee) |
| f1 | Wallet 1 | same event page | Outside tickets → **Buy with escrow protection** ($20) | Redirect to `/orders/<escrow PDA>`; panel "Payment locked in the vault", 60 s countdown |
| f2 | – | same page | Wait for the ship countdown to hit 0 (seed seller never ships) | **Claim refund** button appears |
| f3 | Wallet 1 | same page | **Claim refund** | Toast "Refunded"; wallet 1 gets $22 back ($20 + the seller's $2 bond) |

The seed seller's own $14 listing is there too, so the page isn't empty before step e1.

Also worth showing: `/sell` with "Demo mode: 60-second windows" to list your own outside ticket, then
**Mark as sent** under "My escrow sales" once someone funds it.

## 2. Gas check

Before and after: `solana balance <wallet address> --url devnet` for wallet 1 and 2 stays **0 SOL**
the whole time; the relayer's balance drops instead. Toasts say "Gas paid by SeatSafe."
