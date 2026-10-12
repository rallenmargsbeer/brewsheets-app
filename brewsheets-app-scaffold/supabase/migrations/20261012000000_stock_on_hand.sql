-- Stock on hand: pulled from Unleashed (read-only) and Liquid Mix by the stock-sync function.
create table if not exists public.stock_sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  trigger text,
  requested_by text,
  detail text
);

-- One row per product per location from the latest successful pull of each source.
create table if not exists public.stock_items (
  id bigserial primary key,
  run_id bigint references public.stock_sync_runs(id) on delete set null,
  source text not null check (source in ('unleashed', 'lm_3pl', 'lm_wholesale')),
  location text not null,
  code text not null,
  description text,
  product_group text,
  on_hand numeric not null default 0,
  allocated numeric not null default 0,
  on_order numeric not null default 0,
  available numeric not null default 0,
  pulled_at timestamptz not null default now()
);
create index if not exists stock_items_source_idx on public.stock_items (source, code);

-- Which beer and format each source's product code is.
create table if not exists public.stock_products (
  id bigserial primary key,
  beer text not null,
  format text not null check (format in ('cube', 'keg')),
  source text not null check (source in ('unleashed', 'lm_3pl', 'lm_wholesale')),
  code text not null,
  unique (source, code)
);

alter table public.stock_sync_runs enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_products enable row level security;

create policy "stock readers" on public.stock_sync_runs for select using (public.is_report_viewer() or public.is_schedule_editor());
create policy "stock readers" on public.stock_items for select using (public.is_report_viewer() or public.is_schedule_editor());
create policy "stock readers" on public.stock_products for select using (public.is_report_viewer() or public.is_schedule_editor());
create policy "editors insert" on public.stock_products for insert with check (public.is_schedule_editor());
create policy "editors update" on public.stock_products for update using (public.is_schedule_editor());
create policy "editors delete" on public.stock_products for delete using (public.is_schedule_editor());

grant select, insert, update, delete on public.stock_sync_runs, public.stock_items, public.stock_products to service_role;
grant usage, select on sequence public.stock_sync_runs_id_seq, public.stock_items_id_seq, public.stock_products_id_seq to service_role;
grant select on public.stock_sync_runs, public.stock_items to authenticated;
grant select, insert, update, delete on public.stock_products to authenticated;
grant usage, select on sequence public.stock_products_id_seq to authenticated;
insert into public.stock_products (beer, format, source, code) values
('8 Ball','cube','lm_3pl','8BALL16X375'),
('8 Ball','cube','lm_wholesale','8BALL16X375'),
('8 Ball','cube','unleashed','Cube-8 Ball Reracked'),
('8 Ball','keg','lm_3pl','KEG-8BALL'),
('8 Ball','keg','lm_wholesale','KEG-8BALL30'),
('Beyond the Pines','cube','lm_3pl','BEYOND16X375'),
('Beyond the Pines','cube','lm_wholesale','BEYOND16X375'),
('Brown','cube','lm_3pl','BROWN16X375'),
('Brown','cube','lm_wholesale','BROWN16X375'),
('Brown','cube','unleashed','Cube-Brown'),
('Brown','keg','unleashed','Keg-Brown'),
('Chill Pills','cube','lm_wholesale','CARPARK16X375'),
('Chill Pils','cube','lm_3pl','CHILLPILS16X375'),
('Chill Pils','cube','lm_wholesale','CHILLPILS16X375'),
('Criss Cross IPA','cube','lm_wholesale','CCNZIPA16X375'),
('Deep Dive','cube','lm_3pl','DDIVE16X375'),
('Deep Dive','cube','lm_wholesale','DDIVE16X375'),
('Deep Dive','cube','unleashed','Cube-Deep Dive Simcoe'),
('Double River Dog','cube','lm_3pl','DBLRIVER16X375'),
('Double River Dog','cube','lm_wholesale','DBLRIVER16x375'),
('ITP','cube','lm_3pl','INTHEPINES16X375'),
('ITP','cube','lm_wholesale','INTHEPINES16X375'),
('ITP','cube','unleashed','Cube-ITP'),
('ITP','keg','lm_3pl','KEG-INTHEPINES'),
('ITP','keg','lm_wholesale','KEG-INTHEPINES'),
('ITP','keg','unleashed','Keg-ITP'),
('Kolsch','cube','lm_3pl','KOLSCH16X375'),
('Kolsch','cube','lm_wholesale','KOLSCH16X375'),
('Kolsch','cube','unleashed','Cube-Kolsch'),
('Kolsch','keg','lm_3pl','KEG-KOLSCH'),
('Kolsch','keg','lm_wholesale','KEG-KOLSCH'),
('Kolsch','keg','unleashed','Keg-Kolsch'),
('Lager','cube','lm_3pl','LAGER16X375'),
('Lager','cube','lm_wholesale','LAGER16X375'),
('Lager','cube','unleashed','Cube-Lager'),
('Lager','keg','unleashed','Keg-Lager'),
('Megsy','cube','lm_3pl','MEGSY16X375'),
('Megsy','cube','lm_wholesale','MEGSY16X375'),
('Megsy','cube','unleashed','Cube-Megsy'),
('Megsy','keg','lm_3pl','KEG-MEGSY'),
('Megsy','keg','lm_wholesale','KEG-MEGSY'),
('Megsy','keg','unleashed','Keg-Megsy'),
('Mermid','cube','lm_3pl','MERMID16X375'),
('Mermid','cube','lm_wholesale','MERMID16X375'),
('Mermid','cube','unleashed','Cube-MerMid'),
('Mermid','keg','lm_3pl','KEG-MERMID'),
('Mermid','keg','lm_wholesale','KEG-MERMID'),
('Mermid','keg','unleashed','Keg-MerMid'),
('Pale Ale','cube','lm_3pl','PALE16X375'),
('Pale Ale','cube','lm_wholesale','PALE16X375'),
('Pale Ale','cube','unleashed','Cube-Pale Ale'),
('Pale Ale','keg','lm_3pl','KEG-PALE'),
('Pale Ale','keg','lm_wholesale','KEG-PALE'),
('Pale Ale','keg','unleashed','Keg-Pale Ale'),
('Panther Cream Whisky','cube','lm_3pl','PANTHER16X375ML'),
('Panther Cream Whisky','cube','lm_wholesale','PANTHER16X375ML'),
('Panther Cream','cube','lm_3pl','PANWHKCRM375ML'),
('Panther Cream','cube','lm_wholesale','PANWHKCRM375ML'),
('Panther Cream','cube','unleashed','Cube-Panther Cream2024'),
('Panther Cream','cube','unleashed','Cube-Rum Panther Cream'),
('Red IPA','cube','lm_3pl','REDIPA16X375'),
('Red IPA','cube','lm_wholesale','REDIPA16X375'),
('Red IPA','cube','unleashed','Cube-Red IPA'),
('Red IPA','keg','lm_3pl','KEG-REDIPA'),
('Red IPA','keg','lm_wholesale','KEG-REDIPA'),
('Red IPA','keg','unleashed','Keg-Red IPA'),
('River Dog','cube','lm_3pl','RIVER16X375'),
('River Dog','cube','lm_wholesale','RIVER16X375'),
('River Dog','cube','unleashed','Cube-River Dog'),
('River Dog','keg','lm_3pl','KEG-RIVER'),
('River Dog','keg','lm_wholesale','KEG-RIVER'),
('River Dog','keg','unleashed','Keg-River Dog'),
('Sessions','cube','lm_wholesale','CARPARK16X375'),
('Stout','cube','lm_3pl','STOUT16X375'),
('Stout','cube','lm_wholesale','STOUT16X375'),
('Stout','cube','unleashed','Cube- Stout'),
('Stout','keg','lm_3pl','KEG-STOUT'),
('Stout','keg','lm_wholesale','KEG-STOUT'),
('Stout','keg','unleashed','Keg-Stout')
on conflict (source, code) do nothing;