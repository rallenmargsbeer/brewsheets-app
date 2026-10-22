-- Yeast bank: yeast harvested into kegs from a fermenter, to repitch later. generation is the
-- gen it pitches as (the source batch's gen + 1). Kegs can be split across brews; kegs_left
-- counts down as brews take from it, and emptied_on is set once it's used up or tipped.
create table if not exists public.yeast_bank (
  id uuid primary key default gen_random_uuid(),
  source_batch_id uuid references public.batches(id) on delete set null,
  yeast_name text,
  generation integer not null,
  harvested_on date not null default current_date,
  kegs numeric(5,1) not null default 1,
  kegs_left numeric(5,1) not null default 1,
  notes text,
  emptied_on date,
  created_at timestamptz not null default now()
);
alter table public.yeast_bank enable row level security;
create policy "staff read" on public.yeast_bank for select to authenticated using (public.is_active_user());
create policy "staff insert" on public.yeast_bank for insert to authenticated with check (public.can_edit());
create policy "staff update" on public.yeast_bank for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy "staff delete" on public.yeast_bank for delete to authenticated using (public.can_edit());
grant select, insert, update, delete on public.yeast_bank to authenticated;

-- Which bank entry a batch was pitched from, and how many kegs it took (to give back if undone).
alter table public.batches
  add column if not exists yeast_bank_id uuid references public.yeast_bank(id) on delete set null,
  add column if not exists yeast_bank_kegs numeric(5,1);
