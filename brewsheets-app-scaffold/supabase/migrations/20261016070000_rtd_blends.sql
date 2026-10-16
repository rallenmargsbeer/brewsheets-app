-- RTD blends: recipe ingredients per litre of blend, and what went into each blend batch.
create table if not exists public.recipe_blend_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  sort_order int not null default 0,
  ingredient_name text not null,
  qty_per_l numeric not null,
  unit text,
  abv_pct numeric
);
create table if not exists public.batch_blend_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  sort_order int not null default 0,
  ingredient_name text not null,
  unit text,
  planned_qty numeric,
  actual_qty numeric,
  abv_pct numeric,
  added boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.recipe_blend_items enable row level security;
alter table public.batch_blend_items enable row level security;
create policy "open access - no auth yet" on public.recipe_blend_items for all using (true) with check (true);
create policy "open access - no auth yet" on public.batch_blend_items for all using (true) with check (true);
grant all on public.recipe_blend_items, public.batch_blend_items to anon, authenticated, service_role;
