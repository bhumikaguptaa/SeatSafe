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

## 3. Devnet proof (2026-11-17, no browser)

`cd program && anchor run seed-devnet --provider.cluster devnet` (8 s; every tx logged and confirmed at
"confirmed", 60 s timeout, one retry):

| Seed step | Address | Tx |
| --- | --- | --- |
| buy_primary Lawn GA 1 (seed seller) | mint `4LbYmJfemLxvp3RytbvdDwy7UwcUD7fcKqw9EJM6SQLG` | [4VRMB18B…](https://explorer.solana.com/tx/4VRMB18BtVrPcAsHu6kkax9CZsS3oA8cC6eNgEdqSMYKtkcWzEYoPRcKBJd9zXZSG32KbNn6qSBEGMCEAvECa7x9?cluster=devnet) |
| buy_primary Lawn GA 2 (seed seller) | mint `8fj1GmNKekat7jHxMeUqeeaV4uwNP5tnZpR7kSKQ4j1H` | [2VKtBYVq…](https://explorer.solana.com/tx/2VKtBYVqP4EooDSY8edJAefUYpiMgJadAsLVq5jZQzxtoQKmsSafwR1KvnFCfVcGVehJ7mx96CopYLZvnzbv23wB?cluster=devnet) |
| Resale listing at $14 | `Cc8W2bQwDF9smQjUomkvgGJqVpj5HRo5i1Fzo9aJLdWm` | [itSijzmE…](https://explorer.solana.com/tx/itSijzmEKdytZaFuHSxNwMPmvKaid4havuCmo7ELz1FzDF8qkm1XhzZNxZQttKpGiGdGepX63DP7bi8KSXZhsN2?cluster=devnet) |
| Escrow listing $20, bond $2, 60 s | `3gPLQkSMgUaMVi1WY6iBYokNuaDH7nyqRLmjUaeF8zpU` | [1yTqSEq9…](https://explorer.solana.com/tx/1yTqSEq9CTCTEZywD2wR61HwQzLnTSY1U2BADm3rbkTiaBxUnR1njx2pPeB9RmVXpk7Ht6n8KjVQYHRwMebcfTP?cluster=devnet) |

`cd app && npm run demo:devnet` (`scripts/demo-devnet.ts`): the app's builders (`lib/program.ts`) sent
through the same steps as `/api/relay` (`checkRelayTx`, relayer co-signs and pays). Wallets A and B are
throwaway keypairs with 0 SOL. Amounts are smaller than in section 1 so the faucet covers them:
resale at $11 instead of $14, and a separate $1 escrow with a $1 bond (the seeded $20 escrow is kept for the live demo).

| # | Step | Tx | Result |
| --- | --- | --- | --- |
| b | buy_primary $10 (A) | [2Ec4WXL7…](https://explorer.solana.com/tx/2Ec4WXL7FwdcyQNk7Ako7QQ4hYYCiNRJX5nbnE18Nidf9WDeXCCuLH82Rba72ZijuwArR4KmL6drC4C6zguQNQZQ?cluster=devnet) | PASS |
| d | list_resale $50 over the $15 cap (A) | rejected in preflight, no tx | PASS: `AboveResaleCap` |
| e1 | list_resale $11 (A) | [4JUjLNSu…](https://explorer.solana.com/tx/4JUjLNSu8uSqipSXFjowxc32qY8W6yeGPdP412a73VXhiG2evybieXGanwRtX5Cw2i8k1L3KhrpaFHS68rkYR42C?cluster=devnet) | PASS |
| e2 | swap_resale (B buys A's listing) | [57yJuf5s…](https://explorer.solana.com/tx/57yJuf5sS3dTgiyV5mUzPi7bvHBpNt3YF85dGZvF2EqTZgzEN9xKgjWBMyXDwbRcScacwvyyGr6QoLBn65sxW1i3?cluster=devnet) | PASS: B holds the ticket, A got $10.67 ($11 − 3%) |
| f0 | create_escrow_listing $1, bond $1, 60 s (seed seller) | [eFns2ocj…](https://explorer.solana.com/tx/eFns2ocjVo7RsW3QVvV2a4GMMqDdxg7GoKZJk3fcZx57vJjoHwpnqLE2CSPQVboYj3kNayoQgQShHtawpPxw1f7?cluster=devnet) | PASS: `B9WXyY4W5rjo4KxjaMMgS98abTMjyB8QLRKsYfbGa8rd` |
| f1 | fund_escrow (A) | [3z3JH7q4…](https://explorer.solana.com/tx/3z3JH7q4tVsFThpqNCyRBzVkpXkgLyogrsFXhGD5HMGotftiErkC8zdXUfL6SciFELdZC7m26Hej2zuS4oHyFdm?cluster=devnet) | PASS |
| f3 | refund_expired after the 60 s window (A) | [AyD5AdMq…](https://explorer.solana.com/tx/AyD5AdMqefmJD8rCsTXhWsGeZGkJhUZdE6ntKSPMDkerFXUASwS2ipDG1hsuMKED1RNaKYJYiAYUCNxogFQ9iET?cluster=devnet) | PASS: A got $2 (price + bond) |
| gas | A and B SOL balance | – | PASS: 0 SOL throughout |

**Still needs a human click-through in the browser** (Privy email/Google login and Privy signing
can't be scripted): step a (`/creator`), b–f3 through the UI with real Privy wallets 1 and 2,
the friendly over-cap error toast, the escrow countdown/Claim refund UI, and the "Gas paid by
SeatSafe" toasts. The script covers the same on-chain logic, but not the HTTP hop to `/api/relay`
(that hop is covered separately by `npm run check:relay`).

### Browser proof with a real Privy wallet (2026-11-17)

Wallet 1 = `Hh7qBYYz4HaNfjevedBabsKRAtgC6RWXzqhPWYoZnJgq` (Privy login on localhost). Fee payer on every tx is the
relayer `7r2SszeU…`; wallet 1 only signs and stayed at **0 SOL** throughout.

| # | Step | Tx | Result |
| --- | --- | --- | --- |
| b | Buy ticket $10 | [472KgZeR…](https://explorer.solana.com/tx/472KgZeRUbP6zAchNjvjCv4uqguxQR6EBJMH1tYHySTHv952nBRQurFU6bQbMPuWb9dCW3RFeAaVYJQcvNnXT9vP?cluster=devnet) | ✅ USDC 30 → 20 |
| e1 | List own ticket at $14 | [4kf8Kds4…](https://explorer.solana.com/tx/4kf8Kds4LEAja36CswkSFf5rHoibgcqawyFBo7zg9KT7E6P7imotbT8k1o1etuRmdaWd1R2KkrXaBydGhjxmiGbx?cluster=devnet) | ✅ (later cancelled) |
| d | Resell at $50 | rejected before signing (simulation) | ✅ `AboveResaleCap` toast, no tx |
| e2 | Buy the seed seller's $14 listing (swap) | [5nsoeBfa…](https://explorer.solana.com/tx/5nsoeBfa1r2PgJTQQPAVC1CCMqbemGdL79YpWZ2bypchVfucaJdu8bDnKStfZmyAjXnkWtz8sVkgaEs2K8yFSQUf?cluster=devnet) | ✅ seller +$13.58, treasury +$0.42 |
| f1 | Buy with escrow protection $20 | [C51PcMoB…](https://explorer.solana.com/tx/C51PcMoBFrSEhvpL4kE7wBDTeRQ4L1wrBTwQ52ZkmUefxdrR4HvC43SrYLBEgxheQML7ZzYq5iJQ3t2frq9pTQJ?cluster=devnet) | ✅ vault 2 → 22 |
| f3 | Claim refund after 60 s | [3ouPnZX8…](https://explorer.solana.com/tx/3ouPnZX8ELgXye5jAkHazTwkFZGHMJqhuoY2h3mVcGSe9jytqbgcbNFrjy9pQkr7CsNoazrw5UpxDJjUWXbwmJYR?cluster=devnet) | ✅ wallet 1 +$22 |

Not yet clicked in the browser: **a** (`/creator` create event) and a second Privy login (wallet 2).

**Before the live demo:** the seeded $20 escrow (`3gPLQ…`) is now refunded, and the seed seller's $14 listing was
bought. Re-run `cd program && anchor run seed-devnet --provider.cluster devnet` won't recreate them (it's
idempotent on the seller's existing tickets/escrow); list a ticket at $14 from `/tickets` and a new outside
ticket from `/sell` instead.

## 4. In-person mode (Solana Pay at the gate)

Two devices: the **seller's laptop** shows the QR, the **buyer's phone** scans it. Use the deployed app
(https://seat-safe-chi.vercel.app); the phone's camera needs HTTPS.

| # | Who / where | Do | Expect |
| --- | --- | --- | --- |
| g1 | Seller (wallet 1) on laptop, `/tickets` | On an unlisted Battle of the Bands ticket: **Sell in person** → price **14** (prefilled $10, "Max $15") → **Show QR** | Toast "Listed for $14.00", then a full-screen QR with seat, price and "Waiting for the buyer…" |
| g1b | (optional) same | Try price **50** first | Red cap error, no QR (same `AboveResaleCap` as section 1 d) |
| g2 | Buyer (wallet 2) on phone, logged in, `/scan` (**Scan to buy** in the bottom bar) | Allow the camera, point it at the laptop QR | Confirm card: "Protected by SeatSafe · Buy Lawn GA n for $14.00", event and date, "Gas paid by SeatSafe" |
| g3 | Buyer | **Buy for $14.00** → approve the Privy signature | Toast "Ticket bought!" with View tx + Add to calendar; phone goes to `/tickets` with the ticket |
| g4 | Seller laptop | Nothing (polls every 2 s) | Flips to **"Sold! $13.58 received"** with a View transaction link |

No camera, or rehearsing alone: on the QR screen tap **Copy link** and paste the `solana:` link into
`/scan` on the other device (or another browser profile logged in as wallet 2). An already-listed ticket has
**Show QR** on `/tickets` to bring the QR back.
External wallet: Phantom (devnet) can scan the same QR; the buyer needs devnet USDC, no SOL.
Scripted proof: `cd app && APP_URL=<app url> npm run check:pay` (needs an open seed-seller listing; `reset-demo` makes one).
