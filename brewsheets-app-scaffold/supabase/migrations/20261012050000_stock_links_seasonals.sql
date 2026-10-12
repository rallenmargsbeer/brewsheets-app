-- Links for seasonal / limited beers that weren't on the MC Naming Sheet.
insert into public.stock_products (beer, format, source, code) values
('Wander','cube','unleashed','Cube-Wander'), ('Wander','keg','unleashed','Keg-Wander'), ('Wander','cube','lm_3pl','Wander BOS 16x375'),
('Czech Pilsner','cube','unleashed','Cube-Czech Pilsner'), ('Czech Pilsner','keg','unleashed','Keg-Czech Pilsner'),
('Fatal Dose WCIPA','keg','unleashed','Keg-Fatal Dose WCIPA'), ('Margarita Cocktail','keg','unleashed','Keg-Margarita Cocktail'),
('Pink Pony','keg','unleashed','Keg-PinkPony'), ('Grape Expectations','keg','lm_3pl','KEG-GRAPEEXP'), ('Grape Expectations','keg','unleashed','Keg-Grape Expectations'),
('Beyond the Pines','keg','lm_wholesale','37179'),
('Panther Cream Blueberry & Coffee','keg','unleashed','30l Keg-Panther Cream Blueberry & Coffee 2026 Tatterang')
on conflict (source, code) do nothing;
