-- ============================================================================
-- RH: acompanhar os terceiros registrados pela Portaria (só leitura)
-- ============================================================================
-- Os apontamentos de entrada e saída dos terceiros continuam exclusivos da
-- Portaria (`portaria.terceiros`). O RH ganha só a LEITURA, para acompanhar
-- quem está na fábrica e fechar o mês com o relatório de horas que vai ao
-- Financeiro. Nenhuma policy de escrita é criada para o RH.
-- ============================================================================

insert into public.access_features (code, module_code, label, levels, sort) values
  ('rh.terceiros',          'rh',         'Terceiros',            '{ver}',                75)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

drop policy if exists terceiros_read_rh on public.terceiros;
create policy terceiros_read_rh on public.terceiros for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.terceiros'));
