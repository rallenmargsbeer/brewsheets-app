-- Admin override for a batch's Actual OG (Batch Details); used instead of the turns' KO gravities.
alter table public.batches add column if not exists og_override numeric(5,2);
