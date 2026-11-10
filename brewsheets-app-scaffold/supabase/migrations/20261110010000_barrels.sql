-- Barrel ageing: a batch can leave the fermenter into barrels (status barrelled, no tank) and later
-- go to a brite tank as usual. Records when, how many litres and how many barrels.
alter table public.batches add column if not exists barrel_date date;
alter table public.batches add column if not exists barrel_l numeric;
alter table public.batches add column if not exists barrel_count integer;
alter table public.batches drop constraint if exists batches_status_check;
alter table public.batches add constraint batches_status_check check (status = any (array['planned','brewing','fermenting','chilling','conditioning','barrelled','packaged','archived']));
