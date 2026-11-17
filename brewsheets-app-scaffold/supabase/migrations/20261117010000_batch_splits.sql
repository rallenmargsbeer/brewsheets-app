-- A beer split off another batch while fermenting or before filter (e.g. part of a batch with
-- different additions to make a new beer). The new beer is its own batch, linked to its parent.
alter table public.batches
  add column if not exists parent_batch_id uuid references public.batches(id) on delete set null,
  add column if not exists split_l numeric,
  add column if not exists split_date date;
create index if not exists batches_parent_batch on public.batches (parent_batch_id);
