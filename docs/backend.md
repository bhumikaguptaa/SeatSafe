# Backend, live events, and the standing-order agent

Member B. This is the piece between the Solana program and the screens: the database, the QuickNode stream, the relayer, the deadline cron, chat with the scam detector, and the standing-order matcher.

The program is the only thing that can move money. This service reads events, asks the program to settle overdue vaults, and never holds a balance of its own.

## What shipped

| Piece | Where |
| --- | --- |
| Schema and seed | `supabase/schema.sql`, `supabase/seed.sql` |
| Live hooks | `useEvents`, `useOrder`, `useOrderChat`, `useAgentLog`, `usePendingApproval`, `useStandingOrders` in `app/lib/hooks.ts` |
| Stream | `POST /api/stream-webhook` |
| Orders | `POST /api/orders`, `POST /api/orders/:id/confirm` |
| Chat | `POST /api/chat`, `GET /api/chat?orderId=` |
| Standing orders | `POST /api/standing-orders`, `GET /api/standing-orders/:id`, `POST /api/standing-orders/:id/approve`, `POST /api/standing-orders/:id/decline` |
| Decision log | `GET /api/agent-log/:id` |
| Deadlines | `GET /api/cron/deadlines` every minute |
| Reconciliation | `GET /api/cron/reconcile` every 5 minutes |
| Relayer balance | `GET /api/cron/relayer` every 5 minutes, alerts under 1 devnet SOL |
| Dispute summary | `POST /api/disputes/summarize` |
| Gas sponsorship | `POST /api/relay`, 20 requests per IP per minute |

`fill_standing_order` is built in `app/lib/program.ts` (`fillStandingOrder`). The matcher signs it with the relayer, which is both the fee payer and the crank.

ElevenLabs stays with Member C and Member D. This backend only creates the approval row that their call screen reads. It does not start a voice session.

## Database

Run `supabase/schema.sql`, then `supabase/seed.sql`, in the Supabase SQL editor. Realtime is enabled there for `orders`, `order_events`, `chat_messages`, `agent_log`, `approval_requests`, `events` and `standing_orders`.

The anon key can read. Every write goes through the service role inside the API routes.

`seed.sql` matches `app/lib/mock.ts`, including the Zelle message on `ord_transit`. For the devnet demo, skip the seed (or set `NEXT_PUBLIC_EVENTS_SOURCE=chain`) so Discover shows the onchain events.

## QuickNode Stream

This is the QuickNode bounty. The tracker moves because the program emits an Anchor event and the stream pushes that log here within a second. Polling the RPC is only the backup (`useOrder` also re-reads a pubkey escrow every 2 seconds).

Create one stream:

| Setting | Value |
| --- | --- |
| Network | Solana Devnet |
| Dataset | Logs |
| Destination | `https://<vercel-host>/api/stream-webhook` |
| Header | `x-webhook-secret: <STREAM_WEBHOOK_SECRET>` |

Filter. Keep a transaction only when a log line mentions the program. Returning `null` drops the block so QuickNode does not call us for unrelated traffic.

```javascript
function main(stream) {
  const programId = "7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy";
  const transactions = [];
  const blocks = stream.data || [];
  for (const block of blocks) {
    for (const tx of block.transactions || []) {
      const logs = (tx.meta && tx.meta.logMessages) || tx.logs || [];
      const hit = logs.some((line) => line.includes(programId));
      if (!hit || (tx.meta && tx.meta.err)) continue;
      const signature = (tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0]) || tx.signature;
      if (!signature) continue;
      transactions.push({
        signature,
        logs,
        slot: block.slot,
        blockTime: block.blockTime,
      });
    }
  }
  return transactions.length ? { transactions } : null;
}
```

The route decodes each `Program data:` line with the IDL (`BorshCoder.events.decode`). It writes `orders` and `order_events`, and it refuses to move an order backwards. A signature already stored in `processed_signatures` is ignored, so a retry from QuickNode does nothing.

State map:

| Program event | Order state | Order event |
| --- | --- | --- |
| `OrderFunded` | `HELD` | `FUNDED` |
| `TicketSent` | `IN_TRANSIT` | `TICKET_SENT` |
| `OrderCompleted` (`auto: false`) | `CONFIRMED`, then `RELEASED` | `CONFIRMED`, `RELEASED` |
| `OrderCompleted` (`auto: true`) | `RELEASED` | `RELEASED` |
| `OrderRefunded` | `REFUNDED` | `REFUNDED` |
| `DisputeOpened` | `DISPUTED` | `DISPUTE_OPENED` |
| `DisputeResolved` | `RELEASED` or `REFUNDED` | `DISPUTE_RESOLVED` |
| `TicketSwapped` | `SWAPPED` | `SWAPPED` |

`ListingCreated` also runs the standing-order matcher.

Screenshot the stream's dataset, filter and destination in the QuickNode dashboard and drop that image in `docs/` before the video. The dashboard login is the team's QuickNode account (claim the hackathon perk first; it is capped).

Replay a payload locally:

```bash
curl -s -X POST http://localhost:3000/api/stream-webhook \
  -H "content-type: application/json" \
  -H "x-webhook-secret: $STREAM_WEBHOOK_SECRET" \
  -d '{"signature":"demoSig","logs":["Program 7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy invoke [1]"]}'
```

A body with no `Program data:` line is stored as processed and changes no order. To exercise the decoder, paste the `Program data:` lines from a real devnet transaction (Solana Explorer → transaction → program logs).

## Relayer and deadlines

`POST /api/relay` is unchanged in what it will sign (`app/lib/relay-policy.ts`). It now rejects an IP that sends more than 20 transactions a minute.

`GET /api/cron/deadlines` loads every escrow and every open standing order. For a funded escrow past `ship_deadline` it sends `refund_expired`. For a sent escrow past `confirm_deadline` it sends `release_expired`. For an open standing order past its deadline it sends `close_standing_order`, which returns the unused budget. The relayer signs as both payer and caller. The program still checks the clock, so an early call fails onchain instead of paying out.

Set `DEMO_DEADLINES=true` when the client should be told to use 60-second windows (`POST /api/orders` returns `shipWindowSecs: 60`). The seed script and the sell page already create 60-second escrows on devnet. The cron cannot shorten a deadline the program already stored.

`GET /api/cron/relayer` reads the relayer balance. Under 1 SOL it writes `relayer_alerts` (at most once an hour) and, if `ALERT_WEBHOOK_URL` is set, POSTs `{ "text" }` there.

Vercel cron is declared in `app/vercel.json`. Set the project root to `app/`, and set `CRON_SECRET` in Vercel. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`.

`GET /api/cron/reconcile` re-reads escrow accounts and repairs any Supabase row that is behind the chain, then runs the matcher over active Tier 1 listings in case a webhook was missed.

## Chat and the scam detector

`POST /api/chat` with `{ orderId, senderId, body }` stores one row in `chat_messages`.

The detector always runs the keyword rules in `app/lib/scam-rules.ts` (Zelle, Venmo, Cash App, PayPal, wires, gift cards, links, "hurry / last chance", moving to WhatsApp or Telegram). A keyword hit is `high` even if the model disagrees. With `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` set, a short prompt can also raise a message the keywords missed. The flag is `risk` and `risk_reason` on the row. The order chat turns that into the red banner.

`POST /api/disputes/summarize` with `{ orderId }` returns a short summary of that thread for an arbiter.

## Standing-order agent

`POST /api/standing-orders` with `{ text, userId }` returns:

```json
{
  "proposal": {
    "eventId": "evt_ut_am",
    "quantity": 2,
    "maxPrice": 90,
    "minRating": 4,
    "deadline": "2026-11-20T05:59:00.000Z"
  },
  "budgetUsd": 180,
  "approval": "rules"
}
```

`proposal` is checked with zod. A sentence that does not name an event and a max price comes back as 422 with the partial parse. The model is used when a key is set. Otherwise the same rules as the agent console parse the sentence, so the demo still runs with no API key.

The fan approves those rules in the UI and the client locks the budget with `open_standing_order`. `userId` must be the wallet address. When `StandingOrderOpened` arrives, the webhook copies `minRating` from the latest unlinked draft for that wallet and event. The program does not store the rating. `RatingTooLow` is reserved and never returned onchain.

On each new Tier 1 listing the matcher:

1. Ignores orders for a different event, a passed deadline, or a listing it already decided.
2. Skips the buyer's own listing, a price above the max, a price above the budget left, and a seller under the minimum rating.
3. If the price is **under** `STANDING_ORDER_APPROVAL_USD` (default **$75**) and both accounts are onchain, it sends `fill_standing_order`.
4. Otherwise it inserts `approval_requests` with `status = pending`. That row is what the voice card reads (`usePendingApproval`). `POST /api/standing-orders/:id/approve` fills it. `POST .../decline` leaves the order open and will not offer that listing again.

Every branch writes a plain sentence to `agent_log`, for example `Skipped listing Abcd…wxyz: seller 3.1 stars (need 4+).`

Sellers with no `users.rating` use `DEFAULT_SELLER_RATING` (default 4.8, and the log says so). Set it to `none` to skip unrated sellers whenever the order asks for stars.

A purchase still goes through the program. The matcher cannot pay more than `max_price`, cannot buy a different event, and cannot spend a closed budget. Those checks are in `fill_standing_order`, not only here.

## Environment

See the Member B block in `app/.env.example`. Minimum for a real devnet loop:

- `NEXT_PUBLIC_USE_MOCK=false`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `RELAYER_SECRET_KEY` (the relayer JSON, server only)
- `STREAM_WEBHOOK_SECRET`
- `CRON_SECRET`
- `NEXT_PUBLIC_EVENTS_SOURCE=chain` for the live demo

`GET /api/health` reports which of those are present. It does not return secret values.

## Checks

```bash
cd app
npm run test:backend   # state machine, scam rules, English parser, webhook shapes
npm run lint
npm run build
```
