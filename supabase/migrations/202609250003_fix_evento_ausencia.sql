-- ============================================================================
-- Correção: aprovar ou reprovar ausência falhava para qualquer pessoa
-- ============================================================================
-- O gatilho que anuncia a decisão na trilha de eventos (202609210001) lia
-- `new.type`, mas a coluna se chama `absence_type`. O PL/pgSQL só confere o
-- nome da coluna na execução, então a migração passou e a falha só aparecia ao
-- decidir: o UPDATE inteiro era desfeito e a tela mostrava "sem permissão".
--
-- Aproveita para nomear os tipos de ausência criados em 202609250000.
-- ============================================================================

create or replace function public.events_rh_ausencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  person text;
  tipo text;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  select e.full_name into person from public.employees e where e.id = new.employee_id;
  tipo := case new.absence_type
    when 'vacation' then 'Férias'
    when 'time_bank' then 'Banco de horas'
    when 'medical_certificate' then 'Atestado médico'
    when 'leave' then 'Licença'
    when 'attendance_statement' then 'Consulta ou exame'
    when 'family_care' then 'Acompanhamento de familiar'
    when 'occupational_exam' then 'Exame ocupacional'
    when 'legal_leave' then 'Ausência legal'
    when 'justified_absence' then 'Ausência justificada'
    when 'inss_leave' then 'Afastamento INSS'
    when 'work_accident' then 'Acidente de trabalho'
    when 'maternity_leave' then 'Licença-maternidade'
    else new.absence_type::text end;
  perform public.emit_module_event(new.organization_id, 'rh',
    case new.status when 'approved' then 'rh.ausencia.aprovada' else 'rh.ausencia.reprovada' end,
    'ausencia', new.id::text,
    format('%s %s · %s · %s a %s',
      tipo,
      case new.status when 'approved' then 'aprovada' else 'reprovada' end,
      coalesce(person, 'colaborador'), to_char(new.start_date, 'DD/MM/YYYY'), to_char(new.end_date, 'DD/MM/YYYY')),
    jsonb_build_object('employee_id', new.employee_id, 'type', new.absence_type, 'start', new.start_date, 'end', new.end_date));
  return new;
end;
$$;

revoke all on function public.events_rh_ausencia() from public;
