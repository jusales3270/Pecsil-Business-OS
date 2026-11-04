-- Diretoria nos responsáveis da Portaria (04/11/2026, pedido do proprietário): todo usuário ativo com o cargo Diretor
-- (Pessoas e Acessos › Diretoria) aparece sozinho em Responsável das visitas e em Destinatário dos recebidos, como
-- "Nome · Diretoria", sem marcação do RH. Deixou de ser diretor, foi desativado ou o acesso venceu: sai da lista.

create or replace function public.portaria_responsaveis()
returns table (nome text, setor text, tipo text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if org is null or not (public.has_feature('portaria.visitas') or public.has_feature('portaria.recebidos') or public.has_feature('rh.responsaveis')) then
    raise exception 'Sem permissão para ver os responsáveis.' using errcode = '42501';
  end if;
  return query
    select x.nome, x.setor, x.tipo from (
      select p.full_name as nome, 'Diretoria'::text as setor, 'diretor'::text as tipo
        from public.profiles p
       where p.organization_id = org and p.job_title = 'diretor' and p.status = 'active'
         and (p.access_expires_at is null or p.access_expires_at > now())
      union all
      select e.full_name, d.name, 'colaborador'
        from public.employees e join public.departments d on d.id = e.department_id
       where e.organization_id = org and e.responsavel_setor and e.active
      union all
      select q.nome, q.responsavel_setor, 'terceiro'
        from public.terceiros_quadro q
       where q.organization_id = org and q.ativo and q.responsavel_setor is not null
    ) x
    order by x.setor, x.nome;
end;
$$;

revoke all on function public.portaria_responsaveis() from public, anon;
grant execute on function public.portaria_responsaveis() to authenticated;
