-- Sales (from Unleashed, read-only) and daily stock snapshots, for weekly sales rates and weeks of cover.
create table if not exists public.stock_sales (
  id bigserial primary key,
  sale_date date not null,
  code text not null,
  customer text,
  qty numeric not null default 0
);
create index if not exists stock_sales_date_idx on public.stock_sales (sale_date);

create table if not exists public.stock_history (
  id bigserial primary key,
  snap_date date not null,
  source text not null,
  location text not null,
  code text not null,
  alt_code text,
  available numeric not null default 0
);
create index if not exists stock_history_date_idx on public.stock_history (snap_date, source);

alter table public.stock_sales enable row level security;
alter table public.stock_history enable row level security;
create policy "stock readers" on public.stock_sales for select using (public.is_report_viewer() or public.is_schedule_editor());
create policy "stock readers" on public.stock_history for select using (public.is_report_viewer() or public.is_schedule_editor());
grant select, insert, update, delete on public.stock_sales, public.stock_history to service_role;
grant usage, select on sequence public.stock_sales_id_seq, public.stock_history_id_seq to service_role;
grant select on public.stock_sales, public.stock_history to authenticated;
