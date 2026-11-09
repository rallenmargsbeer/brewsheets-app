-- Every active app user can read stock (and refresh it: the stock-sync function now lets any
-- active user run it), not only report viewers and schedule editors.
create policy "active users read" on public.stock_items for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_sync_runs for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_sales for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_history for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_products for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_min for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_forecast for select to authenticated using (public.is_active_user());
