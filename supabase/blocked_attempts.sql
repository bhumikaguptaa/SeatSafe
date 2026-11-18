-- Over-cap resale attempts the program rejected (AboveResaleCap), for the "scalpers blocked" stat on the
-- Discover ticker. Run AFTER schema.sql. Idempotent. No wallet or personal data: event, price, cap, time.
-- Written only by the server (/api/stats POST, service role); anyone can read; streamed by Realtime.

create table if not exists public.blocked_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id text,
  price_usd numeric,
  cap_usd numeric,
  at timestamptz not null default now()
);

create index if not exists blocked_attempts_at_idx on public.blocked_attempts (at desc);

alter table public.blocked_attempts enable row level security;
drop policy if exists public_read on public.blocked_attempts;
create policy public_read on public.blocked_attempts for select using (true);
grant select on public.blocked_attempts to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.blocked_attempts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
