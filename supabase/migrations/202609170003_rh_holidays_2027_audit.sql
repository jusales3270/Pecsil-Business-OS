-- ============================================================================
-- Pecsil Business OS — RH: feriados 2027 e auditoria do calendário
--
-- O calendário Secullum de 2027 (emitido em 17/09/2026) só trazia 01/01. Os
-- demais foram completados pelo padrão de 2026, com datas móveis recalculadas
-- pela Páscoa de 2027 (28/03): Sexta-feira Santa 26/03, Corpus Christi 27/05.
-- `source = 'derivado-2026'` marca o que a Rosana deve conferir quando o
-- Secullum publicar o oficial; ao salvar pelo formulário a origem vira 'rh'.
-- ============================================================================

insert into public.rh_holidays (organization_id, holiday_date, name, scope, location, source, source_label)
select o.id, v.holiday_date, v.name, v.scope, v.location, v.source, v.source_label
from public.organizations o
cross join (values
  (date '2027-01-01', 'Confraternização Universal',                   'nacional',    null,     'secullum-2027', 'Confrafternização Universal'),
  (date '2027-02-02', 'Aniversário de Itu',                           'municipal',   'Itu/SP', 'derivado-2026', null),
  (date '2027-03-26', 'Sexta-feira Santa',                            'nacional',    null,     'derivado-2026', null),
  (date '2027-04-21', 'Tiradentes',                                   'nacional',    null,     'derivado-2026', null),
  (date '2027-05-01', 'Dia do Trabalho',                              'nacional',    null,     'derivado-2026', null),
  (date '2027-05-27', 'Corpus Christi',                               'facultativo', null,     'derivado-2026', null),
  (date '2027-07-09', 'Revolução Constitucionalista',                 'estadual',    'SP',     'derivado-2026', null),
  (date '2027-09-07', 'Independência do Brasil',                      'nacional',    null,     'derivado-2026', null),
  (date '2027-10-12', 'Nossa Senhora Aparecida',                      'nacional',    null,     'derivado-2026', null),
  (date '2027-11-02', 'Finados',                                      'nacional',    null,     'derivado-2026', null),
  (date '2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional',    null,     'derivado-2026', null),
  (date '2027-12-25', 'Natal',                                        'nacional',    null,     'derivado-2026', null)
) as v(holiday_date, name, scope, location, source, source_label)
on conflict (organization_id, holiday_date) do nothing;

-- Auditoria: toda criação, alteração ou remoção de feriado vira audit_log com
-- o autor (mesma função das demais tabelas do RH). Criado depois da carga para
-- não registrar a importação inicial como ação de usuário.
drop trigger if exists rh_holidays_audit on public.rh_holidays;
create trigger rh_holidays_audit
  after insert or update or delete on public.rh_holidays
  for each row execute function public.audit_rh_mutation();
