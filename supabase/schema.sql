-- SeatSafe schema. Owner: Member B.
-- Apply in the Supabase SQL editor (or `supabase db query`). Then run seed.sql.
-- The service role key used by /api bypasses RLS. The anon key can only read.

create table if not exists public.users (
  id text primary key,
  wallet text,
  display_name text not null default '',
  rating numeric,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key,
  title text not null,
  category text not null check (category in ('concert', 'sports', 'campus')),
  venue text not null default '',
  city text not null default '',
  starts_at timestamptz not null,
  image_gradient text not null,
  price_from_usd numeric not null,
  resale_cap_usd numeric,
  royalty_bps integer not null default 0,
  organizer_name text not null default ''
);

-- Display data A's /api/event-meta already reads and writes.
create table if not exists public.event_meta (
  id text primary key,
  kind text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id text primary key,
  event_id text not null,
  section text not null default '',
  row_label text not null default '',
  seat text not null default '',
  tier smallint not null check (tier in (1, 2)),
  owner_id text not null,
  mint_address text
);

create table if not exists public.listings (
  id text primary key,
  ticket_id text,
  ticket_mint text,
  event_id text not null default '',
  seller_id text not null,
  seller_name text not null default '',
  seller_rating numeric,
  price_usd numeric not null,
  tier smallint not null check (tier in (1, 2)),
  bond_usd numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'cancelled', 'sold')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  listing_id text not null,
  event_id text not null default '',
  buyer_id text not null,
  seller_id text not null,
  amount_usd numeric not null,
  tier smallint not null check (tier in (1, 2)),
  state text not null check (state in ('HELD', 'IN_TRANSIT', 'CONFIRMED', 'RELEASED', 'REFUNDED', 'DISPUTED', 'SWAPPED')),
  ship_deadline timestamptz not null,
  confirm_deadline timestamptz not null,
  vault_address text
);

create table if not exists public.order_events (
  id text primary key,
  order_id text not null references public.orders (id) on delete cascade,
  type text not null check (type in ('FUNDED', 'TICKET_SENT', 'CONFIRMED', 'RELEASED', 'REFUNDED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'SWAPPED')),
  message text not null,
  tx_signature text,
  at timestamptz not null
);

create index if not exists order_events_order_id_idx on public.order_events (order_id, at);

create table if not exists public.standing_orders (
  id text primary key,
  user_id text not null,
  event_id text not null,
  quantity integer not null check (quantity > 0),
  max_price_usd numeric not null,
  min_seller_rating numeric not null default 0,
  deadline timestamptz not null,
  budget_usd numeric not null,
  status text not null check (status in ('DRAFT', 'OPEN', 'FILLED', 'EXPIRED', 'CANCELLED')),
  filled integer not null default 0,
  spent_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists standing_orders_open_idx on public.standing_orders (event_id, status);

-- Plain-English parse, waiting for the fan to lock the budget onchain.
create table if not exists public.standing_order_drafts (
  id text primary key,
  user_id text not null,
  event_id text,
  quantity integer,
  max_price_usd numeric,
  min_seller_rating numeric,
  deadline timestamptz,
  raw_text text not null,
  proposal jsonb not null,
  linked_order_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_log (
  id text primary key,
  standing_order_id text not null,
  kind text not null,
  message text not null,
  at timestamptz not null default now()
);

create index if not exists agent_log_order_idx on public.agent_log (standing_order_id, at);

-- One decision per standing order + listing, so a replayed webhook cannot fill twice.
create table if not exists public.standing_order_decisions (
  standing_order_id text not null,
  listing_id text not null,
  decision text not null,
  primary key (standing_order_id, listing_id)
);

create table if not exists public.approval_requests (
  id text primary key,
  standing_order_id text not null,
  listing_id text not null,
  price_usd numeric not null,
  quantity integer not null,
  seller_rating numeric not null,
  prompt text not null,
  detail text not null,
  total_usd numeric not null,
  status text not null check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now()
);

create index if not exists approval_requests_order_idx on public.approval_requests (standing_order_id, created_at desc);

create table if not exists public.chat_messages (
  id text primary key,
  order_id text not null,
  sender_id text not null,
  body text not null,
  risk text not null check (risk in ('low', 'high')),
  risk_reason text,
  at timestamptz not null default now()
);

create index if not exists chat_messages_order_idx on public.chat_messages (order_id, at);

create table if not exists public.processed_signatures (
  signature text primary key,
  slot bigint,
  event_count integer not null default 0,
  processed_at timestamptz not null default now()
);

create table if not exists public.relayer_alerts (
  id bigint generated always as identity primary key,
  sol numeric not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Realtime: the tracker, chat, agent log and voice-approval card subscribe here.
-- ---------------------------------------------------------------------------
alter table public.orders replica identity full;
alter table public.order_events replica identity full;
alter table public.chat_messages replica identity full;
alter table public.agent_log replica identity full;
alter table public.approval_requests replica identity full;
alter table public.events replica identity full;
alter table public.standing_orders replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'order_events', 'chat_messages', 'agent_log',
    'approval_requests', 'events', 'standing_orders'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS. Anon reads. Writes happen with the service role inside /api.
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.event_meta enable row level security;
alter table public.tickets enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.standing_orders enable row level security;
alter table public.standing_order_drafts enable row level security;
alter table public.agent_log enable row level security;
alter table public.standing_order_decisions enable row level security;
alter table public.approval_requests enable row level security;
alter table public.chat_messages enable row level security;
alter table public.processed_signatures enable row level security;
alter table public.relayer_alerts enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'events', 'event_meta', 'tickets', 'listings', 'orders', 'order_events',
    'standing_orders', 'agent_log', 'approval_requests', 'chat_messages'
  ]
  loop
    execute format('drop policy if exists public_read on public.%I', t);
    execute format('create policy public_read on public.%I for select using (true)', t);
  end loop;
end $$;

grant select on public.users, public.events, public.event_meta, public.tickets, public.listings,
  public.orders, public.order_events, public.standing_orders, public.agent_log,
  public.approval_requests, public.chat_messages
  to anon, authenticated;
