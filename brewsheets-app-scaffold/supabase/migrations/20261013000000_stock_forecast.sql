-- Monthly sales forecast (entered by hand) and minimum stock per beer, for the brew plan
-- and the stock meeting. Seeded from the Brew Schedule Forecast tab of the 2026 schedule sheet. "Lager" in the sheet is the Draught.
create table if not exists public.stock_forecast (
  beer text not null,
  format text not null check (format in ('cube', 'keg')),
  month date not null,
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (beer, format, month)
);
create table if not exists public.stock_min (
  beer text not null,
  format text not null check (format in ('cube', 'keg')),
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (beer, format)
);
alter table public.stock_forecast enable row level security;
alter table public.stock_min enable row level security;
create policy "stock readers" on public.stock_forecast for select using (public.is_report_viewer() or public.is_schedule_editor());
create policy "editors insert" on public.stock_forecast for insert with check (public.is_schedule_editor());
create policy "editors update" on public.stock_forecast for update using (public.is_schedule_editor());
create policy "editors delete" on public.stock_forecast for delete using (public.is_schedule_editor());
create policy "stock readers" on public.stock_min for select using (public.is_report_viewer() or public.is_schedule_editor());
create policy "editors insert" on public.stock_min for insert with check (public.is_schedule_editor());
create policy "editors update" on public.stock_min for update using (public.is_schedule_editor());
create policy "editors delete" on public.stock_min for delete using (public.is_schedule_editor());
grant select, insert, update, delete on public.stock_forecast, public.stock_min to authenticated;
grant all on public.stock_forecast, public.stock_min to service_role;

-- Jul 2026 to Jun 2027, one number per month.
insert into public.stock_forecast (beer, format, month, qty)
select beer, format, (date '2026-07-01' + make_interval(months => i::int - 1))::date, q
from (values
  ('Pale Ale','cube',array[218,289,301,317,386,410,280,365,311,262,358,283]),
  ('Pale Ale','keg',array[34,41,38,40,44,56,48,50,50,43,39,39]),
  ('Kolsch','cube',array[198,151,182,240,251,267,217,237,176,199,202,196]),
  ('Kolsch','keg',array[92,88,115,124,119,173,136,128,122,125,113,109]),
  ('Mermid','cube',array[402,582,499,791,782,936,906,511,818,779,761,598]),
  ('Mermid','keg',array[68,55,66,97,93,163,123,85,98,88,56,68]),
  ('Red IPA','cube',array[217,174,160,165,181,202,161,133,143,172,167,162]),
  ('Red IPA','keg',array[23,18,15,12,14,25,10,16,19,27,16,16]),
  ('Stout','cube',array[129,83,94,72,85,64,37,69,84,104,129,156]),
  ('Stout','keg',array[16,3,9,14,9,3,6,5,6,13,8,14]),
  ('ITP','cube',array[978,1114,1323,1502,1822,1885,1604,1353,1474,1608,1500,1688]),
  ('ITP','keg',array[117,118,150,168,167,263,215,170,165,182,148,166]),
  ('Megsy','cube',array[399,393,411,593,718,807,830,685,514,556,591,516]),
  ('Megsy','keg',array[82,68,90,110,109,177,163,117,124,90,72,65]),
  ('Draught','cube',array[22,20,31,24,24,24,26,23,23,20,18,17]),
  ('Draught','keg',array[37,53,68,87,78,82,85,84,94,84,65,73]),
  ('River Dog','cube',array[338,309,336,388,501,514,356,436,349,342,353,343]),
  ('River Dog','keg',array[20,22,25,29,24,36,74,37,27,27,21,21])
) as f(beer, format, qty), unnest(qty) with ordinality as u(q, i)
where q > 0
on conflict do nothing;

insert into public.stock_min (beer, format, qty) values
  ('Pale Ale','cube',128),
  ('Pale Ale','keg',23),
  ('Kolsch','cube',208),
  ('Kolsch','keg',38),
  ('Mermid','cube',208),
  ('Mermid','keg',36),
  ('Red IPA','cube',62),
  ('Red IPA','keg',9),
  ('Stout','cube',40),
  ('Stout','keg',9),
  ('ITP','cube',288),
  ('ITP','keg',36),
  ('Megsy','cube',480),
  ('Megsy','keg',45),
  ('Draught','cube',20),
  ('Draught','keg',9),
  ('Brown','cube',20),
  ('Brown','keg',5),
  ('River Dog','cube',288),
  ('River Dog','keg',14)
on conflict do nothing;
