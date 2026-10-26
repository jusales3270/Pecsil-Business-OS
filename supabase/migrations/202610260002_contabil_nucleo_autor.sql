-- ============================================================================
-- Núcleo contábil (N-04): correção das funções de escrita (26/10/2026)
-- ============================================================================
-- Na 202610260001 a variável com o nome de quem age se chamava "nome", igual à coluna das contas: o importar
-- (que junta contas e vínculos) caía em "column reference nome is ambiguous". Mesmas funções, variável autor_nome.
-- ============================================================================

create or replace function public.contabil_lancamento_manual(p_plano uuid, p_data date, p_historico text, p_partidas jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); novo uuid; autor_nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão para lançar na contabilidade.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_historico, ''))) < 10 then raise exception 'O histórico explica o lançamento (10 caracteres ou mais).'; end if;
  novo := public.contabil_gravar_lancamento(org, p_plano, p_data, p_historico, 'manual', null, null, null, p_partidas, public.current_profile_id(), autor_nome);
  perform public.contabil_escrita_registrar(org, 'fiscal.lancamento_contabil.manual', 'contabil_lancamentos', novo, format('Lançamento manual em %s: %s', to_char(p_data, 'DD/MM/YYYY'), left(p_historico, 120)), jsonb_build_object('plano_id', p_plano));
  return novo;
end;
$$;

create or replace function public.contabil_estornar(p_lancamento uuid, p_data date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  l public.contabil_lancamentos;
  novo uuid;
  autor_nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão para estornar.' using errcode = '42501'; end if;
  select * into l from public.contabil_lancamentos where id = p_lancamento and organization_id = org;
  if l.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if l.origem_tipo = 'estorno' then raise exception 'Um estorno não se estorna: lance de novo.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Diga o motivo do estorno (10 caracteres ou mais).'; end if;
  novo := public.contabil_gravar_lancamento(org, l.plano_id, coalesce(p_data, l.data), format('Estorno: %s (motivo: %s)', l.historico, btrim(p_motivo)), 'estorno', null, null, l.id,
    (select jsonb_agg(jsonb_build_object('conta_id', conta_id, 'lado', case lado when 'D' then 'C' else 'D' end, 'valor', valor, 'centro_custo_id', centro_custo_id) order by ordem)
       from public.contabil_partidas where lancamento_id = l.id),
    public.current_profile_id(), autor_nome);
  if novo is null then raise exception 'Este lançamento já foi estornado.'; end if;
  perform public.contabil_escrita_registrar(org, 'fiscal.lancamento_contabil.estornado', 'contabil_lancamentos', l.id, format('Estornou o lançamento de %s: %s', to_char(l.data, 'DD/MM/YYYY'), left(p_motivo, 120)), jsonb_build_object('estorno_id', novo));
  return novo;
end;
$$;

create or replace function public.contabil_plano_importar(p_nome text, p_origem text, p_contas jsonb, p_vinculos jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  novo uuid;
  autor_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  n integer;
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão para importar plano de contas.' using errcode = '42501'; end if;
  insert into public.contabil_planos (organization_id, nome, origem, criado_por, criado_por_nome) values (org, btrim(p_nome), p_origem, public.current_profile_id(), autor_nome) returning id into novo;
  insert into public.contabil_contas (organization_id, plano_id, codigo, nome, natureza, tipo, nivel, superior_codigo, referencial)
  select org, novo, btrim(c->>'codigo'), btrim(c->>'nome'), c->>'natureza', c->>'tipo', (c->>'nivel')::integer, nullif(btrim(c->>'superior_codigo'), ''), nullif(btrim(c->>'referencial'), '')
  from jsonb_array_elements(p_contas) c;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'O plano veio sem contas.'; end if;
  -- Vínculos que já vêm com o plano (o de exemplo traz os papéis): [{origem, chave, codigo}]
  insert into public.contabil_vinculos (organization_id, plano_id, origem, chave, conta_id, situacao, atualizado_por_nome)
  select org, novo, v->>'origem', v->>'chave', c.id, 'proposto', autor_nome
  from jsonb_array_elements(coalesce(p_vinculos, '[]')) v join public.contabil_contas c on c.plano_id = novo and c.codigo = v->>'codigo' and c.tipo = 'analitica';
  perform public.contabil_escrita_registrar(org, 'fiscal.plano_contabil.importado', 'contabil_planos', novo, format('Importou o plano de contas "%s" (%s contas)', btrim(p_nome), n), jsonb_build_object('origem', p_origem, 'contas', n));
  return novo;
end;
$$;

create or replace function public.contabil_vincular(p_plano uuid, p_origem text, p_chave text, p_conta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); autor_nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = org) then raise exception 'Plano não encontrado.'; end if;
  if p_conta is null then
    delete from public.contabil_vinculos where plano_id = p_plano and origem = p_origem and chave = p_chave;
    return;
  end if;
  if not exists (select 1 from public.contabil_contas where id = p_conta and plano_id = p_plano and tipo = 'analitica' and ativa) then raise exception 'Escolha uma conta analítica deste plano.'; end if;
  insert into public.contabil_vinculos (organization_id, plano_id, origem, chave, conta_id, situacao, atualizado_por_nome, updated_at)
  values (org, p_plano, p_origem, p_chave, p_conta, 'confirmado', autor_nome, now())
  on conflict (plano_id, origem, chave) do update set conta_id = excluded.conta_id, situacao = 'confirmado', atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now();
end;
$$;

create or replace function public.contabil_periodo_definir(p_plano uuid, p_competencia text, p_fechar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); autor_nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = org) then raise exception 'Plano não encontrado.'; end if;
  if not p_fechar and length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Reabrir pede o motivo (10 caracteres ou mais).'; end if;
  insert into public.contabil_periodos (organization_id, plano_id, competencia, situacao, motivo, atualizado_por_nome, updated_at)
  values (org, p_plano, p_competencia, case when p_fechar then 'fechado' else 'aberto' end, nullif(btrim(coalesce(p_motivo, '')), ''), autor_nome, now())
  on conflict (plano_id, competencia) do update set situacao = excluded.situacao, motivo = excluded.motivo, atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now();
  perform public.contabil_escrita_registrar(org, case when p_fechar then 'fiscal.periodo_contabil.fechado' else 'fiscal.periodo_contabil.reaberto' end, 'contabil_periodos', p_plano,
    format('%s a competência %s%s', case when p_fechar then 'Fechou' else 'Reabriu' end, p_competencia, case when p_fechar then '' else ': ' || btrim(p_motivo) end), jsonb_build_object('competencia', p_competencia));
end;
$$;
