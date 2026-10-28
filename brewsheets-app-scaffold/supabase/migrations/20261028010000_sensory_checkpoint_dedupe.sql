-- The old sensory app's nightly sync re-added retention checkpoints, so the copied data had up to
-- 7 of each. Keep one per batch and day count (run by hand in the SQL editor, 28 Oct), and don't
-- allow duplicates again.
delete from sensory_retention_checkpoints c
using (
  select id, row_number() over (partition by batch_id, days order by assessed desc, id) rn
  from sensory_retention_checkpoints
) d
where c.id = d.id and d.rn > 1
  and not exists (select 1 from sensory_tastings t where t.retention_checkpoint_id = c.id);

create unique index if not exists sensory_retention_checkpoints_batch_days
  on sensory_retention_checkpoints (batch_id, days);
