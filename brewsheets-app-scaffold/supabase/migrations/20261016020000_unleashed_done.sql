-- When each step was entered as an assembly in Unleashed (marked on the Unleashed tab).
alter table public.batches add column if not exists unl_bbt_done_at timestamptz;
alter table public.packaging_sessions add column if not exists unl_done_at timestamptz;
