
-- When a contract line can first be drawn on (blank = now), e.g. the next crop.
alter table public.hop_contracts add column if not exists available_from date;
update public.hop_contracts set available_from = '2027-02-01' where supplier = 'Yakima Chief Hops' and contract_year = 2027;
