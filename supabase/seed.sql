-- Seed matching app/lib/mock.ts so flipping NEXT_PUBLIC_USE_MOCK to "false"
-- still shows the same events, orders and the Zelle chat.
-- Deadlines are relative to insert time so the tracker countdown is alive.
-- For the devnet demo, leave this unapplied (or set NEXT_PUBLIC_EVENTS_SOURCE=chain)
-- so Discover reads the onchain events instead of these six rows.

insert into public.users (id, display_name, rating, verified) values
  ('user_me', 'You', 5.0, true),
  ('user_jordan', 'Jordan P.', 4.8, true),
  ('user_priya', 'Priya S.', 4.6, true),
  ('user_marcus', 'Marcus T.', 4.2, true),
  ('user_sam', 'Sam R.', 5.0, true),
  ('user_alex', 'Alex K.', 3.9, true)
on conflict (id) do update set display_name = excluded.display_name, rating = excluded.rating;

insert into public.events (id, title, category, venue, city, starts_at, image_gradient, price_from_usd, resale_cap_usd, royalty_bps, organizer_name) values
  ('evt_neon_harbor', 'Neon Harbor: Midnight Tides Tour', 'concert', 'Riverside Amphitheater', 'Austin, TX', '2026-11-21T20:00:00-06:00', 'bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900', 75, 120, 500, 'Neon Harbor'),
  ('evt_lila_vance', 'Lila Vance & The Static', 'concert', 'The Foundry Hall', 'Dallas, TX', '2026-12-05T19:30:00-06:00', 'bg-gradient-to-br from-orange-500 via-rose-600 to-red-900', 55, 90, 750, 'Static Sound Co.'),
  ('evt_ut_am', 'UT vs. A&M: Rivalry Game', 'sports', 'Memorial Stadium', 'Austin, TX', '2026-11-28T18:30:00-06:00', 'bg-gradient-to-br from-orange-600 via-amber-700 to-red-950', 85, 150, 300, 'UT Athletics'),
  ('evt_soccer', 'Austin Riverhawks vs. Dallas Comets', 'sports', 'Lakeside Park Stadium', 'Austin, TX', '2026-12-12T15:00:00-06:00', 'bg-gradient-to-br from-emerald-500 via-green-700 to-slate-900', 35, 60, 500, 'Riverhawks FC'),
  ('evt_winter_gala', 'Campus Lights Winter Gala', 'campus', 'Student Union Ballroom', 'Austin, TX', '2026-12-04T19:00:00-06:00', 'bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-950', 20, 30, 0, 'Student Activities Board'),
  ('evt_battle_bands', 'Battle of the Bands: Dorm Edition', 'campus', 'West Quad Lawn', 'Austin, TX', '2026-12-15T18:00:00-06:00', 'bg-gradient-to-br from-yellow-400 via-lime-600 to-teal-900', 10, null, 0, 'Campus Radio KSRF')
on conflict (id) do nothing;

insert into public.tickets (id, event_id, section, row_label, seat, tier, owner_id, mint_address) values
  ('tkt_01', 'evt_neon_harbor', 'GA', '-', '-', 1, 'user_me', 'MockMint1111111111111111111111111111111111'),
  ('tkt_02', 'evt_neon_harbor', '101', 'C', '12', 1, 'user_jordan', 'MockMint2222222222222222222222222222222222'),
  ('tkt_03', 'evt_neon_harbor', '101', 'C', '13', 1, 'user_jordan', 'MockMint3333333333333333333333333333333333'),
  ('tkt_04', 'evt_lila_vance', 'Floor', 'A', '4', 2, 'user_priya', null),
  ('tkt_05', 'evt_lila_vance', 'Balcony', 'F', '22', 2, 'user_me', null),
  ('tkt_06', 'evt_ut_am', '112', '28', '5', 2, 'user_marcus', null),
  ('tkt_07', 'evt_ut_am', '112', '28', '6', 2, 'user_marcus', null),
  ('tkt_08', 'evt_ut_am', 'Student', 'GA', '-', 1, 'user_me', 'MockMint8888888888888888888888888888888888'),
  ('tkt_09', 'evt_soccer', 'Supporters', 'B', '9', 1, 'user_sam', 'MockMint9999999999999999999999999999999999'),
  ('tkt_10', 'evt_soccer', '204', 'K', '17', 2, 'user_priya', null),
  ('tkt_11', 'evt_winter_gala', 'GA', '-', '-', 1, 'user_alex', 'MockMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  ('tkt_12', 'evt_battle_bands', 'Lawn', '-', '-', 1, 'user_alex', 'MockMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
on conflict (id) do nothing;

insert into public.listings (id, ticket_id, event_id, seller_id, seller_name, seller_rating, price_usd, tier, bond_usd, created_at) values
  ('lst_01', 'tkt_02', 'evt_neon_harbor', 'user_jordan', 'Jordan P.', 4.8, 110, 1, 0, '2026-11-14T16:05:00Z'),
  ('lst_02', 'tkt_03', 'evt_neon_harbor', 'user_jordan', 'Jordan P.', 4.8, 260, 1, 0, '2026-11-14T16:07:00Z'),
  ('lst_03', 'tkt_04', 'evt_lila_vance', 'user_priya', 'Priya S.', 4.6, 82, 2, 10, '2026-11-13T21:40:00Z'),
  ('lst_04', 'tkt_06', 'evt_ut_am', 'user_marcus', 'Marcus T.', 4.2, 95, 2, 15, '2026-11-15T02:10:00Z'),
  ('lst_05', 'tkt_07', 'evt_ut_am', 'user_marcus', 'Marcus T.', 4.2, 95, 2, 15, '2026-11-15T02:11:00Z'),
  ('lst_06', 'tkt_09', 'evt_soccer', 'user_sam', 'Sam R.', 5.0, 48, 1, 0, '2026-11-12T18:30:00Z'),
  ('lst_07', 'tkt_10', 'evt_soccer', 'user_priya', 'Priya S.', 4.6, 40, 2, 5, '2026-11-15T23:55:00Z'),
  ('lst_08', 'tkt_11', 'evt_winter_gala', 'user_alex', 'Alex K.', 3.9, 25, 1, 0, '2026-11-16T09:15:00Z')
on conflict (id) do nothing;

insert into public.orders (id, listing_id, event_id, buyer_id, seller_id, amount_usd, tier, state, ship_deadline, confirm_deadline, vault_address) values
  ('ord_held', 'lst_04', 'evt_ut_am', 'user_me', 'user_marcus', 95, 2, 'HELD', now() + interval '2 hours', now() + interval '26 hours', 'MockVau1tHe1d111111111111111111111111111111'),
  ('ord_transit', 'lst_03', 'evt_lila_vance', 'user_me', 'user_priya', 82, 2, 'IN_TRANSIT', now() - interval '1 hour', now() + interval '23 hours', 'MockVau1tTransit11111111111111111111111111'),
  ('ord_released', 'lst_06', 'evt_soccer', 'user_me', 'user_sam', 48, 1, 'RELEASED', '2026-11-15T20:00:00Z', '2026-11-15T20:00:00Z', null)
on conflict (id) do nothing;

insert into public.order_events (id, order_id, type, message, at) values
  ('oe_held_1', 'ord_held', 'FUNDED', 'You paid $95.00. It''s locked in the SeatSafe vault.', now() - interval '10 minutes'),
  ('oe_held_2', 'ord_held', 'FUNDED', 'Seller posted a $15.00 bond. They have 2 hours to send the ticket.', now() - interval '9 minutes'),
  ('oe_tr_1', 'ord_transit', 'FUNDED', 'You paid $82.00. It''s locked in the SeatSafe vault.', now() - interval '3 hours'),
  ('oe_tr_2', 'ord_transit', 'FUNDED', 'Seller posted a $10.00 bond.', now() - interval '3 hours' + interval '2 minutes'),
  ('oe_tr_3', 'ord_transit', 'TICKET_SENT', 'Seller sent the ticket to your email. Check it and confirm.', now() - interval '90 minutes'),
  ('oe_rel_1', 'ord_released', 'FUNDED', 'You paid $48.00.', '2026-11-15T19:58:10Z'),
  ('oe_rel_2', 'ord_released', 'SWAPPED', 'Ticket and payment swapped in one transaction.', '2026-11-15T19:58:12Z'),
  ('oe_rel_3', 'ord_released', 'RELEASED', 'Seller received $45.60 (artist royalty $2.40 paid automatically).', '2026-11-15T19:58:12Z')
on conflict (id) do nothing;

insert into public.standing_orders (id, user_id, event_id, quantity, max_price_usd, min_seller_rating, deadline, budget_usd, status, filled, spent_usd) values
  ('so_01', 'user_me', 'evt_ut_am', 2, 90, 4.0, '2026-11-27T23:59:00-06:00', 180, 'OPEN', 0, 0),
  ('so_02', 'user_me', 'evt_neon_harbor', 1, 100, 4.5, '2026-11-20T23:59:00-06:00', 100, 'FILLED', 1, 85)
on conflict (id) do nothing;

insert into public.agent_log (id, standing_order_id, kind, message, at) values
  ('alog_01', 'so_01', 'lock', 'Locked $180 in your SeatSafe budget vault.', now() - interval '20 minutes'),
  ('alog_02', 'so_01', 'seen', 'Seen 14 listings for UT vs. A&M: Rivalry Game.', now() - interval '19 minutes'),
  ('alog_03', 'so_01', 'skip', 'Skipped 3 listings from sellers under 4 stars.', now() - interval '18 minutes'),
  ('alog_04', 'so_02', 'filled', 'Filled 1 ticket at $85. $15 stays in the vault until the order closes.', now() - interval '2 hours')
on conflict (id) do nothing;

insert into public.chat_messages (id, order_id, sender_id, body, risk, risk_reason, at) values
  ('msg_01', 'ord_transit', 'user_me', 'Hi! Just paid. Are these the floor seats in row A?', 'low', null, now() - interval '170 minutes'),
  ('msg_02', 'ord_transit', 'user_priya', 'Yep, Floor A seat 4. Sending it over now.', 'low', null, now() - interval '150 minutes'),
  ('msg_03', 'ord_transit', 'user_priya', 'Actually can you cancel and just pay me on Zelle, faster that way', 'high', 'Asks to pay outside SeatSafe, so the payment would not be protected.', now() - interval '120 minutes'),
  ('msg_04', 'ord_transit', 'user_me', 'I''ll stick with SeatSafe, thanks.', 'low', null, now() - interval '115 minutes')
on conflict (id) do nothing;
