-- ============================================================================
-- Núcleo contábil (N-04): código reduzido, grupo da DRE e saldo normal da conta (27/10/2026)
-- ============================================================================
-- O plano oficial da Pecsil (planilha da contadora) traz, além de código e nome: o código reduzido (o número curto
-- que o sistema do escritório usa nos lançamentos), a letra do grupo da DRE (A receita bruta, B deduções, C custos…;
-- a legenda é do escritório) e o lado em que a conta costuma ter saldo (D/C; as redutoras, como a depreciação
-- acumulada, têm o lado contrário ao do grupo). A importação passa a gravar os três, e contabil_plano_complementar
-- preenche um plano já importado pelo código da conta, sem apagar nem recriar contas (os vínculos ficam).
-- ============================================================================

alter table public.contabil_contas
  add column if not exists reduzido text check (reduzido is null or length(btrim(reduzido)) between 1 and 30),
  add column if not exists dre_grupo text check (dre_grupo is null or dre_grupo ~ '^[A-Z]{1,3}$'),
  add column if not exists saldo_normal text check (saldo_normal is null or saldo_normal in ('D', 'C'));
create unique index if not exists contabil_contas_reduzido on public.contabil_contas (plano_id, reduzido) where reduzido is not null;
comment on column public.contabil_contas.reduzido is 'Código reduzido do sistema do escritório (único no plano).';
comment on column public.contabil_contas.dre_grupo is 'Letra do grupo da DRE no plano do escritório (A, B, C…). A legenda vem do escritório.';
comment on column public.contabil_contas.saldo_normal is 'Lado em que a conta costuma ter saldo: D ou C. Redutora tem o lado contrário ao do grupo.';

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
  insert into public.contabil_contas (organization_id, plano_id, codigo, nome, natureza, tipo, nivel, superior_codigo, referencial, reduzido, dre_grupo, saldo_normal)
  select org, novo, btrim(c->>'codigo'), btrim(c->>'nome'), c->>'natureza', c->>'tipo', (c->>'nivel')::integer, nullif(btrim(c->>'superior_codigo'), ''), nullif(btrim(c->>'referencial'), ''),
    nullif(btrim(c->>'reduzido'), ''), nullif(upper(btrim(c->>'dre_grupo')), ''), nullif(upper(btrim(c->>'saldo_normal')), '')
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

-- Completa um plano já importado: reduzido, grupo da DRE, saldo normal e, se vier, a natureza. Casa pelo código;
-- campo ausente no item não muda. Conta que não existe no plano é ignorada e contada. p_contas: [{codigo, reduzido?, dre_grupo?, saldo_normal?, natureza?}]
create or replace function public.contabil_plano_complementar(p_plano uuid, p_contas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); p public.contabil_planos; n integer; total integer := jsonb_array_length(coalesce(p_contas, '[]'));
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into p from public.contabil_planos where id = p_plano and organization_id = org;
  if p.id is null then raise exception 'Plano não encontrado.'; end if;
  update public.contabil_contas c set
    reduzido = case when x ? 'reduzido' then nullif(btrim(x->>'reduzido'), '') else c.reduzido end,
    dre_grupo = case when x ? 'dre_grupo' then nullif(upper(btrim(x->>'dre_grupo')), '') else c.dre_grupo end,
    saldo_normal = case when x ? 'saldo_normal' then nullif(upper(btrim(x->>'saldo_normal')), '') else c.saldo_normal end,
    natureza = coalesce(nullif(x->>'natureza', ''), c.natureza)
  from jsonb_array_elements(coalesce(p_contas, '[]')) x
  where c.plano_id = p.id and c.codigo = btrim(x->>'codigo');
  get diagnostics n = row_count;
  perform public.contabil_escrita_registrar(org, 'fiscal.plano_contabil.complementado', 'contabil_planos', p.id,
    format('Completou o plano "%s": %s de %s contas (reduzido, grupo da DRE, saldo normal)', p.nome, n, total), jsonb_build_object('contas', n, 'recebidas', total));
  return jsonb_build_object('atualizadas', n, 'nao_encontradas', total - n);
end;
$$;
revoke all on function public.contabil_plano_complementar(uuid, jsonb) from public, anon;
grant execute on function public.contabil_plano_complementar(uuid, jsonb) to authenticated;
