-- Pressing Done on a pack-off session folds it up for good (until opened again).
alter table public.packaging_sessions add column if not exists closed_at timestamptz;
