-- High-gravity turns: a turn bigger than the brewhouse makes (e.g. 37.5 HL from a 25 HL
-- brewhouse) records how full the kettle is filled, for the Brew Day water balance. The wort is
-- diluted to the turn size at knockout (the last turn's dilution water).
alter table public.brew_bookings add column if not exists kettle_fill_l numeric;
alter table public.batches add column if not exists kettle_fill_l numeric;
