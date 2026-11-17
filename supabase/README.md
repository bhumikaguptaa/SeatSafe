# supabase/

Member B owns this folder.

1. In the [Supabase SQL editor](https://supabase.com/dashboard), run [`schema.sql`](schema.sql), then [`seed.sql`](seed.sql).
2. Enable Realtime is done by `schema.sql` (it adds the tracker tables to `supabase_realtime`). If the dashboard shows a warning, open Database → Publications → `supabase_realtime` and confirm `orders`, `order_events`, `chat_messages`, `agent_log`, `approval_requests`, `events`, `standing_orders` are listed.
3. Put `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `app/.env.local` and in Vercel. Never commit the service role key.

`seed.sql` copies `app/lib/mock.ts`, so the screens look the same the moment mocks are turned off.

For the **devnet demo**, Discover should show the onchain events (Neon Harbor, UT vs A&M, Battle of the Bands). Either skip `seed.sql`, or set `NEXT_PUBLIC_EVENTS_SOURCE=chain`. The order tracker still prefers a Supabase row and falls back to the escrow account, and it subscribes to Realtime so a QuickNode delivery shows up without a refresh.

The backend that writes these tables lives in `app/app/api` and `app/lib/server`. See [docs/backend.md](../docs/backend.md).
