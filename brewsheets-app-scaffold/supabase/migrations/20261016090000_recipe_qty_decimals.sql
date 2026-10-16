-- More decimals for per-litre recipe amounts, so small additions written per 25 HL keep their value.
alter table public.recipe_grist_items alter column qty_g_per_l type numeric(14,6);
alter table public.recipe_water_additions alter column qty_g_per_l type numeric(14,6);
alter table public.recipe_kettle_additions alter column qty_g_per_l type numeric(14,6);
alter table public.recipe_whirlpool_additions alter column qty_g_per_l type numeric(14,6);
alter table public.recipe_fermenter_additions alter column qty_g_per_l type numeric(14,6);
