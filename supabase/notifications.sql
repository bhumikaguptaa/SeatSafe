-- Owner: B to review, added by A.
-- In-app notifications triggered by the QuickNode Stream (lib/server/notify.ts, called from the webhook
-- pipeline in lib/server/apply-events.ts). Run AFTER schema.sql. Idempotent.
--
-- Access follows the existing schema: the server writes with the service role; anon/authenticated can read.
-- Users log in with Privy (not Supabase Auth), so there is no auth.uid() to scope rows to a wallet: clients
-- filter by `wallet` themselves (the bell subscribes with filter wallet=eq.<address>). Rows hold only what is
-- already public onchain (wallet, amounts, event name); titles never contain full addresses.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  kind text not null,
  title text not null,
  body text not null default '',
  url text,
  tx_signature text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_wallet_created_idx on public.notifications (wallet, created_at desc);
-- Duplicate Stream deliveries (or webhook retries) never double-notify.
create unique index if not exists notifications_once_idx on public.notifications (tx_signature, wallet, kind);

alter table public.notifications replica identity full;
alter table public.notifications enable row level security;
drop policy if exists public_read on public.notifications;
create policy public_read on public.notifications for select using (true);
grant select on public.notifications to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
