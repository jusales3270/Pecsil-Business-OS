-- I-24 (31/10/2026): a SARA de um módulo bateu o teto do mês e parou. O proprietário, que responde pelos recursos,
-- é avisado uma vez por mês e módulo. Quem chama é a própria parada, e a função confere o uso: não dá para forçar o aviso.
create or replace function public.sara_aviso_teto_cheio(p_modulo text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  teto bigint;
  uso bigint := public.sara_uso_mes(p_modulo);
  chave text := p_modulo || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  dono record;
begin
  if org is null then return false; end if;
  select teto_tokens_mes into teto from public.sara_modulos where organization_id = org and modulo = p_modulo;
  if teto is null then teto := 2000000; end if;
  if teto <= 0 or uso < teto then return false; end if;
  if exists (select 1 from public.module_events where organization_id = org and event_type = 'sara.teto.atingido' and entity_id = chave) then return true; end if;
  perform public.emit_module_event(org, 'sara', 'sara.teto.atingido', 'sara_modulo', chave,
    format('A SARA (%s) atingiu o teto de uso do mês e parou', p_modulo), jsonb_build_object('modulo', p_modulo, 'uso', uso, 'teto', teto));
  for dono in select id from public.profiles where organization_id = org and is_owner and status = 'active' loop
    perform public.notify_profile(org, dono.id, 'sara', 'attention', format('SARA (%s) parou: teto do mês', p_modulo),
      'O uso deste mês chegou ao teto. A SARA deste módulo só volta no mês que vem ou quando o teto subir.',
      '/?view=O%20que%20a%20SARA%20aprendeu');
  end loop;
  return true;
end $$;
revoke all on function public.sara_aviso_teto_cheio(text) from public, anon;
grant execute on function public.sara_aviso_teto_cheio(text) to authenticated;
