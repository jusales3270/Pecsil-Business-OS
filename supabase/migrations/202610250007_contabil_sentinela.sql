-- ============================================================================
-- Sentinela (Contábil-Fiscal, N-02): o monitor que mantém os parâmetros legais atualizados
-- (25/10/2026, pedido do proprietário; desenho em docs/PLANO-CONTABIL-FISCAL.md §4)
-- ============================================================================
-- Coleta fontes oficiais (Receita, Comitê Gestor do IBS, Senado, Diário Oficial de SP, CONFAZ, eSocial,
-- NFS-e, PGFN, CARF, STF, STJ, TST, Banco Central, feriados) e a imprensa só como sinal. Cada item novo
-- passa pela triagem por regra; o que pode mudar regra vai para a extração (modelo, só texto público) e
-- vira PROPOSTA. Níveis (decisão do proprietário em 25/10/2026):
--   * automático: dado de API oficial (Selic, IPCA, INPC, feriados) entra na hora, com auditoria;
--   * assistido: o resto vira proposta e só vale com 1 clique de quem responde (tela ou Decisões para você);
--   * tese: julgamento, súmula ou solução de consulta atualiza a tese;
--   * sinal: imprensa e o que o modelo não conseguiu provar só avisam.
-- O envio por "Decisões para você" começa DESLIGADO: o proprietário liga quando quiser.
-- Tabelas globais, como os parâmetros: todas as empresas leem, só o servidor escreve; a curadoria aprova.
-- ============================================================================

create table if not exists public.contabil_sentinela_config (
  unica boolean primary key default true check (unica),
  enviar_decisoes boolean not null default false,
  janela_dias integer not null default 10 check (janela_dias between 1 and 60),
  max_extracoes_dia integer not null default 40 check (max_extracoes_dia between 0 and 500),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
insert into public.contabil_sentinela_config (unica) values (true) on conflict (unica) do nothing;
comment on table public.contabil_sentinela_config is 'Configuração da Sentinela (N-02): enviar propostas por Decisões para você (começa desligado), janela de itens novos e teto de extrações por dia.';

create table if not exists public.contabil_fontes (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  nome text not null,
  url text not null,
  formato text not null check (formato in ('feed', 'senado', 'doe_sp', 'bcb_sgs', 'feriados')),
  nivel text not null check (nivel in ('fonte_oficial', 'tribunal', 'dado_api', 'imprensa')),
  tribunal text,
  cadencia_min integer not null check (cadencia_min >= 10),
  silencio_horas integer not null default 168,
  ativa boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  nota text,
  ultima_coleta_em timestamptz,
  ultimo_item_em timestamptz,
  ultimo_erro text,
  ultimo_erro_em timestamptz,
  coletas integer not null default 0,
  itens integer not null default 0
);
comment on table public.contabil_fontes is 'Fontes da Sentinela, testadas em 25/10/2026 (docs/contabil/fontes-sentinela.md). Só o servidor escreve.';

create table if not exists public.contabil_itens (
  id uuid primary key default gen_random_uuid(),
  fonte_id text not null references public.contabil_fontes(id) on delete cascade,
  hash text not null unique,
  titulo text not null,
  url text not null,
  publicado_em timestamptz,
  coletado_em timestamptz not null default now(),
  resumo text check (resumo is null or char_length(resumo) <= 4000),
  triagem jsonb,
  situacao text not null check (situacao in ('historico', 'ignorado', 'analisado', 'proposta', 'sinal', 'erro'))
);
create index if not exists contabil_itens_fonte on public.contabil_itens (fonte_id, coletado_em desc);
comment on table public.contabil_itens is 'Cada item novo que a Sentinela viu numa fonte (título, link, resumo e a triagem por regra). O texto de imprensa não fica guardado.';

create table if not exists public.contabil_propostas (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.contabil_itens(id) on delete set null,
  fonte_id text references public.contabil_fontes(id) on delete set null,
  tipo text not null check (tipo in ('parametro', 'tese', 'sinal')),
  chave text,
  tese_id uuid references public.contabil_teses(id) on delete set null,
  titulo text not null,
  resumo text,
  valor_proposto jsonb,
  vigente_de date,
  norma text,
  url text not null,
  trecho text,
  confianca text not null check (confianca in ('alta', 'media', 'baixa')),
  origem text not null check (origem in ('modelo', 'regra')),
  modelo text,
  avisos text[] not null default '{}',
  chaves_triagem text[] not null default '{}',
  situacao text not null default 'aberta' check (situacao in ('aberta', 'aprovada', 'recusada', 'aplicada')),
  parametro_id uuid references public.contabil_parametros(id) on delete set null,
  decisao_id uuid,
  decidida_por_nome text,
  decidida_em timestamptz,
  nota text,
  horas_ate_proposta numeric(10,1),
  created_at timestamptz not null default now()
);
create index if not exists contabil_propostas_abertas on public.contabil_propostas (created_at desc) where situacao = 'aberta';
comment on table public.contabil_propostas is 'O que a Sentinela propõe mudar (parâmetro, tese) ou só avisa (sinal). Origem "modelo" = sugestão do modelo, com a confiança; uma pessoa aprova.';

create table if not exists public.contabil_sentinela_rodadas (
  id uuid primary key default gen_random_uuid(),
  iniciada_em timestamptz not null default now(),
  terminada_em timestamptz,
  situacao text not null default 'rodando' check (situacao in ('rodando', 'feita', 'falhou')),
  fontes integer not null default 0,
  itens_novos integer not null default 0,
  relevantes integer not null default 0,
  propostas integer not null default 0,
  automaticos integer not null default 0,
  extracoes integer not null default 0,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  erros jsonb not null default '[]'::jsonb
);

do $$
declare t text;
begin
  foreach t in array array['contabil_sentinela_config', 'contabil_fontes', 'contabil_itens', 'contabil_propostas', 'contabil_sentinela_rodadas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.contabil_pode_ver()))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Nova vigência JÁ CONFERIDA (uso interno: dado de API oficial e proposta aprovada). Mesma regra do conferir:
-- a versão conferida anterior fecha na véspera; a mesma versão em rascunho vira a conferida.
create or replace function public.contabil_aplicar_vigencia(
  p_chave text, p_titulo text, p_escopo text, p_uf text, p_mun text, p_valor jsonb, p_de date, p_ate date,
  p_fonte jsonb, p_confianca text, p_observacao text, p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  atual public.contabil_parametros;
  novo uuid;
begin
  select * into atual from public.contabil_parametros
  where chave = p_chave and escopo = p_escopo and uf is not distinct from p_uf and codigo_municipio is not distinct from p_mun and vigente_de = p_de
  for update;
  update public.contabil_parametros set vigente_ate = p_de - 1, updated_at = now()
  where chave = p_chave and escopo = p_escopo and uf is not distinct from p_uf and codigo_municipio is not distinct from p_mun
    and situacao = 'conferido' and vigente_de < p_de and (vigente_ate is null or vigente_ate >= p_de);
  if atual.id is not null then
    update public.contabil_parametros
    set valor = p_valor, vigente_ate = p_ate, fonte = p_fonte, confianca = p_confianca, observacao = coalesce(p_observacao, observacao),
        situacao = 'conferido', conferido_por = public.current_profile_id(), conferido_por_nome = p_nome, conferido_em = now(), updated_at = now()
    where id = atual.id;
    return atual.id;
  end if;
  insert into public.contabil_parametros (chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, situacao, origem,
    conferido_por, conferido_por_nome, conferido_em, criado_por_nome)
  values (p_chave, p_titulo, p_escopo, p_uf, p_mun, p_valor, p_de, p_ate, p_fonte, p_confianca, p_observacao, 'conferido', 'sentinela',
    public.current_profile_id(), p_nome, now(), p_nome)
  returning id into novo;
  return novo;
end;
$$;
revoke all on function public.contabil_aplicar_vigencia(text, text, text, text, text, jsonb, date, date, jsonb, text, text, text) from public, anon, authenticated;

-- Dado de API oficial (nível automático). Só o servidor chama. Igual ao que já está: não faz nada.
create or replace function public.contabil_sentinela_automatico(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  existente public.contabil_parametros;
  v_id uuid;
begin
  select * into existente from public.contabil_parametros
  where chave = p ->> 'chave' and escopo = 'legal' and vigente_de = (p ->> 'vigente_de')::date and situacao = 'conferido';
  if existente.id is not null and existente.valor = p -> 'valor' then return null; end if;
  v_id := public.contabil_aplicar_vigencia(p ->> 'chave', p ->> 'titulo', 'legal', null, null, p -> 'valor', (p ->> 'vigente_de')::date,
    nullif(p ->> 'vigente_ate', '')::date, p -> 'fonte', 'alta', p ->> 'observacao', 'Sentinela (API oficial)');
  perform public.contabil_registrar('fiscal.parametro.automatico', 'contabil_parametros', v_id,
    format('Sentinela atualizou "%s" pela API oficial (%s)', p ->> 'titulo', p ->> 'competencia'),
    jsonb_build_object('chave', p ->> 'chave', 'vigente_de', p ->> 'vigente_de', 'fonte', p -> 'fonte', 'valor', p -> 'valor'));
  return v_id;
end;
$$;
revoke all on function public.contabil_sentinela_automatico(jsonb) from public, anon, authenticated;
grant execute on function public.contabil_sentinela_automatico(jsonb) to service_role;

-- Aplicar uma proposta (uso interno: a curadoria pela tela ou quem responde pela área, por Decisões para você).
create or replace function public.contabil_proposta_aplicar(p_id uuid, p_nome text, p_valor jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  pr public.contabil_propostas;
  base public.contabil_parametros;
  v_valor jsonb;
  v_param uuid;
  t public.contabil_teses;
begin
  select * into pr from public.contabil_propostas where id = p_id for update;
  if pr.id is null then raise exception 'Proposta não encontrada.'; end if;
  if pr.situacao <> 'aberta' then raise exception 'Esta proposta já foi decidida (%).', pr.situacao; end if;
  if pr.tipo = 'parametro' then
    v_valor := coalesce(p_valor, pr.valor_proposto);
    if v_valor is null or pr.vigente_de is null then
      raise exception 'Esta proposta não traz o valor ou a data: abra "Nova vigência" e preencha pela norma.';
    end if;
    select * into base from public.contabil_parametros where chave = pr.chave order by (situacao = 'conferido') desc, vigente_de desc limit 1;
    if base.id is null then raise exception 'Parâmetro % não existe.', pr.chave; end if;
    v_param := public.contabil_aplicar_vigencia(pr.chave, base.titulo, base.escopo, base.uf, base.codigo_municipio, v_valor, pr.vigente_de, null,
      jsonb_build_object('norma', coalesce(pr.norma, pr.titulo), 'url', pr.url, 'trecho', pr.trecho), pr.confianca,
      'Aplicado pela Sentinela a partir da proposta ' || pr.id::text, p_nome);
    update public.contabil_propostas set situacao = 'aplicada', parametro_id = v_param, decidida_por_nome = p_nome, decidida_em = now() where id = pr.id;
    perform public.contabil_registrar('fiscal.parametro.conferido', 'contabil_parametros', v_param,
      format('%s aprovou a proposta da Sentinela para "%s" (vigência desde %s)', coalesce(p_nome, 'Alguém'), base.titulo, to_char(pr.vigente_de, 'DD/MM/YYYY')),
      jsonb_build_object('chave', pr.chave, 'proposta', pr.id, 'vigente_de', pr.vigente_de, 'norma', pr.norma, 'url', pr.url, 'origem', pr.origem));
  elsif pr.tipo = 'tese' then
    select * into t from public.contabil_teses where id = pr.tese_id for update;
    if t.id is null then raise exception 'Tese não encontrada.'; end if;
    v_valor := coalesce(p_valor, pr.valor_proposto, '{}'::jsonb);
    update public.contabil_teses set
      situacao = coalesce(nullif(v_valor ->> 'situacao', ''), situacao),
      modulacao = coalesce(nullif(v_valor ->> 'modulacao', ''), modulacao),
      fontes = case when pr.url = any (fontes) then fontes else array_append(fontes, pr.url) end,
      conferida_por = public.current_profile_id(), conferida_por_nome = p_nome, conferida_em = now(), updated_at = now()
    where id = t.id;
    update public.contabil_propostas set situacao = 'aplicada', decidida_por_nome = p_nome, decidida_em = now() where id = pr.id;
    perform public.contabil_registrar('fiscal.parametro.tese_conferida', 'contabil_teses', t.id,
      format('%s aprovou a atualização da tese %s %s pela Sentinela', coalesce(p_nome, 'Alguém'), t.tribunal, t.tema),
      jsonb_build_object('tribunal', t.tribunal, 'tema', t.tema, 'proposta', pr.id, 'situacao', v_valor ->> 'situacao', 'url', pr.url));
  else
    update public.contabil_propostas set situacao = 'aprovada', decidida_por_nome = p_nome, decidida_em = now() where id = pr.id;
  end if;
end;
$$;
revoke all on function public.contabil_proposta_aplicar(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.contabil_proposta_recusar_interno(p_id uuid, p_nome text, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.contabil_propostas;
begin
  select * into pr from public.contabil_propostas where id = p_id for update;
  if pr.id is null then raise exception 'Proposta não encontrada.'; end if;
  if pr.situacao <> 'aberta' then return; end if;
  update public.contabil_propostas set situacao = 'recusada', nota = nullif(btrim(coalesce(p_nota, '')), ''), decidida_por_nome = p_nome, decidida_em = now() where id = pr.id;
  if pr.tipo <> 'sinal' then
    perform public.contabil_registrar('fiscal.parametro.proposta_recusada', 'contabil_propostas', pr.id,
      format('%s recusou a proposta da Sentinela "%s"', coalesce(p_nome, 'Alguém'), pr.titulo),
      jsonb_build_object('tipo', pr.tipo, 'chave', pr.chave, 'url', pr.url, 'nota', p_nota));
  end if;
end;
$$;
revoke all on function public.contabil_proposta_recusar_interno(uuid, text, text) from public, anon, authenticated;

-- A curadoria pela tela.
create or replace function public.contabil_proposta_aprovar(p_id uuid, p_valor jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.contabil_pode_curar() then raise exception 'Só a curadoria aprova propostas da Sentinela.' using errcode = '42501'; end if;
  perform public.contabil_proposta_aplicar(p_id, (select full_name from public.profiles where id = public.current_profile_id()), p_valor);
end;
$$;
create or replace function public.contabil_proposta_recusar(p_id uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.contabil_pode_curar() then raise exception 'Só a curadoria recusa propostas da Sentinela.' using errcode = '42501'; end if;
  perform public.contabil_proposta_recusar_interno(p_id, (select full_name from public.profiles where id = public.current_profile_id()), p_nota);
end;
$$;
revoke all on function public.contabil_proposta_aprovar(uuid, jsonb) from public, anon;
revoke all on function public.contabil_proposta_recusar(uuid, text) from public, anon;
grant execute on function public.contabil_proposta_aprovar(uuid, jsonb) to authenticated;
grant execute on function public.contabil_proposta_recusar(uuid, text) to authenticated;

-- Quem responde pela área responde em Decisões para você (quando o envio estiver ligado).
create or replace function public.contabil_proposta_pela_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.origem <> 'contabil.sentinela' or new.resposta is null or new.resposta is not distinct from old.resposta then return new; end if;
  begin v_id := substring(new.chave from 11)::uuid; exception when others then return new; end;
  if new.resposta = 'Aprovar' then
    begin
      perform public.contabil_proposta_aplicar(v_id, new.para_nome, null);
    exception when others then
      -- A decisão fica registrada; a proposta continua aberta na tela com o motivo.
      update public.contabil_propostas set avisos = array_append(avisos, 'aprovada em Decisões para você, mas não aplicou: ' || sqlerrm) where id = v_id;
    end;
  elsif new.resposta = 'Recusar' then
    perform public.contabil_proposta_recusar_interno(v_id, new.para_nome, new.nota);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_contabil_proposta_pela_decisao on public.decisoes;
create trigger trg_contabil_proposta_pela_decisao after update of resposta on public.decisoes
for each row execute function public.contabil_proposta_pela_decisao();

-- "Nova vigência" aberta a partir de uma proposta sem valor: a proposta fica ligada ao rascunho criado.
create or replace function public.contabil_parametro_propor(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  novo uuid;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
  base public.contabil_parametros;
  v_chave text := p ->> 'chave';
  v_escopo text := coalesce(p ->> 'escopo', 'legal');
  v_uf text := nullif(upper(btrim(coalesce(p ->> 'uf', ''))), '');
  v_mun text := nullif(regexp_replace(coalesce(p ->> 'codigo_municipio', ''), '\D', '', 'g'), '');
  v_proposta uuid := nullif(p ->> 'proposta_id', '')::uuid;
begin
  if not public.contabil_pode_curar() then
    raise exception 'Só a curadoria propõe parâmetros legais.' using errcode = '42501';
  end if;
  if not (p ? 'valor') then raise exception 'Informe o valor.'; end if;
  select * into base from public.contabil_parametros where chave = v_chave order by vigente_de desc limit 1;
  insert into public.contabil_parametros (chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, origem, criado_por, criado_por_nome)
  values (v_chave, coalesce(nullif(btrim(p ->> 'titulo'), ''), base.titulo, v_chave), v_escopo,
    case when v_escopo = 'legal' then null else v_uf end, case when v_escopo = 'municipio' then v_mun else null end,
    p -> 'valor', (p ->> 'vigente_de')::date, nullif(p ->> 'vigente_ate', '')::date,
    jsonb_build_object('norma', btrim(p ->> 'norma'), 'url', btrim(p ->> 'url'), 'trecho', nullif(btrim(coalesce(p ->> 'trecho', '')), '')),
    coalesce(p ->> 'confianca', 'media'), nullif(btrim(coalesce(p ->> 'observacao', '')), ''),
    case when v_proposta is not null then 'sentinela' else coalesce(nullif(p ->> 'origem', ''), 'manual') end, public.current_profile_id(), nome)
  returning id into novo;
  if v_proposta is not null then
    update public.contabil_propostas set situacao = 'aplicada', parametro_id = novo, decidida_por_nome = nome, decidida_em = now()
    where id = v_proposta and situacao = 'aberta';
  end if;
  perform public.contabil_registrar('fiscal.parametro.proposto', 'contabil_parametros', novo,
    format('%s propôs nova vigência para "%s" a partir de %s', coalesce(nome, 'Alguém'), coalesce(base.titulo, v_chave), to_char((p ->> 'vigente_de')::date, 'DD/MM/YYYY')),
    jsonb_build_object('chave', v_chave, 'escopo', v_escopo, 'vigente_de', p ->> 'vigente_de', 'norma', p ->> 'norma', 'url', p ->> 'url', 'proposta', v_proposta));
  return novo;
end;
$$;

-- Ligar o envio por Decisões para você e os limites: só o proprietário.
create or replace function public.contabil_sentinela_config_salvar(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Só o proprietário muda a configuração da Sentinela.' using errcode = '42501'; end if;
  update public.contabil_sentinela_config set
    enviar_decisoes = coalesce((p ->> 'enviar_decisoes')::boolean, enviar_decisoes),
    janela_dias = coalesce((p ->> 'janela_dias')::integer, janela_dias),
    max_extracoes_dia = coalesce((p ->> 'max_extracoes_dia')::integer, max_extracoes_dia),
    updated_at = now(), updated_by_name = (select full_name from public.profiles where id = public.current_profile_id());
end;
$$;
revoke all on function public.contabil_sentinela_config_salvar(jsonb) from public, anon;
grant execute on function public.contabil_sentinela_config_salvar(jsonb) to authenticated;

-- As fontes da v1 (testadas em 25/10/2026). As que exigem cadastro ou navegador ficam desligadas, com a nota.
insert into public.contabil_fontes (id, nome, url, formato, nivel, tribunal, cadencia_min, silencio_horas, ativa, config, nota) values
  ('rfb_noticias', 'Receita Federal: notícias', 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/RSS', 'feed', 'fonte_oficial', null, 30, 72, true, '{}', null),
  ('cgibs', 'Comitê Gestor do IBS: notícias', 'https://www.cgibs.gov.br/rss', 'feed', 'fonte_oficial', null, 60, 168, true, '{}', null),
  ('senado_legislacao', 'Senado: leis, leis complementares, medidas provisórias e decretos', 'https://legis.senado.leg.br/dadosabertos/legislacao/lista.json', 'senado', 'fonte_oficial', null, 720, 336, true, '{"tipos": ["LEI", "LCP", "MPV", "DEC"]}', null),
  ('confaz', 'CONFAZ: convênios, ajustes e atos', 'https://www.confaz.fazenda.gov.br/@@search_rss?portal_type=Document&sort_on=created&sort_order=reverse', 'feed', 'fonte_oficial', null, 720, 336, true, '{}', 'O filtro por pasta da pesquisa devolvia vazio; o filtro por tipo de documento traz os atos novos.'),
  ('esocial', 'eSocial: documentação técnica', 'https://www.gov.br/esocial/pt-br/@@search_rss?SearchableText=*&sort_on=modified&sort_order=reverse&path=/esocial/pt-br/documentacao-tecnica', 'feed', 'fonte_oficial', null, 1440, 720, true, '{}', null),
  ('nfse', 'NFS-e nacional: notícias e documentação', 'https://www.gov.br/nfse/pt-br/@@search_rss?SearchableText=*&sort_on=Date&sort_order=reverse', 'feed', 'fonte_oficial', null, 720, 720, true, '{}', null),
  ('pgfn', 'PGFN: pareceres e dispensa de contestar', 'https://www.gov.br/pgfn/pt-br/@@search_rss?SearchableText=*&sort_on=Date&sort_order=reverse', 'feed', 'fonte_oficial', null, 1440, 720, true, '{}', null),
  ('doe_sp', 'Diário Oficial de SP: atos da Fazenda', 'https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications', 'doe_sp', 'fonte_oficial', null, 1440, 168, true, '{"termos": ["ICMS", "Comunicado SRE", "Portaria SRE", "Resolução SFP", "Decreto"]}', 'Só atos normativos da Fazenda; autuações de contribuintes (com CNPJ e endereço) ficam fora.'),
  ('carf', 'CARF: notícias (súmulas e pautas)', 'https://carf.economia.gov.br/noticias/ultimas-noticias/RSS', 'feed', 'tribunal', 'CARF', 1440, 720, true, '{}', null),
  ('stf', 'STF: notícias', 'https://noticias.stf.jus.br/feed/', 'feed', 'tribunal', 'STF', 60, 48, true, '{}', null),
  ('stj', 'STJ: notícias', 'https://res.stj.jus.br/hrestp-c-portalp/RSS.xml', 'feed', 'tribunal', 'STJ', 60, 72, true, '{}', null),
  ('tst', 'TST: notícias', 'https://www.tst.jus.br/rss', 'feed', 'tribunal', 'TST', 120, 168, true, '{}', null),
  ('bcb_selic', 'Banco Central: Selic acumulada no mês', 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados/ultimos/3?formato=json', 'bcb_sgs', 'dado_api', null, 1440, 1080, true, '{"chave": "selic_mensal", "titulo": "Selic acumulada no mês (juros de mora federais)", "norma": "Banco Central, série SGS 4390 (Lei 9.430/1996, art. 61 §3º)"}', null),
  ('bcb_ipca', 'Banco Central: IPCA mensal', 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/3?formato=json', 'bcb_sgs', 'dado_api', null, 1440, 1080, true, '{"chave": "ipca_mensal", "titulo": "IPCA mensal", "norma": "Banco Central, série SGS 433 (IBGE)"}', null),
  ('bcb_inpc', 'Banco Central: INPC mensal', 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.188/dados/ultimos/3?formato=json', 'bcb_sgs', 'dado_api', null, 1440, 1080, true, '{"chave": "inpc_mensal", "titulo": "INPC mensal", "norma": "Banco Central, série SGS 188 (IBGE)"}', null),
  ('feriados', 'Feriados nacionais (BrasilAPI)', 'https://brasilapi.com.br/api/feriados/v1/', 'feriados', 'dado_api', null, 10080, 10080, true, '{"chave": "feriados_nacionais_lista", "titulo": "Feriados nacionais do ano"}', null),
  ('contabeis', 'Portal Contábeis (imprensa: só sinal)', 'https://www.contabeis.com.br/rss/conteudo/', 'feed', 'imprensa', null, 120, 72, true, '{}', null),
  ('jota', 'JOTA (imprensa: só sinal)', 'https://www.jota.info/feed', 'feed', 'imprensa', null, 120, 72, true, '{}', null),
  ('inlabs', 'Diário Oficial da União (INLABS)', 'https://inlabs.in.gov.br/', 'feed', 'fonte_oficial', null, 120, 48, false, '{}', 'Desligada: exige o cadastro gratuito no INLABS (variáveis INLABS_EMAIL e INLABS_SENHA no Coolify).'),
  ('nfe_portal', 'Portal da NF-e: notas técnicas', 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D', 'feed', 'fonte_oficial', null, 720, 336, false, '{}', 'Desligada na v1: a página exige cookie de sessão; as notas técnicas chegam pelas notícias da Receita e do Comitê Gestor.'),
  ('rfb_normas', 'Receita Federal: sistema de normas', 'https://normas.receita.fazenda.gov.br/', 'feed', 'fonte_oficial', null, 1440, 168, false, '{}', 'Desligada na v1: a consulta só responde ao aplicativo (403 direto); exige navegador.')
on conflict (id) do update set nome = excluded.nome, url = excluded.url, formato = excluded.formato, nivel = excluded.nivel, tribunal = excluded.tribunal,
  cadencia_min = excluded.cadencia_min, silencio_horas = excluded.silencio_horas, config = excluded.config, nota = excluded.nota;
