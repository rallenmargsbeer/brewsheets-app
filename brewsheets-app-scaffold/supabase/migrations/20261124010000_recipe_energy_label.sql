-- Inputs for the recipe's label energy statement (ABV, specific gravity, components g/100 g,
-- serving size and servings per package), used by the recipe page's energy calculator.
alter table public.recipes add column if not exists energy_label jsonb;
