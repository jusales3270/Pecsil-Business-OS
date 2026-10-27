-- ============================================================================
-- Histórico contábil vindo da ECD do escritório (Contábil-Fiscal, N-04 passos 2 e 3) (27/10/2026)
-- ============================================================================
-- A ECD de um ano fechado (I200/I250) entra no plano como histórico só leitura: saldos de abertura do exercício e
-- cada lançamento do escritório, com o número dele na ECD (não entra duas vezes) e a marca de encerramento (a DRE
-- tira os lançamentos que zeram o resultado). O referencial da Receita (I051) completa as contas. Quem chama é o
-- servidor, depois de conferir fiscal.contabilidade operar; débito = crédito continua conferido no banco.
-- ============================================================================

alter table public.contabil_lancamentos drop constraint if exists contabil_lancamentos_origem_tipo_check;
alter table public.contabil_lancamentos add constraint contabil_lancamentos_origem_tipo_check
  check (origem_tipo in ('titulo', 'baixa', 'abertura', 'manual', 'estorno', 'historico_ecd'));
alter table public.contabil_lancamentos
  add column if not exists origem_ref text check (origem_ref is null or length(origem_ref) between 1 and 80),
  add column if not exists encerramento boolean not null default false;
create unique index if not exists contabil_lancamentos_ref on public.contabil_lancamentos (plano_id, origem_ref) where origem_ref is not null;
comment on column public.contabil_lancamentos.origem_ref is 'Referência externa única no plano: o número do lançamento na ECD do escritório (ecd:AAAA:nº) ou a abertura do exercício (ecd:AAAA:abertura).';
comment on column public.contabil_lancamentos.encerramento is 'Lançamento de encerramento do resultado (IND_LCTO = E na ECD): a DRE do período não o considera.';

-- Grava um lote do histórico. p_lote: [{data, historico, origem_tipo ('historico_ecd' | 'abertura'), origem_ref, encerramento, partidas:[{conta_id, lado, valor}]}]
create or replace function public.contabil_importar_lote(p_org uuid, p_plano uuid, p_lote jsonb, p_autor uuid, p_autor_nome text)
returns integer language plpgsql security definer set search_path = public as $$
declare l jsonb; p jsonb; novo uuid; n integer := 0; k integer; d numeric; c numeric;
begin
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = p_org) then raise exception 'Plano de contas não encontrado.'; end if;
  for l in select * from jsonb_array_elements(p_lote) loop
    if l->>'origem_tipo' not in ('historico_ecd', 'abertura') or coalesce(l->>'origem_ref', '') = '' then raise exception 'Lote de histórico inválido.'; end if;
    insert into public.contabil_lancamentos (organization_id, plano_id, data, competencia, historico, origem_tipo, origem_ref, encerramento, criado_por, criado_por_nome)
    values (p_org, p_plano, (l->>'data')::date, to_char((l->>'data')::date, 'YYYY-MM'), left(btrim(l->>'historico'), 500), l->>'origem_tipo', l->>'origem_ref',
      coalesce((l->>'encerramento')::boolean, false), p_autor, p_autor_nome)
    on conflict (plano_id, origem_ref) where origem_ref is not null do nothing
    returning id into novo;
    if novo is null then continue; end if;
    k := 0;
    for p in select * from jsonb_array_elements(l->'partidas') loop
      k := k + 1;
      insert into public.contabil_partidas (organization_id, lancamento_id, conta_id, lado, valor, ordem)
      values (p_org, novo, (p->>'conta_id')::uuid, p->>'lado', round((p->>'valor')::numeric, 2), k);
    end loop;
    select coalesce(sum(valor) filter (where lado = 'D'), 0), coalesce(sum(valor) filter (where lado = 'C'), 0) into d, c from public.contabil_partidas where lancamento_id = novo;
    if k < 2 or d <> c then raise exception 'Lançamento % sem partida dobrada: débitos % e créditos %.', l->>'origem_ref', d, c; end if;
    n := n + 1;
  end loop;
  if n > 0 then
    insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
    values (p_org, null, p_autor, 'fiscal', 'contabil_lancamentos.importado', 'contabil_planos', p_plano, 'medium', jsonb_build_object('lancamentos', n));
    perform public.emit_module_event(p_org, 'fiscal', 'fiscal.escrituracao.importada', 'contabil_planos', p_plano::text,
      format('%s: %s lançamento(s) importado(s) da ECD do escritório', coalesce(p_autor_nome, 'Plataforma'), n), jsonb_build_object('lancamentos', n));
  end if;
  return n;
end;
$$;
revoke all on function public.contabil_importar_lote(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.contabil_importar_lote(uuid, uuid, jsonb, uuid, text) to service_role;

-- Referencial da Receita (I051) nas contas do plano, pelo servidor. p_itens: [{conta_id, referencial}]
create or replace function public.contabil_plano_referencial(p_org uuid, p_plano uuid, p_itens jsonb, p_autor uuid, p_autor_nome text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = p_org) then raise exception 'Plano de contas não encontrado.'; end if;
  update public.contabil_contas c set referencial = nullif(btrim(x->>'referencial'), '')
  from jsonb_array_elements(coalesce(p_itens, '[]')) x
  where c.plano_id = p_plano and c.id = (x->>'conta_id')::uuid and c.referencial is distinct from nullif(btrim(x->>'referencial'), '');
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
    values (p_org, null, p_autor, 'fiscal', 'contabil_planos.complementado', 'contabil_planos', p_plano, 'medium', jsonb_build_object('referencial', n));
    perform public.emit_module_event(p_org, 'fiscal', 'fiscal.plano_contabil.complementado', 'contabil_planos', p_plano::text,
      format('%s: referencial da Receita em %s conta(s), da ECD do escritório', coalesce(p_autor_nome, 'Plataforma'), n), jsonb_build_object('referencial', n));
  end if;
  return n;
end;
$$;
revoke all on function public.contabil_plano_referencial(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.contabil_plano_referencial(uuid, uuid, jsonb, uuid, text) to service_role;
