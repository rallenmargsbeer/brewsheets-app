-- Malt colour for SRM estimates, and recipe IBU / SRM targets.
alter table public.ingredients add column if not exists color_lovibond numeric;
alter table public.recipes add column if not exists target_ibu numeric, add column if not exists target_srm numeric;
