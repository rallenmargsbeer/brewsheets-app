-- Unleashed warehouse transfers not yet completed are stored as source 'transit'.
alter table public.stock_items drop constraint if exists stock_items_source_check;
alter table public.stock_items add constraint stock_items_source_check check (source in ('unleashed', 'lm_3pl', 'lm_wholesale', 'transit'));
