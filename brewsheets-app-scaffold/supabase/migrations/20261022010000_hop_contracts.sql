-- Hop contracts: what's still to come from each supplier, by contract year, so the hop
-- forecast can set it against need. Staff read; admins edit.
create table if not exists public.hop_contracts (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  agreement text,
  contract_year integer,
  hop text not null,               -- the ingredient name (Ingredients page / Unleashed)
  remaining_kg numeric(10,2) not null default 0,
  order_by date,                   -- must be ordered (shipped) by this date
  as_of date,                      -- date of the statement the remaining figure came from
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.hop_contracts enable row level security;
create policy "staff read" on public.hop_contracts for select to authenticated using (public.is_active_user());
create policy "admin insert" on public.hop_contracts for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.hop_contracts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.hop_contracts for delete to authenticated using (public.is_admin());

-- From Yakima Chief Hops / Cryer Malt AUSA100100225 (statement 22 Sep 2026) and Bintani 11391 (15 Oct 2026).
insert into public.hop_contracts (supplier, agreement, contract_year, hop, remaining_kg, order_by, as_of) values
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Amarillo T90 Hop Pellets - YCH', 720, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Citra Cryo Hop Pellets - YCH', 120, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Citra T90 Hop Pellets - YCH', 1300, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Idaho 7 T90 Hop Pellets - YCH', 40, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Krush', 120, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Mosaic Cryo Hop Pellets - YCH', 240, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Mosaic Dynaboost', 8, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Mosaic T90 Hop Pellets - YCH', 520, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2026, 'Simcoe Cryo Hop Pellets - YCH', 20, '2026-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2027, 'Amarillo T90 Hop Pellets - YCH', 500, '2027-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2027, 'Citra T90 Hop Pellets - YCH', 900, '2027-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2027, 'Krush', 100, '2027-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2027, 'Mosaic Cryo Hop Pellets - YCH', 140, '2027-12-31', '2026-09-22'),
  ('Yakima Chief Hops', 'AUSA100100225', 2027, 'Mosaic T90 Hop Pellets - YCH', 300, '2027-12-31', '2026-09-22'),
  ('Bintani', '11391', 2026, 'Hallertau Tradition', 60, '2027-02-28', '2026-10-15'),
  ('Bintani', '11391', 2026, 'Tettnang - Bintani', 60, '2027-02-28', '2026-10-15'),
  ('Bintani', '11391', 2026, 'US Columbus (CTZ)', 20, '2027-02-28', '2026-10-15'),
  ('Bintani', '11391', 2026, 'El Dorado - Bintani', 160, '2027-02-28', '2026-10-15'),
  ('Bintani', '11391', 2026, 'Strata - Bintani', 180, '2027-02-28', '2026-10-15');

-- Table privileges for signed-in users (RLS policies above still decide who can do what).
grant select, insert, update, delete on public.hop_contracts to authenticated;
