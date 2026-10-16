-- DAW (de-aerated water) added in the BBT, confirmed on the batch's Packaging page.
alter table public.batches add column if not exists daw_added_l numeric(8,1), add column if not exists daw_added_at timestamptz;
