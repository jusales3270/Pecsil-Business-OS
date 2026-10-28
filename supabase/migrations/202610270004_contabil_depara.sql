-- ============================================================================
-- De-para do plano oficial com o Financeiro (Contábil-Fiscal, N-04 passo 5) (27/10/2026)
-- ============================================================================
-- O escritório tem uma conta por fornecedor (e pode ter por cliente): o vínculo passa a aceitar fornecedor e cliente.
-- A plataforma PROPÕE vínculos com a evidência (nome do cadastro, número da conta bancária, voto do histórico do
-- escritório) e a área confirma; o motor só usa vínculo confirmado. Proposta nunca passa por cima de vínculo
-- confirmado.
-- ============================================================================

alter table public.contabil_vinculos drop constraint if exists contabil_vinculos_origem_check;
alter table public.contabil_vinculos add constraint contabil_vinculos_origem_check
  check (origem in ('conta_gerencial', 'conta_bancaria', 'papel', 'fornecedor', 'cliente'));
alter table public.contabil_vinculos add column if not exists evidencia text check (evidencia is null or length(evidencia) <= 400);
comment on column public.contabil_vinculos.evidencia is 'Por que a plataforma propôs este vínculo (nome igual ao do cadastro, mesma conta bancária, voto do histórico). Fica depois de confirmado.';

-- Grava as propostas, pelo servidor. p_itens: [{origem, chave, conta_id, evidencia}]
create or replace function public.contabil_vinculos_propor(p_org uuid, p_plano uuid, p_itens jsonb, p_autor_nome text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = p_org) then raise exception 'Plano de contas não encontrado.'; end if;
  insert into public.contabil_vinculos (organization_id, plano_id, origem, chave, conta_id, situacao, evidencia, atualizado_por_nome, updated_at)
  select p_org, p_plano, x->>'origem', x->>'chave', (x->>'conta_id')::uuid, 'proposto', left(x->>'evidencia', 400), p_autor_nome, now()
  from jsonb_array_elements(coalesce(p_itens, '[]')) x
  join public.contabil_contas c on c.id = (x->>'conta_id')::uuid and c.plano_id = p_plano and c.tipo = 'analitica' and c.ativa
  on conflict (plano_id, origem, chave) do update set conta_id = excluded.conta_id, evidencia = excluded.evidencia, atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now()
    where contabil_vinculos.situacao = 'proposto' and (contabil_vinculos.conta_id, contabil_vinculos.evidencia) is distinct from (excluded.conta_id, excluded.evidencia);
  get diagnostics n = row_count;
  if n > 0 then
    perform public.contabil_escrita_registrar(p_org, 'fiscal.depara.proposto', 'contabil_vinculos', p_plano,
      format('%s: %s vínculo(s) proposto(s) para conferir', coalesce(p_autor_nome, 'Plataforma'), n), jsonb_build_object('propostos', n));
  end if;
  return n;
end;
$$;
revoke all on function public.contabil_vinculos_propor(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.contabil_vinculos_propor(uuid, uuid, jsonb, text) to service_role;

-- Confirmar propostas de uma vez (quem opera a Contabilidade). Só mexe no que está proposto.
create or replace function public.contabil_vinculos_confirmar(p_plano uuid, p_origem text, p_chaves text[])
returns integer language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); nome text := (select full_name from public.profiles where id = public.current_profile_id()); n integer;
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = org) then raise exception 'Plano não encontrado.'; end if;
  update public.contabil_vinculos set situacao = 'confirmado', atualizado_por_nome = nome, updated_at = now()
  where plano_id = p_plano and origem = p_origem and situacao = 'proposto' and chave = any(coalesce(p_chaves, '{}'));
  get diagnostics n = row_count;
  if n > 0 then
    perform public.contabil_escrita_registrar(org, 'fiscal.depara.confirmado', 'contabil_vinculos', p_plano,
      format('%s confirmou %s vínculo(s) proposto(s)', coalesce(nome, 'Alguém'), n), jsonb_build_object('origem', p_origem, 'confirmados', n));
  end if;
  return n;
end;
$$;
revoke all on function public.contabil_vinculos_confirmar(uuid, text, text[]) from public, anon;
grant execute on function public.contabil_vinculos_confirmar(uuid, text, text[]) to authenticated;
