-- ============================================================================
-- Núcleo contábil, parte 1 (Contábil-Fiscal, N-04): o motor de escrituração
-- (26/10/2026, pedido do proprietário; desenho em docs/PLANO-CONTABIL-FISCAL.md §3.5)
-- ============================================================================
-- Plano de contas contábil como dado (importado da ECD ou de planilha; um plano de exemplo para testar, separado
-- do oficial), vínculos (conta gerencial, conta bancária e papéis → conta contábil), regras de lançamento por evento
-- com vigência, lançamentos em partida dobrada (débito = crédito, conferido no banco), estorno que nunca apaga e
-- trava por competência. Escrituração é regra determinística: sem modelo. Tudo por organização, com RLS; quem tem
-- fiscal.contabilidade vê, e só as funções abaixo escrevem.
-- ============================================================================

insert into public.access_features (code, module_code, label, levels, sort)
values ('fiscal.contabilidade', 'fiscal', 'Contabilidade', '{ver,operar}', 76)
on conflict (code) do update set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

create or replace function public.contabil_escrita_pode_ver() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.contabilidade', 'ver');
$$;
create or replace function public.contabil_escrita_pode_operar() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.contabilidade', 'operar');
$$;
revoke all on function public.contabil_escrita_pode_ver() from public, anon;
revoke all on function public.contabil_escrita_pode_operar() from public, anon;
grant execute on function public.contabil_escrita_pode_ver() to authenticated;
grant execute on function public.contabil_escrita_pode_operar() to authenticated;

-- Planos de contas da empresa. Só um é o oficial; o de exemplo serve para testar o motor sem misturar com o oficial.
create table if not exists public.contabil_planos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 3 and 120),
  origem text not null check (origem in ('exemplo', 'ecd', 'planilha')),
  oficial boolean not null default false,
  abertura date,
  observacao text,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now()
);
create unique index if not exists contabil_planos_um_oficial on public.contabil_planos (organization_id) where oficial;
comment on table public.contabil_planos is 'Planos de contas contábeis da empresa (N-04). Um oficial por empresa; o de exemplo testa o motor. abertura = data dos saldos iniciais.';

create table if not exists public.contabil_contas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plano_id uuid not null references public.contabil_planos(id) on delete cascade,
  codigo text not null check (length(btrim(codigo)) between 1 and 60),
  nome text not null check (length(btrim(nome)) between 1 and 200),
  natureza text not null check (natureza in ('ativo', 'passivo', 'pl', 'resultado', 'compensacao', 'outras')),
  tipo text not null check (tipo in ('sintetica', 'analitica')),
  nivel integer not null check (nivel between 1 and 20),
  superior_codigo text,
  referencial text,
  ativa boolean not null default true,
  unique (plano_id, codigo)
);
create index if not exists contabil_contas_plano on public.contabil_contas (plano_id, codigo);
comment on table public.contabil_contas is 'Contas do plano contábil (ECD I050/I051): natureza, sintética ou analítica, nível, superior e conta referencial da Receita.';

-- De onde o motor tira a conta: cada conta gerencial, cada conta bancária e cada papel (contas a pagar, juros…).
create table if not exists public.contabil_vinculos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plano_id uuid not null references public.contabil_planos(id) on delete cascade,
  origem text not null check (origem in ('conta_gerencial', 'conta_bancaria', 'papel')),
  chave text not null check (length(chave) between 2 and 80),
  conta_id uuid not null references public.contabil_contas(id) on delete cascade,
  situacao text not null default 'confirmado' check (situacao in ('proposto', 'confirmado')),
  atualizado_por_nome text,
  updated_at timestamptz not null default now(),
  unique (plano_id, origem, chave)
);
comment on table public.contabil_vinculos is 'De-para para a escrituração: conta gerencial, conta bancária ou papel (contas_a_pagar, juros_pagos…) → conta contábil analítica do plano.';

-- Regras de lançamento por evento, com vigência. organization_id nulo = padrão da plataforma; a da empresa vale mais.
create table if not exists public.contabil_regras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  evento text not null check (evento in ('titulo_pagar', 'titulo_receber', 'baixa_pagar', 'baixa_receber')),
  descricao text not null,
  partidas jsonb not null check (jsonb_typeof(partidas) = 'array' and jsonb_array_length(partidas) >= 2),
  vigente_de date not null,
  vigente_ate date,
  created_at timestamptz not null default now(),
  check (vigente_ate is null or vigente_ate >= vigente_de)
);
comment on table public.contabil_regras is 'Regra de lançamento (evento → partidas) com vigência. Cada partida: lado D/C, conta (alocacao | banco | papel:<nome>) e valor (valor | alocacao | principal | juros | multa | desconto | caixa).';

create table if not exists public.contabil_lancamentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plano_id uuid not null references public.contabil_planos(id) on delete cascade,
  data date not null,
  competencia text not null check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  historico text not null check (length(btrim(historico)) between 3 and 500),
  origem_tipo text not null check (origem_tipo in ('titulo', 'baixa', 'abertura', 'manual', 'estorno')),
  origem_id uuid,
  regra_id uuid references public.contabil_regras(id) on delete set null,
  estorno_de uuid references public.contabil_lancamentos(id) on delete restrict,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now()
);
create unique index if not exists contabil_lancamentos_origem on public.contabil_lancamentos (plano_id, origem_tipo, origem_id)
  where origem_id is not null and origem_tipo in ('titulo', 'baixa', 'abertura');
create unique index if not exists contabil_lancamentos_um_estorno on public.contabil_lancamentos (estorno_de) where estorno_de is not null;
create index if not exists contabil_lancamentos_data on public.contabil_lancamentos (plano_id, data);
comment on table public.contabil_lancamentos is 'Cabeçalho do lançamento contábil. Automático (título, baixa, abertura) é único pela origem; manual tem histórico; estorno aponta o original e nada se apaga.';

create table if not exists public.contabil_partidas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lancamento_id uuid not null references public.contabil_lancamentos(id) on delete cascade,
  conta_id uuid not null references public.contabil_contas(id) on delete restrict,
  lado text not null check (lado in ('D', 'C')),
  valor numeric(15,2) not null check (valor > 0),
  centro_custo_id uuid references public.finance_cost_centers(id) on delete set null,
  ordem integer not null default 0
);
create index if not exists contabil_partidas_lancamento on public.contabil_partidas (lancamento_id);
create index if not exists contabil_partidas_conta on public.contabil_partidas (conta_id);
comment on table public.contabil_partidas is 'Partidas (débito e crédito) de cada lançamento; a soma dos débitos é igual à dos créditos, conferida no banco.';

create table if not exists public.contabil_periodos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plano_id uuid not null references public.contabil_planos(id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  situacao text not null default 'aberto' check (situacao in ('aberto', 'fechado')),
  motivo text,
  atualizado_por_nome text,
  updated_at timestamptz not null default now(),
  primary key (plano_id, competencia)
);
comment on table public.contabil_periodos is 'Trava por competência: com o mês fechado, nada entra nem sai dele; reabrir pede motivo.';

-- Débito = crédito em todo lançamento, conferido no fim da transação (o lançamento entra com as partidas juntas).
create or replace function public.contabil_conferir_partidas() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l uuid := coalesce(new.lancamento_id, old.lancamento_id);
  d numeric; c numeric; n integer;
begin
  if not exists (select 1 from public.contabil_lancamentos where id = l) then return null; end if;
  select coalesce(sum(valor) filter (where lado = 'D'), 0), coalesce(sum(valor) filter (where lado = 'C'), 0), count(*)
    into d, c, n from public.contabil_partidas where lancamento_id = l;
  if n < 2 or d <> c then raise exception 'Lançamento sem partida dobrada: débitos % e créditos %.', d, c; end if;
  return null;
end;
$$;
drop trigger if exists contabil_partidas_dobrada on public.contabil_partidas;
create constraint trigger contabil_partidas_dobrada after insert or update or delete on public.contabil_partidas
  deferrable initially deferred for each row execute function public.contabil_conferir_partidas();

-- Conta da partida: analítica, ativa, do mesmo plano e da mesma empresa do lançamento.
create or replace function public.contabil_conferir_conta() returns trigger
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select (c.tipo = 'analitica' and c.ativa and c.plano_id = l.plano_id and c.organization_id = l.organization_id and new.organization_id = l.organization_id)
    into ok from public.contabil_contas c, public.contabil_lancamentos l where c.id = new.conta_id and l.id = new.lancamento_id;
  if not coalesce(ok, false) then raise exception 'A partida só vai para conta analítica ativa do mesmo plano.'; end if;
  return new;
end;
$$;
drop trigger if exists contabil_partidas_conta on public.contabil_partidas;
create trigger contabil_partidas_conta before insert or update on public.contabil_partidas for each row execute function public.contabil_conferir_conta();

-- Mês fechado não recebe nem perde lançamento.
create or replace function public.contabil_conferir_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.contabil_lancamentos := coalesce(new, old);
begin
  if exists (select 1 from public.contabil_periodos where plano_id = r.plano_id and competencia = r.competencia and situacao = 'fechado') then
    raise exception 'A competência % está fechada.', r.competencia using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists contabil_lancamentos_periodo on public.contabil_lancamentos;
create trigger contabil_lancamentos_periodo before insert or update or delete on public.contabil_lancamentos for each row execute function public.contabil_conferir_periodo();

-- Leitura: quem tem a Contabilidade, na própria empresa. Escrita: só pelas funções.
do $$
declare t text;
begin
  foreach t in array array['contabil_planos', 'contabil_contas', 'contabil_vinculos', 'contabil_lancamentos', 'contabil_partidas', 'contabil_periodos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = (select public.current_organization_id()) and (select public.contabil_escrita_pode_ver()))', t || '_leitura', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.contabil_regras enable row level security;
drop policy if exists contabil_regras_leitura on public.contabil_regras;
create policy contabil_regras_leitura on public.contabil_regras for select to authenticated
  using ((organization_id is null or organization_id = (select public.current_organization_id())) and (select public.contabil_escrita_pode_ver()));
revoke all on public.contabil_regras from anon;
revoke insert, update, delete on public.contabil_regras from authenticated;
grant select on public.contabil_regras to authenticated;

-- Registro: auditoria + evento do módulo Fiscal.
create or replace function public.contabil_escrita_registrar(p_org uuid, p_evento text, p_entidade text, p_id uuid, p_frase text, p_detalhes jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (p_org, auth.uid(), public.current_profile_id(), 'fiscal', p_entidade || '.' || split_part(p_evento, '.', 3), p_entidade, p_id, 'high', p_detalhes);
  perform public.emit_module_event(p_org, 'fiscal', p_evento, p_entidade, p_id::text, p_frase, p_detalhes);
end;
$$;
revoke all on function public.contabil_escrita_registrar(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;

-- Grava um lançamento com as partidas. Uso interno: quem chama já conferiu a permissão e a empresa.
-- p_partidas: [{conta_id, lado, valor, centro_custo_id?}]
create or replace function public.contabil_gravar_lancamento(p_org uuid, p_plano uuid, p_data date, p_historico text, p_origem_tipo text, p_origem_id uuid,
  p_regra uuid, p_estorno_de uuid, p_partidas jsonb, p_autor uuid, p_autor_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid; p jsonb; k integer := 0; d numeric; c numeric;
begin
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = p_org) then raise exception 'Plano de contas não encontrado.'; end if;
  insert into public.contabil_lancamentos (organization_id, plano_id, data, competencia, historico, origem_tipo, origem_id, regra_id, estorno_de, criado_por, criado_por_nome)
  values (p_org, p_plano, p_data, to_char(p_data, 'YYYY-MM'), left(btrim(p_historico), 500), p_origem_tipo, p_origem_id, p_regra, p_estorno_de, p_autor, p_autor_nome)
  on conflict do nothing
  returning id into novo;
  if novo is null then return null; end if; -- automático já lançado
  for p in select * from jsonb_array_elements(p_partidas) loop
    k := k + 1;
    insert into public.contabil_partidas (organization_id, lancamento_id, conta_id, lado, valor, centro_custo_id, ordem)
    values (p_org, novo, (p->>'conta_id')::uuid, p->>'lado', round((p->>'valor')::numeric, 2), nullif(p->>'centro_custo_id', '')::uuid, k);
  end loop;
  -- Conferido já aqui, com mensagem clara; o gatilho adiado repete no fim da transação.
  select coalesce(sum(valor) filter (where lado = 'D'), 0), coalesce(sum(valor) filter (where lado = 'C'), 0) into d, c from public.contabil_partidas where lancamento_id = novo;
  if k < 2 or d <> c then raise exception 'Lançamento sem partida dobrada: débitos % e créditos %.', d, c; end if;
  return novo;
end;
$$;
revoke all on function public.contabil_gravar_lancamento(uuid, uuid, date, text, text, uuid, uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;

-- Escrituração automática em lote, pelo servidor (a rota confere fiscal.contabilidade operar antes).
-- p_lote: [{data, historico, origem_tipo, origem_id, regra_id, partidas:[…]}]. Devolve quantos entraram.
create or replace function public.contabil_escriturar_lote(p_org uuid, p_plano uuid, p_lote jsonb, p_autor uuid, p_autor_nome text)
returns integer language plpgsql security definer set search_path = public as $$
declare l jsonb; n integer := 0; novo uuid;
begin
  for l in select * from jsonb_array_elements(p_lote) loop
    if l->>'origem_tipo' not in ('titulo', 'baixa', 'abertura') then raise exception 'Origem automática inválida.'; end if;
    novo := public.contabil_gravar_lancamento(p_org, p_plano, (l->>'data')::date, l->>'historico', l->>'origem_tipo', (l->>'origem_id')::uuid,
      nullif(l->>'regra_id', '')::uuid, null, l->'partidas', p_autor, p_autor_nome);
    if novo is not null then n := n + 1; end if;
  end loop;
  if n > 0 then
    insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
    values (p_org, null, p_autor, 'fiscal', 'contabil_lancamentos.escriturado', 'contabil_planos', p_plano, 'medium', jsonb_build_object('lancamentos', n));
    perform public.emit_module_event(p_org, 'fiscal', 'fiscal.escrituracao.lote', 'contabil_planos', p_plano::text,
      format('%s: %s lançamento(s) automático(s) escriturado(s)', coalesce(p_autor_nome, 'Plataforma'), n), jsonb_build_object('lancamentos', n));
  end if;
  return n;
end;
$$;
revoke all on function public.contabil_escriturar_lote(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.contabil_escriturar_lote(uuid, uuid, jsonb, uuid, text) to service_role;

-- Lançamento manual: histórico obrigatório, partida dobrada, mês aberto.
create or replace function public.contabil_lancamento_manual(p_plano uuid, p_data date, p_historico text, p_partidas jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); novo uuid; nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão para lançar na contabilidade.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_historico, ''))) < 10 then raise exception 'O histórico explica o lançamento (10 caracteres ou mais).'; end if;
  novo := public.contabil_gravar_lancamento(org, p_plano, p_data, p_historico, 'manual', null, null, null, p_partidas, public.current_profile_id(), nome);
  perform public.contabil_escrita_registrar(org, 'fiscal.lancamento_contabil.manual', 'contabil_lancamentos', novo, format('Lançamento manual em %s: %s', to_char(p_data, 'DD/MM/YYYY'), left(p_historico, 120)), jsonb_build_object('plano_id', p_plano));
  return novo;
end;
$$;

-- Estorno: lançamento inverso com o motivo; o original fica.
create or replace function public.contabil_estornar(p_lancamento uuid, p_data date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  l public.contabil_lancamentos;
  novo uuid;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão para estornar.' using errcode = '42501'; end if;
  select * into l from public.contabil_lancamentos where id = p_lancamento and organization_id = org;
  if l.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if l.origem_tipo = 'estorno' then raise exception 'Um estorno não se estorna: lance de novo.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Diga o motivo do estorno (10 caracteres ou mais).'; end if;
  novo := public.contabil_gravar_lancamento(org, l.plano_id, coalesce(p_data, l.data), format('Estorno: %s (motivo: %s)', l.historico, btrim(p_motivo)), 'estorno', null, null, l.id,
    (select jsonb_agg(jsonb_build_object('conta_id', conta_id, 'lado', case lado when 'D' then 'C' else 'D' end, 'valor', valor, 'centro_custo_id', centro_custo_id) order by ordem)
       from public.contabil_partidas where lancamento_id = l.id),
    public.current_profile_id(), nome);
  if novo is null then raise exception 'Este lançamento já foi estornado.'; end if;
  perform public.contabil_escrita_registrar(org, 'fiscal.lancamento_contabil.estornado', 'contabil_lancamentos', l.id, format('Estornou o lançamento de %s: %s', to_char(l.data, 'DD/MM/YYYY'), left(p_motivo, 120)), jsonb_build_object('estorno_id', novo));
  return novo;
end;
$$;

-- Plano de contas: importar (ECD, planilha ou o de exemplo). p_contas: [{codigo, nome, natureza, tipo, nivel, superior_codigo?, referencial?}]
create or replace function public.contabil_plano_importar(p_nome text, p_origem text, p_contas jsonb, p_vinculos jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  novo uuid;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
  n integer;
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão para importar plano de contas.' using errcode = '42501'; end if;
  insert into public.contabil_planos (organization_id, nome, origem, criado_por, criado_por_nome) values (org, btrim(p_nome), p_origem, public.current_profile_id(), nome) returning id into novo;
  insert into public.contabil_contas (organization_id, plano_id, codigo, nome, natureza, tipo, nivel, superior_codigo, referencial)
  select org, novo, btrim(c->>'codigo'), btrim(c->>'nome'), c->>'natureza', c->>'tipo', (c->>'nivel')::integer, nullif(btrim(c->>'superior_codigo'), ''), nullif(btrim(c->>'referencial'), '')
  from jsonb_array_elements(p_contas) c;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'O plano veio sem contas.'; end if;
  -- Vínculos que já vêm com o plano (o de exemplo traz os papéis): [{origem, chave, codigo}]
  insert into public.contabil_vinculos (organization_id, plano_id, origem, chave, conta_id, situacao, atualizado_por_nome)
  select org, novo, v->>'origem', v->>'chave', c.id, 'proposto', nome
  from jsonb_array_elements(coalesce(p_vinculos, '[]')) v join public.contabil_contas c on c.plano_id = novo and c.codigo = v->>'codigo' and c.tipo = 'analitica';
  perform public.contabil_escrita_registrar(org, 'fiscal.plano_contabil.importado', 'contabil_planos', novo, format('Importou o plano de contas "%s" (%s contas)', btrim(p_nome), n), jsonb_build_object('origem', p_origem, 'contas', n));
  return novo;
end;
$$;

-- Plano oficial (um por empresa) e data de abertura.
create or replace function public.contabil_plano_definir(p_plano uuid, p_oficial boolean, p_abertura date)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); p public.contabil_planos;
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into p from public.contabil_planos where id = p_plano and organization_id = org;
  if p.id is null then raise exception 'Plano não encontrado.'; end if;
  if p_oficial and p.origem = 'exemplo' then raise exception 'O plano de exemplo não pode ser o oficial.'; end if;
  if p_oficial then update public.contabil_planos set oficial = false where organization_id = org and oficial and id <> p_plano; end if;
  update public.contabil_planos set oficial = p_oficial, abertura = p_abertura where id = p_plano;
  perform public.contabil_escrita_registrar(org, 'fiscal.plano_contabil.definido', 'contabil_planos', p_plano,
    format('Plano "%s": %s, abertura em %s', p.nome, case when p_oficial then 'oficial' else 'não oficial' end, coalesce(to_char(p_abertura, 'DD/MM/YYYY'), '—')), jsonb_build_object('oficial', p_oficial, 'abertura', p_abertura));
end;
$$;

-- Apagar um plano só enquanto não tem lançamento (o de exemplo, depois do teste).
create or replace function public.contabil_plano_apagar(p_plano uuid)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); p public.contabil_planos;
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into p from public.contabil_planos where id = p_plano and organization_id = org;
  if p.id is null then raise exception 'Plano não encontrado.'; end if;
  if p.oficial then raise exception 'O plano oficial não se apaga.'; end if;
  if p.origem <> 'exemplo' and exists (select 1 from public.contabil_lancamentos where plano_id = p_plano) then raise exception 'Plano com lançamentos: estorne antes ou mantenha.'; end if;
  delete from public.contabil_periodos where plano_id = p_plano;
  delete from public.contabil_lancamentos where plano_id = p_plano and estorno_de is not null;
  delete from public.contabil_lancamentos where plano_id = p_plano;
  delete from public.contabil_planos where id = p_plano;
  perform public.contabil_escrita_registrar(org, 'fiscal.plano_contabil.apagado', 'contabil_planos', p_plano, format('Apagou o plano de contas "%s"', p.nome), jsonb_build_object('origem', p.origem));
end;
$$;

-- Vínculo (de-para) confirmado por quem opera; conta nula apaga o vínculo.
create or replace function public.contabil_vincular(p_plano uuid, p_origem text, p_chave text, p_conta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = org) then raise exception 'Plano não encontrado.'; end if;
  if p_conta is null then
    delete from public.contabil_vinculos where plano_id = p_plano and origem = p_origem and chave = p_chave;
    return;
  end if;
  if not exists (select 1 from public.contabil_contas where id = p_conta and plano_id = p_plano and tipo = 'analitica' and ativa) then raise exception 'Escolha uma conta analítica deste plano.'; end if;
  insert into public.contabil_vinculos (organization_id, plano_id, origem, chave, conta_id, situacao, atualizado_por_nome, updated_at)
  values (org, p_plano, p_origem, p_chave, p_conta, 'confirmado', nome, now())
  on conflict (plano_id, origem, chave) do update set conta_id = excluded.conta_id, situacao = 'confirmado', atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now();
end;
$$;

-- Fechar e reabrir a competência.
create or replace function public.contabil_periodo_definir(p_plano uuid, p_competencia text, p_fechar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_organization_id(); nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.contabil_escrita_pode_operar() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not exists (select 1 from public.contabil_planos where id = p_plano and organization_id = org) then raise exception 'Plano não encontrado.'; end if;
  if not p_fechar and length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Reabrir pede o motivo (10 caracteres ou mais).'; end if;
  insert into public.contabil_periodos (organization_id, plano_id, competencia, situacao, motivo, atualizado_por_nome, updated_at)
  values (org, p_plano, p_competencia, case when p_fechar then 'fechado' else 'aberto' end, nullif(btrim(coalesce(p_motivo, '')), ''), nome, now())
  on conflict (plano_id, competencia) do update set situacao = excluded.situacao, motivo = excluded.motivo, atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now();
  perform public.contabil_escrita_registrar(org, case when p_fechar then 'fiscal.periodo_contabil.fechado' else 'fiscal.periodo_contabil.reaberto' end, 'contabil_periodos', p_plano,
    format('%s a competência %s%s', case when p_fechar then 'Fechou' else 'Reabriu' end, p_competencia, case when p_fechar then '' else ': ' || btrim(p_motivo) end), jsonb_build_object('competencia', p_competencia));
end;
$$;

-- Balancete: saldo anterior, débitos, créditos e saldo final de cada conta analítica no período (as sintéticas
-- somam na tela). Saldo com sinal: débito positivo.
create or replace function public.contabil_balancete(p_plano uuid, p_de date, p_ate date)
returns table (conta_id uuid, anterior numeric, debitos numeric, creditos numeric)
language sql stable security invoker set search_path = public as $$
  select p.conta_id,
    coalesce(sum(case when l.data < p_de then case p.lado when 'D' then p.valor else -p.valor end end), 0),
    coalesce(sum(p.valor) filter (where l.data between p_de and p_ate and p.lado = 'D'), 0),
    coalesce(sum(p.valor) filter (where l.data between p_de and p_ate and p.lado = 'C'), 0)
  from public.contabil_partidas p join public.contabil_lancamentos l on l.id = p.lancamento_id
  where l.plano_id = p_plano and l.data <= p_ate
  group by p.conta_id;
$$;
grant execute on function public.contabil_balancete(uuid, date, date) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['contabil_lancamento_manual(uuid, date, text, jsonb)', 'contabil_estornar(uuid, date, text)', 'contabil_plano_importar(text, text, jsonb, jsonb)',
    'contabil_plano_definir(uuid, boolean, date)', 'contabil_plano_apagar(uuid)', 'contabil_vincular(uuid, text, text, uuid)', 'contabil_periodo_definir(uuid, text, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Regras padrão da plataforma (2026 em diante). Papéis: contas_a_pagar, contas_a_receber, juros_pagos, multas_pagas,
-- descontos_obtidos, juros_recebidos, multas_recebidas, descontos_concedidos. "alocacao" = a conta contábil ligada à
-- conta gerencial de cada rateio do título; "banco" = a ligada à conta bancária da baixa.
insert into public.contabil_regras (organization_id, evento, descricao, partidas, vigente_de)
select null, e, d, p::jsonb, date '2000-01-01' from (values
  ('titulo_pagar', 'Título a pagar: a despesa, o custo ou o ativo do rateio contra contas a pagar',
   '[{"lado":"D","conta":"alocacao","valor":"alocacao"},{"lado":"C","conta":"papel:contas_a_pagar","valor":"valor"}]'),
  ('titulo_receber', 'Título a receber: contas a receber contra a receita do rateio',
   '[{"lado":"D","conta":"papel:contas_a_receber","valor":"valor"},{"lado":"C","conta":"alocacao","valor":"alocacao"}]'),
  ('baixa_pagar', 'Pagamento: baixa de contas a pagar, juros e multa pagos, desconto obtido, saída do banco',
   '[{"lado":"D","conta":"papel:contas_a_pagar","valor":"principal"},{"lado":"D","conta":"papel:juros_pagos","valor":"juros"},{"lado":"D","conta":"papel:multas_pagas","valor":"multa"},{"lado":"C","conta":"papel:descontos_obtidos","valor":"desconto"},{"lado":"C","conta":"banco","valor":"caixa"}]'),
  ('baixa_receber', 'Recebimento: entrada no banco, desconto concedido, baixa de contas a receber, juros e multa recebidos',
   '[{"lado":"D","conta":"banco","valor":"caixa"},{"lado":"D","conta":"papel:descontos_concedidos","valor":"desconto"},{"lado":"C","conta":"papel:contas_a_receber","valor":"principal"},{"lado":"C","conta":"papel:juros_recebidos","valor":"juros"},{"lado":"C","conta":"papel:multas_recebidas","valor":"multa"}]')
) as r(e, d, p)
where not exists (select 1 from public.contabil_regras x where x.organization_id is null and x.evento = r.e);
