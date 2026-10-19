-- Yeast generations: a fresh pitch is gen 0; repitching from another batch is that batch's gen + 1
-- (max gen 5). Null means fresh pitch.
alter table public.batches
  add column if not exists yeast_generation integer,
  add column if not exists yeast_source_batch_id uuid references public.batches(id) on delete set null,
  add column if not exists yeast_name text;
