-- Liquid Mix wholesale lists its own code and the vendor code in the opposite columns to 3PL;
-- keep both so either can be linked to a beer. Plus links for codes missing from the naming sheet.
alter table public.stock_items add column if not exists alt_code text;
insert into public.stock_products (beer, format, source, code) values
('ITP','keg','unleashed','20L Keg-ITP'), ('ITP','keg','unleashed','20L PET ITP Keg'),
('Kolsch','keg','unleashed','20L Keg-Kolsch'), ('Kolsch','keg','unleashed','30L Keg-Kolsch'),
('Mermid','keg','unleashed','20L Keg-Mermid'), ('Pale Ale','keg','unleashed','20L Keg-Pale Ale'),
('Red IPA','keg','unleashed','20L Keg-Red IPA'), ('Red IPA','keg','unleashed','30L Keg-Red IPA'),
('8 Ball','keg','unleashed','30l Keg-8 Ball'), ('8 Ball','keg','unleashed','Keg-8 Ball'),
('Beyond the Pines','cube','unleashed','Cube- Beyond the Pines'), ('Beyond the Pines','keg','unleashed','30l Keg Beyond the Pines'), ('Beyond the Pines','keg','lm_3pl','KEG-BEYOND'),
('Drift XPA','cube','unleashed','Cube-Drift'), ('Drift XPA','cube','unleashed','Cube-EE Drift'), ('Drift XPA','keg','unleashed','Keg-Drift'),
('Drift XPA','cube','lm_3pl','DRIFTXPA16X375'), ('Drift XPA','keg','lm_3pl','KEG-DRIFTXPA'), ('Drift XPA','cube','lm_wholesale','DRIFTXPA16X375'), ('Drift XPA','keg','lm_wholesale','KEG-DRIFTXPA'),
('Draught','cube','unleashed','Cube-Margs Draught'), ('Draught','keg','unleashed','Keg-Margs Draught'), ('Draught','keg','lm_3pl','KEG-MARGSDRAUGHT'), ('Draught','keg','lm_wholesale','KEG-MARGSDRAUGHT'),
('Panther Cream Whisky','keg','unleashed','30l Keg-Panther Cream Whisky'), ('Panther Cream Whisky','keg','unleashed','30l Keg-Panther Cream Whisky 2026')
on conflict (source, code) do nothing;
