-- Target ABV is entered on the recipe (shown on Batch Details).
alter table public.recipes add column if not exists target_abv numeric;
