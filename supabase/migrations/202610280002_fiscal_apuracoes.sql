-- ============================================================================
-- Apurações do Lucro Presumido: receita das notas e guias classificadas (Contábil-Fiscal, N-07 parte 2) (28/10/2026)
-- ============================================================================
-- A apuração do Presumido precisa da receita de cada nota de saída com TODOS os itens (a leitura do IBS/CBS guarda só
-- os itens com o grupo) e de saber o que cada guia paga: o tributo, o código da receita e o período de apuração. A
-- guia continua sendo enviada pelo portal como antes; a classificação vem do leitor do PDF (conferida por quem envia)
-- e pode ser corrigida depois, por quem opera o portal, o Escritório contábil ou a Contabilidade.
-- ============================================================================

alter table public.fiscal_ibscbs_notas add column if not exists receita jsonb;
comment on column public.fiscal_ibscbs_notas.receita is 'Receita da nota com todos os itens: vProd, vDesc, vFrete, vSeg, vOutro, vIPI, vICMSST, exportacao (CFOP 7xxx) e porCfop. Base do Lucro Presumido (N-07). Nulo = lida antes; a sincronização relê.';

alter table public.fiscal_guias
  add column if not exists tributo text check (tributo is null or tributo ~ '^[A-Z]{2,8}$'),
  add column if not exists codigo_receita text check (codigo_receita is null or codigo_receita ~ '^[0-9]{4}$'),
  add column if not exists periodo_apuracao date;
comment on column public.fiscal_guias.codigo_receita is 'Código da receita do DARF (2089 IRPJ presumido, 2372 CSLL presumido, 8109 PIS, 2172 COFINS…), para conferir a guia contra a apuração.';

create or replace function public.fiscal_guia_classificar(p_guia uuid, p_tributo text, p_codigo text, p_periodo date)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not (public.fiscal_portal_lado() is not null or public.has_feature('fiscal.escritorio', 'operar') or public.has_feature('fiscal.contabilidade', 'operar')) then
    raise exception 'Sem permissão para classificar a guia.' using errcode = '42501';
  end if;
  if p_codigo is not null and p_codigo !~ '^[0-9]{4}$' then raise exception 'O código da receita tem 4 dígitos.'; end if;
  update public.fiscal_guias set tributo = nullif(upper(btrim(coalesce(p_tributo, ''))), ''), codigo_receita = p_codigo, periodo_apuracao = p_periodo
  where id = p_guia and organization_id = org and situacao <> 'cancelada';
  if not found then raise exception 'Guia não encontrada.'; end if;
  perform public.contabil_escrita_registrar(org, 'fiscal.guia.classificada', 'fiscal_guias', p_guia,
    format('%s classificou a guia: %s%s', coalesce(nome, 'Alguém'), coalesce(upper(p_tributo), 'sem tributo'), coalesce(' · código ' || p_codigo, '')),
    jsonb_build_object('tributo', upper(p_tributo), 'codigo', p_codigo, 'periodo', p_periodo));
end;
$$;
revoke all on function public.fiscal_guia_classificar(uuid, text, text, date) from public, anon;
grant execute on function public.fiscal_guia_classificar(uuid, text, text, date) to authenticated;
