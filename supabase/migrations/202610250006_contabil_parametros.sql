-- ============================================================================
-- Módulo Contábil-Fiscal, N-01: parâmetros legais com vigência, teses e perfil da empresa
-- (25/10/2026, pedido do proprietário; desenho em docs/PLANO-CONTABIL-FISCAL.md §3)
-- ============================================================================
-- Três camadas: (1) legal, igual para todas as empresas; (2) UF/município; (3) a empresa (perfil e,
-- depois, exceções). As camadas 1 e 2 são GLOBAIS (sem organization_id): todas as empresas leem e só a
-- CURADORIA escreve. A curadoria é uma organização da plataforma (hoje a Pecsil) + a funcionalidade
-- fiscal.parametros (operar). Nada se apaga: cada mudança é uma nova vigência; conferir uma versão nova
-- fecha a anterior na véspera.
--
-- Auditoria: audit_mudanca exige organization_id e a tabela é global, então as funções de curadoria
-- gravam a auditoria e o evento em nome da organização curadora.
--
-- Carga inicial: docs/contabil/parametros-2026.json (34) e docs/contabil/teses.json (35), pesquisa de
-- 25/10/2026 em fonte oficial. Tudo entra como RASCUNHO: vale para consulta e conta como "a conferir"
-- nos cálculos até o contador conferir. Nenhum valor fiscal fica no código.
-- ============================================================================

insert into public.access_features (code, module_code, label, levels, sort)
values ('fiscal.parametros', 'fiscal', 'Parâmetros legais', '{ver,operar}', 75)
on conflict (code) do update set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- Quem cuida dos parâmetros legais de todas as empresas (uma linha só).
create table if not exists public.contabil_curadoria (
  unica boolean primary key default true check (unica),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  updated_at timestamptz not null default now()
);
comment on table public.contabil_curadoria is 'A organização que faz a curadoria dos parâmetros legais e das teses (globais). PLANO-CONTABIL-FISCAL §3.7.';
insert into public.contabil_curadoria (organization_id)
select id from public.organizations where active order by created_at limit 1
on conflict (unica) do nothing;
alter table public.contabil_curadoria enable row level security;
drop policy if exists contabil_curadoria_read on public.contabil_curadoria;
create policy contabil_curadoria_read on public.contabil_curadoria for select to authenticated using (true);
revoke all on public.contabil_curadoria from anon;
revoke insert, update, delete on public.contabil_curadoria from authenticated;
grant select on public.contabil_curadoria to authenticated;

create or replace function public.contabil_pode_ver() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.parametros', 'ver') or public.has_feature('fiscal.config', 'ver')
    or public.has_feature('fiscal.escritorio', 'ver') or public.has_feature('fiscal.portal', 'operar');
$$;
create or replace function public.contabil_pode_curar() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.parametros', 'operar')
    and public.current_organization_id() = (select organization_id from public.contabil_curadoria);
$$;
revoke all on function public.contabil_pode_ver() from public, anon;
revoke all on function public.contabil_pode_curar() from public, anon;
grant execute on function public.contabil_pode_ver() to authenticated;
grant execute on function public.contabil_pode_curar() to authenticated;

-- Camadas 1 e 2.
create table if not exists public.contabil_parametros (
  id uuid primary key default gen_random_uuid(),
  chave text not null check (chave ~ '^[a-z0-9_]{3,80}$'),
  titulo text not null check (char_length(titulo) between 3 and 160),
  escopo text not null check (escopo in ('legal', 'uf', 'municipio')),
  uf char(2) check (uf is null or uf ~ '^[A-Z]{2}$'),
  codigo_municipio char(7) check (codigo_municipio is null or codigo_municipio ~ '^[0-9]{7}$'),
  valor jsonb not null,
  vigente_de date not null,
  vigente_ate date,
  fonte jsonb not null check (fonte ? 'norma' and fonte ? 'url'),
  confianca text not null check (confianca in ('alta', 'media', 'baixa')),
  observacao text check (observacao is null or char_length(observacao) <= 2000),
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'conferido', 'descartado')),
  origem text not null check (origem in ('carga_inicial', 'sentinela', 'manual')),
  motivo_descarte text check (motivo_descarte is null or char_length(motivo_descarte) <= 500),
  conferido_por uuid references public.profiles(id) on delete set null,
  conferido_por_nome text,
  conferido_em timestamptz,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contabil_parametros_periodo check (vigente_ate is null or vigente_ate >= vigente_de),
  constraint contabil_parametros_local check (
    (escopo = 'legal' and uf is null and codigo_municipio is null)
    or (escopo = 'uf' and uf is not null and codigo_municipio is null)
    or (escopo = 'municipio' and codigo_municipio is not null)),
  constraint contabil_parametros_versao unique nulls not distinct (chave, escopo, uf, codigo_municipio, vigente_de)
);
comment on table public.contabil_parametros is 'Parâmetros legais com vigência (camadas legal e UF/município), globais. Todas as empresas leem; só a curadoria escreve, por função. PLANO-CONTABIL-FISCAL §3.';
create index if not exists contabil_parametros_chave on public.contabil_parametros (chave, vigente_de desc);

alter table public.contabil_parametros enable row level security;
drop policy if exists contabil_parametros_read on public.contabil_parametros;
create policy contabil_parametros_read on public.contabil_parametros for select to authenticated using ((select public.contabil_pode_ver()));
revoke all on public.contabil_parametros from anon;
revoke insert, update, delete on public.contabil_parametros from authenticated;
grant select on public.contabil_parametros to authenticated;

-- Teses (jurisprudência firmada × pautada): globais, curadas como os parâmetros.
create table if not exists public.contabil_teses (
  id uuid primary key default gen_random_uuid(),
  tribunal text not null check (char_length(tribunal) between 2 and 20),
  tema text not null check (char_length(tema) between 1 and 120),
  leading_case text,
  titulo text not null check (char_length(titulo) between 3 and 300),
  tese text not null,
  data date,
  modulacao text,
  situacao text not null check (situacao in ('firmada', 'firmada_modulacao_pendente', 'pendente', 'superada')),
  impacto text,
  observacao text,
  parametros_afetados text[] not null default '{}',
  fontes text[] not null default '{}',
  confianca text not null check (confianca in ('alta', 'media', 'baixa')),
  conferida_por uuid references public.profiles(id) on delete set null,
  conferida_por_nome text,
  conferida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contabil_teses_unica unique (tribunal, tema)
);
comment on table public.contabil_teses is 'Teses de tribunais, súmulas e soluções de consulta que mexem nos parâmetros. Globais; a curadoria confere. PLANO-CONTABIL-FISCAL §2.5.';
alter table public.contabil_teses enable row level security;
drop policy if exists contabil_teses_read on public.contabil_teses;
create policy contabil_teses_read on public.contabil_teses for select to authenticated using ((select public.contabil_pode_ver()));
revoke all on public.contabil_teses from anon;
revoke insert, update, delete on public.contabil_teses from authenticated;
grant select on public.contabil_teses to authenticated;

-- Camada 3: o perfil fiscal da empresa (uma linha por organização). O modo diz quem opera a contabilidade.
create table if not exists public.contabil_perfil_empresa (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  modo text not null default 'escritorio' check (modo in ('interna', 'escritorio')),
  regime text not null default 'a_definir' check (regime in ('presumido', 'real', 'a_definir')),
  cnaes_secundarios text[] not null default '{}' check (cardinality(cnaes_secundarios) <= 40),
  rat numeric(3,1) check (rat is null or rat in (1, 2, 3)),
  fap numeric(6,4) check (fap is null or fap between 0.5 and 2),
  beneficio_estadual text check (beneficio_estadual is null or char_length(beneficio_estadual) <= 500),
  observacao text check (observacao is null or char_length(observacao) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text
);
comment on table public.contabil_perfil_empresa is 'Perfil fiscal da empresa: modo de operação (contabilidade interna ou escritório externo), regime do IRPJ, CNAEs secundários, RAT, FAP e benefício estadual. PLANO-CONTABIL-FISCAL §3.6.';
alter table public.contabil_perfil_empresa enable row level security;
drop policy if exists contabil_perfil_empresa_read on public.contabil_perfil_empresa;
create policy contabil_perfil_empresa_read on public.contabil_perfil_empresa for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.contabil_pode_ver()));
revoke all on public.contabil_perfil_empresa from anon;
revoke insert, update, delete on public.contabil_perfil_empresa from authenticated;
grant select on public.contabil_perfil_empresa to authenticated;
drop trigger if exists contabil_perfil_empresa_auditoria on public.contabil_perfil_empresa;
create trigger contabil_perfil_empresa_auditoria after insert or update or delete on public.contabil_perfil_empresa
  for each row execute function public.audit_mudanca('fiscal');

-- Registro da curadoria: auditoria + evento em nome da organização curadora. p_evento é o tipo do
-- catálogo (modules/event-catalog.ts), escrito por extenso em quem chama.
create or replace function public.contabil_registrar(p_evento text, p_entidade text, p_id uuid, p_frase text, p_detalhes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := (select organization_id from public.contabil_curadoria);
begin
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (org, auth.uid(), public.current_profile_id(), 'fiscal', p_entidade || '.' || split_part(p_evento, '.', 3), p_entidade, p_id, 'high', p_detalhes);
  perform public.emit_module_event(org, 'fiscal', p_evento, p_entidade, p_id::text, p_frase, p_detalhes);
end;
$$;
revoke all on function public.contabil_registrar(text, text, uuid, text, jsonb) from public, anon, authenticated;

-- Conferir uma versão: vira a que vale e fecha a versão conferida anterior na véspera.
create or replace function public.contabil_parametro_conferir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.contabil_parametros;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
  fechadas integer;
begin
  if not public.contabil_pode_curar() then
    raise exception 'Só a curadoria confere parâmetros legais.' using errcode = '42501';
  end if;
  select * into p from public.contabil_parametros where id = p_id for update;
  if p.id is null then raise exception 'Parâmetro não encontrado.'; end if;
  if p.situacao <> 'rascunho' then raise exception 'Só um rascunho pode ser conferido (este está %).', p.situacao; end if;
  update public.contabil_parametros set vigente_ate = p.vigente_de - 1, updated_at = now()
  where chave = p.chave and escopo = p.escopo and uf is not distinct from p.uf and codigo_municipio is not distinct from p.codigo_municipio
    and situacao = 'conferido' and vigente_de < p.vigente_de and (vigente_ate is null or vigente_ate >= p.vigente_de);
  get diagnostics fechadas = row_count;
  update public.contabil_parametros
  set situacao = 'conferido', conferido_por = public.current_profile_id(), conferido_por_nome = nome, conferido_em = now(), updated_at = now()
  where id = p.id;
  perform public.contabil_registrar('fiscal.parametro.conferido', 'contabil_parametros', p.id,
    format('%s conferiu o parâmetro "%s" (vigência desde %s)', coalesce(nome, 'Alguém'), p.titulo, to_char(p.vigente_de, 'DD/MM/YYYY')),
    jsonb_build_object('chave', p.chave, 'escopo', p.escopo, 'uf', p.uf, 'vigente_de', p.vigente_de, 'fonte', p.fonte, 'versoes_fechadas', fechadas));
end;
$$;

-- Nova vigência (proposta): entra como rascunho e não muda nada até ser conferida.
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
    coalesce(nullif(p ->> 'origem', ''), 'manual'), public.current_profile_id(), nome)
  returning id into novo;
  perform public.contabil_registrar('fiscal.parametro.proposto', 'contabil_parametros', novo,
    format('%s propôs nova vigência para "%s" a partir de %s', coalesce(nome, 'Alguém'), coalesce(base.titulo, v_chave), to_char((p ->> 'vigente_de')::date, 'DD/MM/YYYY')),
    jsonb_build_object('chave', v_chave, 'escopo', v_escopo, 'vigente_de', p ->> 'vigente_de', 'norma', p ->> 'norma', 'url', p ->> 'url'));
  return novo;
end;
$$;

-- Descartar um rascunho (leitura errada, norma revogada antes de valer): fica no histórico com o motivo.
create or replace function public.contabil_parametro_descartar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.contabil_parametros;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if not public.contabil_pode_curar() then
    raise exception 'Só a curadoria descarta parâmetros legais.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga o motivo do descarte.'; end if;
  select * into p from public.contabil_parametros where id = p_id for update;
  if p.id is null then raise exception 'Parâmetro não encontrado.'; end if;
  if p.situacao <> 'rascunho' then raise exception 'Só um rascunho pode ser descartado; para mudar um conferido, proponha uma nova vigência.'; end if;
  update public.contabil_parametros set situacao = 'descartado', motivo_descarte = btrim(p_motivo), updated_at = now() where id = p.id;
  perform public.contabil_registrar('fiscal.parametro.descartado', 'contabil_parametros', p.id,
    format('%s descartou o rascunho de "%s": %s', coalesce(nome, 'Alguém'), p.titulo, btrim(p_motivo)),
    jsonb_build_object('chave', p.chave, 'vigente_de', p.vigente_de, 'motivo', btrim(p_motivo)));
end;
$$;

create or replace function public.contabil_tese_conferir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.contabil_teses;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if not public.contabil_pode_curar() then
    raise exception 'Só a curadoria confere teses.' using errcode = '42501';
  end if;
  select * into t from public.contabil_teses where id = p_id for update;
  if t.id is null then raise exception 'Tese não encontrada.'; end if;
  update public.contabil_teses set conferida_por = public.current_profile_id(), conferida_por_nome = nome, conferida_em = now(), updated_at = now() where id = t.id;
  perform public.contabil_registrar('fiscal.parametro.tese_conferida', 'contabil_teses', t.id,
    format('%s conferiu a tese %s %s (%s)', coalesce(nome, 'Alguém'), t.tribunal, t.tema, t.titulo),
    jsonb_build_object('tribunal', t.tribunal, 'tema', t.tema, 'situacao', t.situacao));
end;
$$;

-- Perfil da empresa: quem altera a configuração fiscal (é decisão da empresa, não da curadoria).
create or replace function public.contabil_perfil_salvar(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.has_feature('fiscal.config', 'operar') then
    raise exception 'Sem permissão para alterar o perfil fiscal da empresa.' using errcode = '42501';
  end if;
  insert into public.contabil_perfil_empresa (organization_id, modo, regime, cnaes_secundarios, rat, fap, beneficio_estadual, observacao, updated_at, updated_by, updated_by_name)
  values (org, coalesce(p ->> 'modo', 'escritorio'), coalesce(p ->> 'regime', 'a_definir'),
    coalesce(array(select regexp_replace(x, '\D', '', 'g') from jsonb_array_elements_text(coalesce(p -> 'cnaes_secundarios', '[]'::jsonb)) x where regexp_replace(x, '\D', '', 'g') ~ '^[0-9]{7}$'), '{}'),
    nullif(p ->> 'rat', '')::numeric, nullif(p ->> 'fap', '')::numeric,
    nullif(btrim(coalesce(p ->> 'beneficio_estadual', '')), ''), nullif(btrim(coalesce(p ->> 'observacao', '')), ''), now(), me, nome)
  on conflict (organization_id) do update set
    modo = excluded.modo, regime = excluded.regime, cnaes_secundarios = excluded.cnaes_secundarios, rat = excluded.rat, fap = excluded.fap,
    beneficio_estadual = excluded.beneficio_estadual, observacao = excluded.observacao, updated_at = now(), updated_by = me, updated_by_name = nome;
end;
$$;

revoke all on function public.contabil_parametro_conferir(uuid) from public, anon;
revoke all on function public.contabil_parametro_propor(jsonb) from public, anon;
revoke all on function public.contabil_parametro_descartar(uuid, text) from public, anon;
revoke all on function public.contabil_tese_conferir(uuid) from public, anon;
revoke all on function public.contabil_perfil_salvar(jsonb) from public, anon;
grant execute on function public.contabil_parametro_conferir(uuid) to authenticated;
grant execute on function public.contabil_parametro_propor(jsonb) to authenticated;
grant execute on function public.contabil_parametro_descartar(uuid, text) to authenticated;
grant execute on function public.contabil_tese_conferir(uuid) to authenticated;
grant execute on function public.contabil_perfil_salvar(jsonb) to authenticated;

-- Carga inicial (docs/contabil/parametros-2026.json), toda em rascunho.
insert into public.contabil_parametros (chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, situacao, origem)
select v.chave, v.titulo, v.escopo, v.uf, v.codigo_municipio, v.valor, v.vigente_de, v.vigente_ate, v.fonte, v.confianca, v.observacao, 'rascunho', 'carga_inicial'
from (values
  ('salario_minimo', 'Salário mínimo nacional', 'legal', null, null, '{"mensal":1621,"diario":54.04,"hora":7.37}'::jsonb, '2026-01-01'::date, null, '{"norma":"Decreto 12.797, de 23/12/2025, art. 1º (DOU 24/12/2025)","url":"https://www.in.gov.br/en/web/dou/-/decreto-n-12.797-de-23-de-dezembro-de-2025-677935309"}'::jsonb, 'alta', null),
  ('inss_segurado_tabela', 'INSS do empregado (tabela progressiva)', 'legal', null, null, '{"progressiva_por_faixa":true,"faixas":[{"ate":1621,"aliquota":0.075},{"ate":2902.84,"aliquota":0.09},{"ate":4354.27,"aliquota":0.12},{"ate":8475.55,"aliquota":0.14}],"teto_salario_contribuicao":8475.55,"desconto_maximo_aprox":988.09}'::jsonb, '2026-01-01'::date, null, '{"norma":"Portaria Interministerial MPS/MF 13, de 09/01/2026 (DOU 12/01/2026), arts. 2º e 7º e Anexo II","url":"https://www.gov.br/previdencia/pt-br/assuntos/rpps/destaques/publicada-a-portaria-interministerial-mps-mf-no-13-de-9-01-2026-que-dispoe-sobre-o-reajuste-dos-beneficios-pagos-pelo-inss-e-demais-valores"}'::jsonb, 'alta', null),
  ('salario_familia', 'Salário-família', 'legal', null, null, '{"cota":67.54,"remuneracao_maxima":1980.38,"idade_maxima_filho":14}'::jsonb, '2026-01-01'::date, null, '{"norma":"Portaria Interministerial MPS/MF 13/2026, art. 4º","url":"https://www.gov.br/esocial/pt-br/noticias/liberado-o-envio-de-eventos-de-folha-para-o-esocial-apos-publicacao-de-portaria-que-reajusta-valores-previdenciarios-em-2026-1"}'::jsonb, 'alta', null),
  ('irrf_tabela_mensal', 'IRRF mensal (tabela progressiva)', 'legal', null, null, '{"faixas":[{"ate":2428.8,"aliquota":0,"deduzir":0},{"ate":2826.65,"aliquota":0.075,"deduzir":182.16},{"ate":3751.05,"aliquota":0.15,"deduzir":394.16},{"ate":4664.68,"aliquota":0.225,"deduzir":675.49},{"ate":null,"aliquota":0.275,"deduzir":908.73}],"deducao_dependente":189.59,"desconto_simplificado_mensal":607.2}'::jsonb, '2025-05-01'::date, null, '{"norma":"Lei 15.191/2025 (tabela); RFB, tabelas 2026","url":"https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026"}'::jsonb, 'alta', 'A tabela não mudou em 2026; o que mudou foi a redução da Lei 15.270 (chave irrf_reducao_lei_15270).'),
  ('irrf_reducao_lei_15270', 'IRRF: redução da Lei 15.270 (isenção até R$ 5 mil)', 'legal', null, null, '{"isencao_ate":5000,"reducao_maxima":312.89,"parcial_ate":7350,"parcial_constante":978.62,"parcial_coeficiente":0.133145,"regra":"Calcular o imposto pela tabela (após INSS e dependentes, ou simplificado) e subtrair a redução, calculada sobre o rendimento bruto tributável; limitada ao imposto; vale também no 13º. Até isencao_ate: redução até reducao_maxima (zera). Até parcial_ate: parcial_constante − parcial_coeficiente × rendimento. Acima: sem redução."}'::jsonb, '2026-01-01'::date, null, '{"norma":"Lei 15.270, de 26/11/2025, art. 2º (Lei 9.250/1995 art. 3º-A); efeitos desde 01/01/2026 (art. 8º)","url":"https://www2.camara.leg.br/legin/fed/lei/2025/lei-15270-26-novembro-2025-798354-publicacaooriginal-177117-pl.html"}'::jsonb, 'alta', null),
  ('dividendos_retencao_fonte', 'Dividendos: retenção de 10% na fonte', 'legal', null, null, '{"aliquota":0.1,"base":"lucros e dividendos pagos pela mesma PJ à mesma PF acima de R$ 50.000 no mês (total do mês)","fora":"lucros apurados até 2025 com distribuição aprovada até 31/12/2025","irpfm":"renda anual acima de R$ 600 mil: alíquota linear até 10% em R$ 1,2 mi; só na declaração anual (exercício 2027)"}'::jsonb, '2026-01-01'::date, null, '{"norma":"Lei 15.270/2025 (Lei 9.250 arts. 6º-A e 16-A)","url":"https://www2.camara.leg.br/legin/fed/lei/2025/lei-15270-26-novembro-2025-798354-publicacaooriginal-177117-pl.html"}'::jsonb, 'alta', null),
  ('fgts', 'FGTS', 'legal', null, null, '{"aliquota":0.08,"vencimento_mensal":"dia 20 do mês seguinte (antecipa se não útil), FGTS Digital","rescisorio":"10º dia corrido","multa_rescisoria":0.4,"adicional_10_pct":"extinto para dispensas desde 01/01/2020"}'::jsonb, '2024-03-01'::date, null, '{"norma":"Lei 8.036/1990 art. 15 (red. Lei 14.438/2022) e art. 18 §1º; Lei 13.932/2019 art. 12","url":"https://www.gov.br/pt-br/servicos/emissao-de-guia-para-recolhimento-do-fgts-atraves-do-fgts-digital"}'::jsonb, 'alta', null),
  ('prazo_esocial_fechamento', 'Prazo: fechamento do eSocial (S-1299)', 'legal', null, null, '{"evento":"S-1299","prazo":"dia 15 do mês seguinte; 13º até 20/12"}'::jsonb, '2024-01-01'::date, null, '{"norma":"Manual de Orientação do eSocial S-1.3","url":"https://www.gov.br/esocial/pt-br/documentacao-tecnica"}'::jsonb, 'alta', null),
  ('prazo_efd_reinf', 'Prazo: EFD-Reinf', 'legal', null, null, '{"prazo":"dia 15 do mês seguinte; posterga para o dia útil seguinte"}'::jsonb, '2024-01-01'::date, null, '{"norma":"IN RFB 2.043/2021 art. 3º §1º (red. IN 2.181/2024) e art. 6º (red. IN 2.163/2023)","url":"http://normas.receita.fazenda.gov.br/"}'::jsonb, 'alta', null),
  ('prazo_dctfweb', 'Prazo: DCTFWeb', 'legal', null, null, '{"prazo":"último dia útil do mês seguinte","observacao":"DCTF PGD extinta para fatos geradores desde 01/2025 (débitos via MIT)"}'::jsonb, '2025-02-01'::date, null, '{"norma":"IN RFB 2.237/2024 art. 6º (red. IN RFB 2.248/2025)","url":"https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2025/fevereiro/contribuintes-ganham-mais-tempo-para-entregar-a-dctfweb"}'::jsonb, 'alta', null),
  ('prazo_efd_contribuicoes', 'Prazo: EFD-Contribuições', 'legal', null, null, '{"prazo":"10º dia útil do 2º mês seguinte à competência"}'::jsonb, '2012-01-01'::date, null, '{"norma":"IN RFB 1.252/2012 art. 7º","url":"http://normas.receita.fazenda.gov.br/"}'::jsonb, 'alta', null),
  ('prazo_efd_icms_ipi', 'Prazo: EFD ICMS/IPI', 'uf', 'SP', null, '{"prazo":"dia 20 do mês seguinte"}'::jsonb, '2016-01-01'::date, null, '{"norma":"Portaria CAT 147/2009 art. 10 (red. Portaria CAT 22/2016)","url":"https://legislacao.fazenda.sp.gov.br/Paginas/pcat1472009.aspx"}'::jsonb, 'alta', null),
  ('gia_sp', 'GIA-SP', 'uf', 'SP', null, '{"situacao":"dispensada para o RPA desde 01/01/2026 (GIA-ST desde 07/2025)"}'::jsonb, '2026-01-01'::date, null, '{"norma":"Portaria SRE 2/2025","url":"https://portal.fazenda.sp.gov.br/servicos/gia/paginas/eliminacao-da-gia.aspx"}'::jsonb, 'alta', null),
  ('prazo_ecd', 'Prazo: ECD', 'legal', null, null, '{"prazo":"último dia útil de junho do ano seguinte"}'::jsonb, '2021-01-01'::date, null, '{"norma":"IN RFB 2.003/2021","url":"http://sped.rfb.gov.br/projeto/show/273"}'::jsonb, 'alta', null),
  ('prazo_ecf', 'Prazo: ECF', 'legal', null, null, '{"prazo":"último dia útil de julho do ano seguinte"}'::jsonb, '2021-01-01'::date, null, '{"norma":"IN RFB 2.004/2021 art. 3º","url":"http://sped.rfb.gov.br/projeto/show/269"}'::jsonb, 'alta', null),
  ('dirf', 'DIRF', 'legal', null, null, '{"situacao":"extinta para fatos geradores desde 01/01/2025; última foi a DIRF 2025 (ano-calendário 2024); substituída por EFD-Reinf R-4000 e eSocial"}'::jsonb, '2025-01-01'::date, null, '{"norma":"RFB, Perguntas e Respostas DIRF 2025","url":"https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirf/dirf2025-perguntas-respostas-v20241230.pdf"}'::jsonb, 'alta', null),
  ('fap_vigencia_2026', 'FAP e RAT (vigência 2026)', 'legal', null, null, '{"portaria":"MPS/MF 10, de 10/09/2025","consulta_desde":"2025-09-30","rat":"1%, 2% ou 3% pelo CNAE; RAT × FAP (0,5 a 2,0)"}'::jsonb, '2026-01-01'::date, '2026-12-31'::date, '{"norma":"Portaria MPS/MF 10/2025","url":"https://www.gov.br/previdencia/pt-br"}'::jsonb, 'alta', null),
  ('fap_vigencia_2027', 'FAP (vigência 2027)', 'legal', null, null, '{"portaria":"MPS/MF 16, de 24/09/2026 (DOU 29/09/2026)","consulta_desde":"2026-09-30","contestacao":"01 a 30/11/2026"}'::jsonb, '2027-01-01'::date, '2027-12-31'::date, '{"norma":"Portaria MPS/MF 16/2026","url":"https://www.gov.br/previdencia/pt-br/noticias/2026/setembro/fator-acidentario-de-prevencao-fap-com-vigencia-para-2027-esta-disponivel-para-consulta-a-partir-desta-quarta-feira-30"}'::jsonb, 'alta', null),
  ('terceiros_base_calculo', 'Contribuições a terceiros: base de cálculo', 'legal', null, null, '{"teto_20_salarios_minimos":false,"regra":"base integral para SESI/SENAI/SESC/SENAC (Tema 1.079 STJ) e para salário-educação, INCRA, SEBRAE, SENAR, SEST/SENAT etc. (Tema 1.390 STJ, sem modulação; ED pendentes)"}'::jsonb, '2024-05-02'::date, null, '{"norma":"STJ, Temas 1.079 (13/03/2024) e 1.390 (11/02/2026)","url":"https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2026/23022026-Repetitivo-afasta-teto-de-20-salarios-minimos-para-base-de-calculo-das-contribuicoes-parafiscais.aspx"}'::jsonb, 'alta', null),
  ('lucro_presumido_percentuais', 'Lucro Presumido: percentuais e LC 224/2025', 'legal', null, null, '{"industria_comercio":{"irpj":0.08,"csll":0.12},"servicos":{"irpj":0.32,"csll":0.32},"irpj_aliquota":0.15,"irpj_adicional":{"aliquota":0.1,"excedente_trimestral":60000},"csll_aliquota":0.09,"lc_224_2025":{"acrescimo_relativo":0.1,"percentuais_majorados":{"industria_comercio":{"irpj":0.088,"csll":0.132},"servicos":{"irpj":0.352,"csll":0.352}},"aplica_sobre":"parcela da receita bruta anual que exceder R$ 5.000.000 (R$ 1.250.000 por trimestre, com ajuste no ano; proporcional por atividade)","vigencia_irpj":"2026-01-01","vigencia_csll":"2026-04-01"}}'::jsonb, '2026-01-01'::date, null, '{"norma":"Lei 9.249/1995 arts. 15 e 20; LC 224, de 26/12/2025, art. 4º §4º VII e §5º; Decreto 12.808/2025; IN RFB 2.305/2025 e 2.306/2026","url":"https://www.normaslegais.com.br/legislacao/lei-complementar-224-2025.htm"}'::jsonb, 'alta', 'Há liminares isoladas (TRF2) suspendendo o acréscimo, sem efeito geral; ADI 8002 (CNI) pendente no STF. Não existe ''tributação mínima'' para PJ: o IRPFM da Lei 15.270 é só de PF.'),
  ('pis_cofins_aliquotas', 'PIS e COFINS: alíquotas', 'legal', null, null, '{"nao_cumulativo":{"pis":0.0165,"cofins":0.076},"cumulativo":{"pis":0.0065,"cofins":0.03},"receita_financeira_nao_cumulativo":{"pis":0.0065,"cofins":0.04},"icms_fora_da_base":"Tema 69 STF (ICMS destacado)","icms_fora_dos_creditos_desde":"2023-05-01 (Lei 14.592/2023; Tema 1364 STJ)","extincao":"2027-01-01 (CBS)"}'::jsonb, '2023-05-01'::date, '2026-12-31'::date, '{"norma":"Lei 10.637 art. 2º; Lei 10.833 art. 2º; Lei 9.715 art. 8º; Lei 9.718 art. 8º; Decreto 8.426/2015 art. 1º; Lei 14.592/2023 arts. 6º–7º","url":"https://www.normaslegais.com.br/legislacao/lei-14592-2023.htm"}'::jsonb, 'alta', null),
  ('codigos_darf', 'Códigos de receita (DARF)', 'legal', null, null, '{"1708":"IRRF serviços prestados por PJ","2089":"IRPJ lucro presumido","2172":"COFINS cumulativa","2362":"IRPJ lucro real estimativa mensal","2372":"CSLL lucro presumido","2430":"IRPJ lucro real ajuste anual","2484":"CSLL estimativa mensal","5123":"IPI demais produtos","5856":"COFINS não cumulativa","5952":"CSRF (PIS/COFINS/CSLL retidos)","6012":"CSLL lucro real trimestral","6773":"CSLL ajuste anual","6912":"PIS não cumulativo","8045":"IRRF outros rendimentos (comissões, propaganda)","8109":"PIS faturamento (cumulativo)","8301":"PIS sobre folha (não é o cumulativo)","0220":"IRPJ lucro real trimestral"}'::jsonb, '2026-01-01'::date, null, '{"norma":"SIEF Receitas (consolidação 19/10/2026)","url":"https://siefreceitas.receita.economia.gov.br"}'::jsonb, 'media', 'Lista vem de reprodução do SIEF (buscadorncm.com.br/darf); a página oficial não renderizou. Conferir código a código.'),
  ('vencimentos_federais', 'Vencimentos dos tributos federais', 'legal', null, null, '{"irpj_csll_trimestral":"último dia útil do mês seguinte ao trimestre (quota única ou 3 quotas com Selic)","irpj_csll_estimativa":"último dia útil do mês seguinte","pis_cofins":"dia 25 do mês seguinte (antecipa se não útil)","ipi":"dia 25 do mês seguinte (cigarros dia 10)","irrf_1708_8045":"último dia útil do 2º decêndio do mês seguinte (dia 20)","csrf_5952":"último dia útil do 2º decêndio do mês seguinte ao pagamento (dia 20)","inss_patronal_e_retido_11":"dia 20 do mês seguinte (antecipa)"}'::jsonb, '2009-05-01'::date, null, '{"norma":"Lei 9.430/1996 arts. 5º e 6º; Lei 11.933/2009 arts. 1º e 4º; Lei 11.196/2005 art. 70 I ''e''; Lei 10.833 art. 35","url":"https://www.contadores.cnt.br/legislacoes/lei-n-11-933-de-28-de-abril-de-2009.html"}'::jsonb, 'alta', null),
  ('retencao_irrf_tomador_pj', 'Retenção de IRRF pelo tomador (PJ)', 'legal', null, null, '{"servicos_profissionais":0.015,"limpeza_conservacao_seguranca_vigilancia_locacao_mao_de_obra":0.01,"comissoes_propaganda":0.015,"dispensa":"IR retido ≤ R$ 10,00 (Lei 9.430 art. 67)","prestador_simples":"sem retenção","codigos":["1708","8045"],"dispensa_ate":10}'::jsonb, '2015-06-22'::date, null, '{"norma":"RIR/2018 (Decreto 9.580) arts. 714, 716, 718, 723; Lei 9.430/1996 art. 67","url":"http://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=75717"}'::jsonb, 'media', 'Regra alta; numeração dos artigos do RIR a confirmar no Planalto (inacessível na pesquisa).'),
  ('retencao_csrf_tomador_pj', 'Retenção de PIS/COFINS/CSLL (CSRF)', 'legal', null, null, '{"total":0.0465,"csll":0.01,"cofins":0.03,"pis":0.0065,"dispensa":"retenção ≤ R$ 10,00 (Lei 10.833 art. 31 §3º)","codigo":"5952","vencimento":"último dia útil do 2º decêndio do mês seguinte ao pagamento","dispensa_ate":10}'::jsonb, '2015-06-22'::date, null, '{"norma":"Lei 10.833/2003 arts. 30, 31 e 35 (red. Lei 13.137/2015)","url":"https://www.normaslegais.com.br/legislacao/tributario/lei10833.htm"}'::jsonb, 'alta', null),
  ('retencao_inss_11_cessao_mao_de_obra', 'Retenção de INSS de 11% (cessão de mão de obra)', 'legal', null, null, '{"aliquota":0.11,"aplica":"cessão de mão de obra ou empreitada (lista taxativa da IN: arts. 111 e 112)","base":"valor bruto da NF; materiais e equipamentos discriminados saem da base (art. 116)","simples":"sem retenção, salvo Anexo IV","empreitada_total_e_avulsos":"fora da retenção (IN RFB 2.289/2025)","escrituracao":"R-2010 da EFD-Reinf (fato gerador = emissão da NF) → DCTFWeb → DARF","vencimento":"dia 20 do mês seguinte à emissão da NF"}'::jsonb, '2022-10-19'::date, null, '{"norma":"Lei 8.212/1991 art. 31 (red. Lei 11.933/2009); IN RFB 2.110/2022 arts. 108–121; IN RFB 2.289/2025","url":"https://www.normaslegais.com.br/legislacao/trabalhista/lei8212.htm"}'::jsonb, 'media', 'Lei: alta. Rol completo do art. 112 da IN a conferir no texto da IN (PDF inacessível). Usinagem e manutenção de máquina: SC Cosit 28/2017 e 93/2021 (só com subordinação ao tomador).'),
  ('iss_regra_geral', 'ISS: local e retenção pelo tomador', 'legal', null, null, '{"local":"estabelecimento do prestador, salvo incisos I–XXV do art. 3º (local da execução)","responsavel_tomador":"art. 6º §2º II: tomador PJ responsável nos subitens 3.05, 7.02, 7.04, 7.05, 7.09, 7.10, 7.12, 7.16, 7.17, 7.19, 11.02, 17.05, 17.10; demais casos só se a lei do município prevê","aliquotas":"2% a 5%"}'::jsonb, '2017-01-01'::date, null, '{"norma":"LC 116/2003 arts. 3º e 6º (red. LC 157/2016); STF Tema 1.020 (CPOM)","url":"https://www.tjmg.jus.br/portal-tjmg/jurisprudencia/recurso-repetitivo-e-repercussao-geral/constitucionalidade-de-lei-municipal-a-determinar-retencao-do-iss-pelo-tomador-de-servico-em-razao-da-ausencia-de-cadastro-do-prestador-nao-estabelecido-no-territorio-do-referido-municipio-tema-1020-stf.htm"}'::jsonb, 'media', 'A lei do município da Pecsil (camada 2) ainda não foi levantada.'),
  ('reforma_2026_fase_teste', 'Reforma: 2026, fase de teste (CBS 0,9% + IBS 0,1%)', 'legal', null, null, '{"cbs":0.009,"ibs":0.001,"recolhimento":"dispensado para quem cumpre as obrigações acessórias (LC 214 art. 348 §1º); apuração meramente informativa (Decreto 12.955 art. 464)","obrigacao":"destacar os grupos IBS/CBS nos documentos fiscais; NF-e, NFC-e, CT-e e MDF-e obrigatórios desde 03/08/2026; NFS-e geral desde 01/10/2026; Simples e NF-e de importação desde 01/01/2027","rejeicao":"suspensa (Ato Técnico Conjunto RFB/CGIBS 1/2026); data de retomada não publicada","leiaute":"NT 2025.002 v1.52 (01/10/2026)","conformidade":"corrigir inconsistências até 31/12/2026 (Ato Conjunto 5/2026)"}'::jsonb, '2026-01-01'::date, '2026-12-31'::date, '{"norma":"ADCT art. 125; LC 214/2025 arts. 343, 346, 348; LC 227/2026; Decreto 12.955/2026; Atos Conjuntos RFB/CGIBS 1/2025, 4/2026, 5/2026","url":"https://www.cgibs.gov.br/atos-conjuntos"}'::jsonb, 'alta', null),
  ('reforma_2027', 'Reforma: 2027 (CBS plena, PIS/COFINS extintos, IPI zero)', 'legal', null, null, '{"cbs":"plena: alíquota de referência menos 0,1 p.p. em 2027–2028","pis_cofins":"extintos","ibs":"0,05% estadual + 0,05% municipal","ipi":"zero, exceto produtos com alíquota ≥ 6,5% na TIPI de 31/12/2023 industrializados na ZFM (lista do Executivo pendente, LC 214 art. 454)","imposto_seletivo":"veículos, embarcações/aeronaves, fumígenos, bebidas alcoólicas e açucaradas, bens minerais (teto 0,25%), prognósticos; peças fundidas e usinadas fora; MP das alíquotas pendente","split_payment":"opcional em 2027 (testes desde 15/10/2026); obrigatoriedade sinalizada para 2028, sem ato"}'::jsonb, '2027-01-01'::date, '2028-12-31'::date, '{"norma":"ADCT arts. 126–127; LC 214/2025 arts. 31–36, 344, 347, 409–422, 454","url":"https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214.htm"}'::jsonb, 'alta', null),
  ('reforma_aliquota_referencia', 'Reforma: alíquota de referência', 'legal', null, null, '{"estimativa_total":0.2791,"ibs":0.187,"cbs_por_diferenca":0.0921,"natureza":"parâmetro orçamentário 2027, não é alíquota vigente","cbs_2027":"TCU até 30/10/2026; Resolução do Senado até 15/12/2026; sem resolução publicada em 25/10/2026"}'::jsonb, '2026-07-31'::date, null, '{"norma":"Resolução CGIBS 14/2026 (29/07/2026); LC 214 arts. 349 e 353; Resolução TCU 388/2026","url":"https://www.cgibs.gov.br/resolucoes"}'::jsonb, 'media', null),
  ('reforma_2029_2033', 'Reforma: transição do ICMS/ISS (2029 a 2033)', 'legal', null, null, '{"2033":"ICMS e ISS extintos; IBS pleno","transicao_icms_iss":{"2029":0.9,"2030":0.8,"2031":0.7,"2032":0.6},"saldos_icms_31_12_2032":"homologação em até 5 anos a partir de 01/01/2033; Estado responde em 24 meses; silêncio = homologação; IPCA desde 01/02/2033; compensação com IBS em 240 parcelas; crédito do ICMS-ST do estoque","beneficios_estaduais":"reduzidos na mesma proporção 2029–2032; compensação só para benefícios onerosos (FCBF; habilitação 01/01/2026–31/12/2028 pelo e-CAC, Portaria RFB 635/2025)"}'::jsonb, '2029-01-01'::date, null, '{"norma":"ADCT arts. 128–129 e 134; LC 227/2026 arts. 132–143; LC 214 arts. 384+","url":"https://www2.camara.leg.br/legin/fed/leicom/2026/leicomplementar-227-13-janeiro-2026-798657-publicacaooriginal-177770-pl.html"}'::jsonb, 'alta', null),
  ('reforma_creditos_e_regimes', 'Reforma: créditos e regimes (LC 214)', 'legal', null, null, '{"nao_cumulatividade":"crédito sobre toda aquisição com débito extinto, exceto uso e consumo pessoal (art. 47)","uso_consumo_pessoal":"joias, obras de arte, bebidas alcoólicas, tabaco, armas, lazer e estética, bens cedidos a sócios e empregados; EPI, uniformes, alimentação no local e saúde ocupacional ficam FORA (crédito mantido, art. 57 §3º)","bens_de_capital":"crédito integral e imediato (art. 108); suspensão por ato conjunto ainda não publicado (art. 109)","exportacao":"imune, com apropriação e utilização dos créditos (arts. 8º e 79)","reducao_60":"educação, saúde, dispositivos médicos, medicamentos, alimentos, insumos agropecuários etc. (art. 128)","reducao_30":"profissões regulamentadas (art. 127)","fundicao_usinagem":"regime regular, alíquota cheia, crédito pleno"}'::jsonb, '2027-01-01'::date, null, '{"norma":"LC 214/2025 arts. 8º, 47, 57, 79, 108–109, 125–128","url":"https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214.htm"}'::jsonb, 'alta', null),
  ('depreciacao_taxas_fiscais', 'Depreciação: taxas fiscais', 'legal', null, null, '{"edificacoes":{"anos":25,"taxa":0.04},"maquinas_equipamentos":{"anos":10,"taxa":0.1},"veiculos":{"anos":5,"taxa":0.2},"moveis_utensilios":{"anos":10,"taxa":0.1},"computadores":{"anos":5,"taxa":0.2},"ferramentas":{"anos":5,"taxa":0.2},"turnos":{"2":1.5,"3":2},"pequeno_valor":"custo até R$ 1.200 ou vida útil até 1 ano pode ir a despesa (RIR art. 313 II)","ciap":"48 parcelas mensais"}'::jsonb, '2017-03-16'::date, null, '{"norma":"IN RFB 1.700/2017 Anexo III; RIR/2018 arts. 312–323; Lei Kandir (CIAP)","url":"http://normas.receita.fazenda.gov.br/"}'::jsonb, 'media', 'Valores de conhecimento geral; não foram conferidos no texto da IN nesta pesquisa. Conferir antes de usar.'),
  ('feriados_nacionais', 'Feriados nacionais e regra de antecipação', 'legal', null, null, '{"fonte_automatica":"BrasilAPI /api/feriados/v1/{ano} e ANBIMA feriados_nacionais.xls","regra_antecipacao":"DAS, DARF, GPS/DARF INSS e DAE FGTS antecipam para o último dia útil anterior; ICMS SP antecipa; outros Estados variam; ECD/ECF em geral mantêm"}'::jsonb, '2026-01-01'::date, null, '{"norma":"Lei 662/1949; Lei 10.607/2002; Lei 14.759/2023 (Consciência Negra)","url":"https://brasilapi.com.br/api/feriados/v1/2026"}'::jsonb, 'media', 'A regra de antecipação por tributo precisa ser conferida norma a norma antes do calendário (N-06).')
) as v (chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao)
on conflict on constraint contabil_parametros_versao do nothing;

-- Carga inicial das teses (docs/contabil/teses.json).
insert into public.contabil_teses (tribunal, tema, leading_case, titulo, tese, data, modulacao, situacao, impacto, observacao, parametros_afetados, fontes, confianca)
select * from (values
  ('STF', '69', 'RE 574.706', 'ICMS fora da base de PIS/COFINS', 'O ICMS não compõe a base de cálculo para a incidência do PIS e da COFINS (ICMS destacado).', '2017-03-15'::date, 'ED 13/05/2021: efeitos desde 15/03/2017, ressalvadas ações judiciais e administrativas protocoladas até essa data.', 'firmada', null, 'Lei 14.592/2023: ICMS da compra sai da base de crédito desde 01/05/2023 (validado pelo STJ, Tema 1364).', array['pis_cofins_aliquotas']::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=69']::text[], 'alta'),
  ('STF', '1093 + ADI 7066 + Tema 1266', 'RE 1.287.019; RE 1.426.271', 'DIFAL a consumidor final não contribuinte', 'A cobrança do DIFAL pressupõe lei complementar (24/02/2021). ADI 7066 (29/11/2023): LC 190/2022 só observa a anterioridade nonagesimal (exigível desde abril/2022). Tema 1266 (tese 21/10/2025; ED da Fazenda rejeitados em 03/2026): art. 3º da LC 190 constitucional; leis estaduais anteriores válidas, com efeitos só após a LC.', '2025-10-21'::date, '1093: efeitos a partir de 2022, ressalvadas ações em curso. 1266: quem ajuizou ação até 29/11/2023 e não recolheu em 2022 não pode ser cobrado.', 'firmada', null, 'Texto literal do Tema 1266 não conferido no portal.', '{}'::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1093', 'https://pradvogados.com.br/2026/03/17/desfechos-e-pautas-dos-principais-julgamentos-tributarios-nos-tribunais-superiores-74/']::text[], 'media'),
  ('STF', '985', 'RE 1.072.485', 'Contribuição previdenciária sobre o terço de férias', 'É legítima a incidência de contribuição social sobre o valor satisfeito a título de terço constitucional de férias.', '2020-08-28'::date, 'ED 12/06/2024: efeitos desde 15/09/2020 (ata), ressalvadas as contribuições pagas e não impugnadas até então; novos ED da União rejeitados em 08/2025. Parecer SEI PGFN 784/2026: a modulação não alcança a cota do empregado.', 'firmada', null, null, '{}'::text[], array['https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/decisoes-vinculantes-do-stf-e-do-stj-repercussao-geral-e-recursos-repetitivos/arquivos-e-imagens/parecer-sei-no-784-2026-pgfn.pdf', 'https://www.conjur.com.br/?p=857724']::text[], 'alta'),
  ('STF', '962', 'RE 1.063.187', 'Selic na repetição de indébito fora do IRPJ/CSLL', 'É inconstitucional a incidência do IRPJ e da CSLL sobre os valores atinentes à taxa Selic recebidos em razão de repetição de indébito tributário (inclui compensação).', '2021-09-24'::date, 'ED 29/04/2022: ex nunc desde 30/09/2021; ressalva ações ajuizadas até 17/09/2021 e fatos geradores anteriores sem pagamento.', 'firmada', null, null, '{}'::text[], array['https://assets.ey.com/content/dam/ey-sites/ey-com/pt_br/topics/tax-alert/ey-tax-alert-06-05-22.pdf']::text[], 'alta'),
  ('STF', '118', 'RE 592.616', 'ISS fora da base de PIS/COFINS', 'Julgado em 21/10/2026 (6×5): o ISS não integra a base de PIS/COFINS (ingresso que apenas transita pelo patrimônio e pela contabilidade do contribuinte). Portal: ''Mérito julgado''.', '2026-10-21'::date, 'Não deliberada; proposta do rel. Fux (a partir da ata, ressalvando ações e débitos não pagos) fica para os ED.', 'firmada_modulacao_pendente', 'Usinagem sob encomenda com ISS; recuperar 5 anos exige ação antes da ata dos ED.', null, array['pis_cofins_aliquotas']::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=118', 'https://www.felsberg.com.br/stf-iss-base-calculo-pis-cofins-tema-118']::text[], 'alta'),
  ('STF', '843', 'RE 835.818', 'Crédito presumido de ICMS fora da base de PIS/COFINS', 'Julgado em 07/10/2026 (7×4): é incompatível com a Constituição a inclusão, na base de cálculo da COFINS e do PIS, de créditos presumidos do ICMS.', '2026-10-07'::date, 'Não analisada; pode vir em ED.', 'firmada_modulacao_pendente', 'Só se houver crédito outorgado de ICMS em SP.', null, '{}'::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=843']::text[], 'alta'),
  ('STF', '1067', 'RE 1.233.096', 'PIS/COFINS na própria base', 'Repercussão geral reconhecida em 18/10/2019; sem julgamento.', null, null, 'pendente', 'Valor residual: PIS/COFINS acabam em 2027; vale para o passado.', null, '{}'::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1067']::text[], 'alta'),
  ('STF', '1247', 'RE 1.390.517', 'Anterioridade nonagesimal na majoração indireta de PIS/COFINS', 'Redução de coeficientes de PIS/COFINS por decreto é majoração indireta e observa a anterioridade nonagesimal (art. 195 §6º). Trânsito 13/05/2023.', '2023-04-13'::date, null, 'firmada', null, null, '{}'::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1247']::text[], 'alta'),
  ('STF', 'ADC 49', 'ADC 49', 'Transferência entre estabelecimentos sem ICMS', 'Não incide ICMS na transferência entre estabelecimentos do mesmo titular; LC 204/2023 (vigência 01/01/2024) manteve os créditos; Convênio ICMS 109/2024.', '2021-04-19'::date, 'ED 19/04/2023: eficácia a partir do exercício de 2024, ressalvados processos pendentes até a ata de 29/04/2021.', 'firmada', null, null, '{}'::text[], array['https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/orientacao/2025.01.16_Cartilha_Remessa_M_Titular.pdf']::text[], 'alta'),
  ('STF', '1046', 'ARE 1.121.633', 'Negociado sobre legislado', 'São constitucionais os acordos e as convenções coletivos que pactuam limitações ou afastamentos de direitos trabalhistas, independentemente de vantagens compensatórias, desde que respeitados os direitos absolutamente indisponíveis.', '2022-06-02'::date, null, 'firmada', null, null, '{}'::text[], array['https://conexaotrabalho.portaldaindustria.com.br/publicacoes/detalhe/sindical/negociacao-coletiva/negociado-x-legislado-aplicacao-do-tema-1046-de-repercussao-geral-pelo-tst/']::text[], 'alta'),
  ('STF', '1401', 'RE 1.425.640', 'Trava de 30% na extinção da PJ', 'Repercussão geral reconhecida em 31/05/2025; pendente.', null, null, 'pendente', null, null, '{}'::text[], array['https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1401']::text[], 'alta'),
  ('STF', 'Reforma tributária (ADIs)', 'ADIs 7755, 7779, 7790, 7963, 7882, 7912–7954, 7920/7936/7944, ADPF 1334, ADI 8002', 'Ações contra a EC 132, a LC 214, a LC 227 e a LC 224/2025', 'ADIs 7779/7790 julgadas em 03/08/2026 (inconstitucional restringir a alíquota zero de IBS/CBS a PcD/TEA). As demais sem mérito. ADI 8002 (CNI) ataca a LC 224/2025 (Lucro Presumido). Nenhuma ação contra a EC 132 em si.', '2026-08-03'::date, null, 'pendente', 'A LC 224 pode cair; exceções da LC 214 podem ser revistas.', null, array['lucro_presumido_percentuais', 'reforma_creditos_e_regimes']::text[], array['https://apet.org.br/?p=142078', 'https://noticias.stf.jus.br/postsnoticias/stf-ouve-manifestacoes-sobre-isencao-tributaria-para-compra-de-veiculos-por-pessoas-com-deficiencia/']::text[], 'media'),
  ('STJ', '779', 'REsp 1.221.170', 'Conceito de insumo para PIS/COFINS', 'Ilegais as INs 247/2002 e 404/2004; insumo é o essencial ou relevante (imprescindibilidade ou importância) para a atividade. IN RFB 2.264/2025 atualizou a IN 2.121/2022.', '2018-02-22'::date, null, 'firmada', null, null, '{}'::text[], array['https://www.ibet.com.br/primeira-secao-define-conceito-de-insumo-para-creditamento-de-pis-e-cofins/']::text[], 'alta'),
  ('STJ', '1182', 'REsp 1.945.110', 'Benefícios de ICMS (exceto crédito presumido) no IRPJ/CSLL', 'Redução de base, isenção e diferimento só saem do IRPJ/CSLL se cumpridos o art. 10 da LC 160 e o art. 30 da Lei 12.973, sem exigir prova de estímulo à implantação. Lei 14.789/2023 revogou o art. 30 desde 01/01/2024.', '2023-04-26'::date, null, 'firmada', null, 'Vale até 2023; pós-2024 → Tema 1416.', '{}'::text[], array['https://trf3.jus.br/documentos/nuge/DR/STJ/2023/Decisa_o-Tema-1182-STJ.pdf']::text[], 'alta'),
  ('STJ', '1416', 'REsp 2.221.127', 'Crédito presumido de ICMS no IRPJ/CSLL antes e depois da Lei 14.789/2023', 'Afetado em 13/03/2026 com suspensão nacional; monocrática de 24/09/2026 manteve a exclusão.', null, null, 'pendente', 'Só se houver crédito outorgado em SP.', null, '{}'::text[], array['https://www.felsberg.com.br/tema-1416-stj-creditos-presumidos-icms-irpj-csll/']::text[], 'alta'),
  ('STJ', '1125', 'REsp 1.896.678', 'ICMS-ST fora da base de PIS/COFINS do substituído', 'O ICMS-ST não compõe a base de cálculo da Contribuição ao PIS e da COFINS devidas pelo contribuinte substituído.', '2023-12-13'::date, 'ED 20/06/2024 (DJe 26/06): marco 15/03/2017, ressalvadas ações até a sessão.', 'firmada', null, null, '{}'::text[], array['https://www.ibet.com.br/?p=94521']::text[], 'alta'),
  ('STJ', '1231', 'REsp 2.072.621', 'Reembolso do ICMS-ST ao substituto sem crédito de PIS/COFINS', 'O reembolso do ICMS-ST ao substituto não gera crédito de PIS/COFINS (desfavorável).', '2024-06-20'::date, null, 'firmada', null, null, '{}'::text[], array['https://www.conjur.com.br/2024-jun-27/reembolso-de-icms-st-nao-gera-credito-de-pis-e-cofins-diz-stj/']::text[], 'alta'),
  ('STJ', '1223', 'REsps 2.091.202 a 2.091.205', 'PIS/COFINS na base do ICMS', 'É legal a inclusão de PIS/COFINS na base do ICMS quando a base é o valor da operação (repasse econômico). Trânsito em julgado (desfavorável).', '2024-12-11'::date, null, 'firmada', null, 'Data a confirmar.', '{}'::text[], array['https://www.klalaw.com.br/stj-define-pis-cofins-incluidos-base-calculo-icms/']::text[], 'media'),
  ('STJ', '1364', 'REsp 2.150.097 e outros', 'Sem crédito de PIS/COFINS sobre o ICMS da compra', 'Vedada a apuração de crédito de PIS/COFINS sobre o valor do ICMS que incidiu na aquisição (Lei 14.592/2023, desde 01/05/2023). Unânime, Informativo 906.', '2026-10-14'::date, 'Não noticiada.', 'firmada', null, null, array['pis_cofins_aliquotas']::text[], array['https://www.contabeis.com.br/noticias/80243/stj-barra-credito-de-pis-e-cofins-sobre-icms-de-compras/']::text[], 'alta'),
  ('STJ', '1373', 'REsp 2.198.235', 'IPI não recuperável fora da base dos créditos de PIS/COFINS', 'IPI não recuperável não compõe a base de créditos de PIS/COFINS nas operações após a IN 2.121/2022 (20/12/2022). Desfavorável.', '2026-03-11'::date, null, 'firmada', null, null, '{}'::text[], array['https://juris.damasio.com.br/jurisprudencia/julgado/881/inclusao-do-ipi-nao-recuperavel-na-base-de-calculo-dos-creditos-de-pis-pasep-e-cofins']::text[], 'media'),
  ('STJ', '1372', 'REsp 2.174.178', 'ICMS-DIFAL fora da base de PIS/COFINS', 'O ICMS-DIFAL não compõe a base de cálculo da Contribuição ao PIS e da COFINS.', '2026-08-20'::date, 'Efeitos desde 15/03/2017, ressalvadas ações em curso.', 'firmada', null, null, array['pis_cofins_aliquotas']::text[], array['https://informativos.trilhante.com.br/temas-stj/tema-repetitivo-1372-stj', 'https://tagdlaw.com.br/icms-difal-nao-compoe-a-base-do-pis-cofins-decide-stj/']::text[], 'alta'),
  ('STJ', '1312', '—', 'PIS/COFINS na base do IRPJ/CSLL no Lucro Presumido', 'PIS/COFINS integram a base do IRPJ/CSLL no Lucro Presumido (contribuinte vencido).', '2026-03-01'::date, null, 'firmada', null, null, array['lucro_presumido_percentuais']::text[], array['https://pradvogados.com.br/2026/03/17/desfechos-e-pautas-dos-principais-julgamentos-tributarios-nos-tribunais-superiores-74/']::text[], 'media'),
  ('STJ', '1412', '—', 'Bonificações e descontos na base de PIS/COFINS', 'Pautado em 20/08/2026 e adiado sem data.', null, null, 'pendente', 'Compras com bonificação.', null, '{}'::text[], array['https://apet.org.br/?p=142215']::text[], 'alta'),
  ('STJ', '1079', 'REsp 1.898.532', 'Fim do teto de 20 SM para SESI/SENAI/SESC/SENAC', 'O DL 2.318/86 revogou o teto de 20 salários mínimos para as contribuições ao SESI, SENAI, SESC e SENAC.', '2024-03-13'::date, 'Quem tinha decisão favorável até 25/10/2023 mantém até a publicação do acórdão (02/05/2024).', 'firmada', null, null, array['terceiros_base_calculo']::text[], array['https://www.ibet.com.br/stj-afasta-limite-de-20-salarios-minimos-para-contribuicoes-ao-sistema-s/']::text[], 'alta'),
  ('STJ', '1390', 'REsp 2.187.625', 'Fim do teto de 20 SM para salário-educação, INCRA, SEBRAE, SEST/SENAT, SENAR e outros', 'Unânime em 11/02/2026: sem teto de 20 SM para as demais contribuições a terceiros.', '2026-02-11'::date, 'Negada no mérito; ED pautados em 07/05 e 20/08/2026, desfecho não confirmado.', 'firmada_modulacao_pendente', 'Risco de cobrança retroativa de 5 anos para quem recolhia pelo teto.', null, array['terceiros_base_calculo']::text[], array['https://pradvogados.com.br/2026/02/13/stj-fixa-tese-repetitiva-contribuicoes-a-terceiros-nao-tem-teto-de-20-salarios-minimos-na-base-de-calculo/', 'https://www.felsberg.com.br/stj-tema-1390-embargos-contribuicoes-terceiros/']::text[], 'alta'),
  ('STJ', '1174', 'REsp 2.005.029', 'Descontos do empregado não reduzem a base patronal', 'Descontos de VT, VR/VA, plano de saúde, IRRF e INSS do empregado são simples técnica de arrecadação e não reduzem a base da contribuição patronal, RAT e terceiros. Trânsito 19/12/2024.', '2024-08-14'::date, null, 'firmada', null, null, '{}'::text[], array['https://www.sedep.com.br/?p=149972']::text[], 'alta'),
  ('STJ', '478 e 1170', 'REsp 1.230.957; REsp 1.974.197', 'Aviso prévio indenizado e 13º proporcional', 'Tema 478 (26/02/2014): o aviso prévio indenizado não sofre contribuição patronal. Tema 1170 (13/03/2024): incide contribuição sobre o 13º proporcional ao aviso prévio indenizado.', '2024-03-13'::date, null, 'firmada', null, 'A Súmula 463 do STJ trata de IR sobre horas extras indenizadas, não do aviso prévio.', '{}'::text[], array['https://portal.trt3.jus.br/internet/jurisprudencia/stj-repetitivos/downloads/tema-1170-stj-acordao-de-merito-publicado.pdf']::text[], 'alta'),
  ('STJ', '1369', '—', 'DIFAL antes da LC 190 × Lei Kandir', 'Retirado de pauta; será repautado.', null, null, 'pendente', null, null, '{}'::text[], '{}'::text[], 'media'),
  ('CARF', 'Súmulas', '—', 'Decadência e multa qualificada; súmulas vinculantes para a RFB', 'Súmulas 72 (dolo/fraude → art. 173 I), 101 (termo inicial do 173 I), 104 (multa isolada → 173 I), 14 e 25 (omissão/presunção de receita, por si, não qualifica a multa). Portaria MF 1.785/2026 (DOU 22/06/2026) tornou vinculantes para a RFB as súmulas 188–238 (inclui créditos de PIS/COFINS e energia). 8 novas súmulas em 14/09/2026 ainda sem portaria.', '2026-06-22'::date, null, 'firmada', null, 'Enunciados não conferidos na página oficial (app JS).', '{}'::text[], array['https://carf.economia.gov.br/jurisprudencia/sumulas-carf', 'https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/tributario-ij/51-sumulas-do-carf-passam-a-valer-para-a-receita-federal-entenda-o-que-muda']::text[], 'media'),
  ('RFB', 'Soluções de Consulta Cosit', '—', 'Créditos de PIS/COFINS e retenções em indústria', 'EPI e uniforme: SC 183/2019 e 32/2020 (insumo quando exigido por lei na produção; SC DISIT 4.037/2023). Frete e seguro de insumo: SC 90/2025 (crédito mesmo com insumo a alíquota zero; IN 2.264/2025 art. 176). Frete de produto acabado entre filiais: SC 7/2016 negativa. Energia: SC 204/2021 (consumida sim; demanda contratada não), 267/2023, 6/2024. Manutenção e depreciação: SC 173/2020 (sim), SC 215/2025 (não, na locação). IPI por encomenda: SC 246/2025 (enviar desenhos não equipara a industrial); SC 107 e 200/2025 (suspensão do art. 43 VI/VII do RIPI não vale no Simples). Retenção de 11%: SC 28/2017 e 93/2021 (só com cessão de mão de obra: subordinação ao tomador); SC 25/2026 (instalação/manutenção em edificação existente, Simples: sem retenção).', '2026-01-01'::date, null, 'firmada', null, null, array['retencao_inss_11_cessao_mao_de_obra', 'pis_cofins_aliquotas']::text[], array['https://netcpa.com.br/colunas/solucao-de-consulta-cosit-no-2462025-ipi-equiparacao-a-industrial-remessa-de-desenhos-eou-especificacoes-tecnicas-de-pecas-ou-equipamentos-nao-caracterizacao/26916', 'https://capitalaberto.com.br/opiniao/artigos/2025/08/solucao-de-consulta-n-90-cosit-frete-e-seguro-de-insumo-dao-direito-a-creditos-de-pis-e-cofins', 'https://www.iobonline.com.br/Repository/ServContent?guid=SolucaoConsultaCosit_25_2026']::text[], 'media'),
  ('PGFN', 'Pareceres SEI', '—', 'Pareceres vinculantes 2025–2026', '4366/2025 (REDLIT): orientação sobre a modulação do Tema 985 (15/09/2020). 784/2026: a modulação não alcança a cota do empregado. 592/2026: multa de CSLL (Temas 881/885), lista 1.26 ''h''. 1535/2026: concomitância de multa isolada e de ofício, lista 1.26 ''j''.', '2026-01-01'::date, null, 'firmada', null, 'PDFs vieram sem texto; conferir a íntegra.', '{}'::text[], array['https://www.gov.br/pgfn/pt-br/assuntos/representacao-judicial/temas-com-dispensa-de-contestar-e-recorrer/parecer-sei-no-4366-2025-redlit.pdf']::text[], 'media'),
  ('TST', 'Súmula 172 e OJ 394 (IRR Tema 9)', '—', 'DSR sobre horas extras habituais', 'HE habituais integram o DSR (Súm. 172). OJ 394 revista em 20/03/2023: o DSR majorado repercute em férias, 13º, aviso prévio e FGTS, só para parcelas exigíveis a partir de 20/03/2023 (trânsito 27/06/2023).', '2023-03-20'::date, 'Parcelas a partir de 20/03/2023.', 'firmada', null, null, '{}'::text[], array['https://www.coad.com.br/home/noticias-detalhe/118314/integracao-de-horas-extras-habituais-no-repouso-semanal-repercute-nas-demais-parcelas-salariais']::text[], 'alta'),
  ('TST', 'Súmula 60 e CLT art. 73 §1º', '—', 'Adicional noturno e hora reduzida', 'Adicional noturno devido nas horas prorrogadas após jornada noturna integral (Súm. 60-II); hora noturna de 52 minutos e 30 segundos.', null, null, 'firmada', null, null, '{}'::text[], '{}'::text[], 'alta'),
  ('TST', 'IRR-239-55.2011.5.02.0319', '—', 'Insalubridade e periculosidade não cumulam', 'SDI-1, 26/09/2019: o art. 193 §2º da CLT foi recepcionado; os adicionais não se acumulam, mesmo com fatos geradores distintos (opção pelo mais favorável).', '2019-09-26'::date, null, 'firmada', null, null, '{}'::text[], array['https://portal.trt3.jus.br/internet/jurisprudencia/incidentes-suscitados-irr-iac-arginc-tst/downloads/irr/IRR_239_55_2011_5_02_0319.pdf']::text[], 'alta'),
  ('TST', 'Súmula 441', '—', 'Aviso prévio proporcional', 'Aviso proporcional (Lei 12.506: 30 dias + 3 por ano, teto de 90) só para rescisões a partir de 13/10/2011.', '2011-10-13'::date, null, 'firmada', null, null, '{}'::text[], array['https://www.meuvademecumonline.com.br/legislacao/sumulas_tst/22/pagina_18/sumula-tst-441/']::text[], 'alta')
) as v (tribunal, tema, leading_case, titulo, tese, data, modulacao, situacao, impacto, observacao, parametros_afetados, fontes, confianca)
on conflict on constraint contabil_teses_unica do nothing;
