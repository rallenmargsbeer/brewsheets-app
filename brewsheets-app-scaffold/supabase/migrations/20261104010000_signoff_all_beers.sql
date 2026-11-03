-- Packaging sign off for every beer in a brite tank, not just the core range in Sensory: a sign off
-- can belong to the production batch directly (seasonals have no sensory batch).
alter table public.sensory_brite_checks add column if not exists production_batch_id uuid references public.batches(id) on delete cascade;
alter table public.sensory_brite_checks alter column batch_id drop not null;
alter table public.sensory_brite_checks add constraint sensory_brite_checks_has_batch check (batch_id is not null or production_batch_id is not null);
update public.sensory_brite_checks c set production_batch_id = s.production_batch_id
from public.sensory_batches s where s.id = c.batch_id and c.production_batch_id is null and s.production_batch_id is not null;
