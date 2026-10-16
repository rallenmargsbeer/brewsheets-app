-- Allow more than one fermentation reading per batch per day.
alter table public.fermentation_readings drop constraint if exists fermentation_readings_batch_id_reading_date_key;
