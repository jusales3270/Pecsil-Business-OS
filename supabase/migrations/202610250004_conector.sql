-- Conector universal, C1 e C2 (docs/PLANO-CONECTOR.md; prioridade máxima do proprietário, 22/10/2026).
--
-- Área de chegada: as fontes (um ERP, um banco antigo, uma pasta), cada remessa e cada registro bruto, com a origem
-- e o sha256 do conteúdo. Registro igual não entra de novo; alterado vira nova versão. A área de chegada NÃO é o
-- cadastro: nada daqui muda fornecedor, cliente ou material sozinho. O de-para liga o registro de origem ao
-- cadastro da plataforma: a regra sugere e quem pode alterar aquele cadastro aprova (decisão da área).
-- Só o proprietário lê; quem grava a área de chegada é o servidor (a rota do conector, com o segredo da fonte).

create table if not exists public.conector_fontes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 60),
  -- O sistema de origem (ex.: GRV), para quem lê.
  sistema text check (sistema is null or length(btrim(sistema)) between 2 and 60),
  tipo text not null check (tipo in ('postgres', 'sqlserver', 'firebird', 'mysql', 'pasta', 'api')),
  -- 1 API, 2 banco só leitura, 3 arquivos, 4 computer use (o mais confiável que a fonte permitir).
  degrau smallint not null check (degrau between 1 and 4),
  -- Só o hash do segredo do conector (o segredo aparece uma vez, na criação).
  segredo_hash text not null check (segredo_hash ~ '^[0-9a-f]{64}$'),
  ativo boolean not null default true,
  -- O que extrair: [{ nome, consulta, chave: [campos] }] (consultas só de leitura; o conector confere de novo).
  objetos jsonb not null default '[]'::jsonb check (jsonb_typeof(objetos) = 'array'),
  intervalo_min integer not null default 60 check (intervalo_min between 5 and 1440),
  -- Pedido de descoberta do esquema (o conector faz na próxima tarefa).
  descobrir boolean not null default true,
  descoberta jsonb,
  descoberta_em timestamptz,
  ultimo_contato timestamptz,
  versao_conector text check (versao_conector is null or length(versao_conector) <= 40),
  ultimo_erro text check (ultimo_erro is null or length(ultimo_erro) <= 500),
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conector_fontes_nome_unico unique (organization_id, nome)
);

create table if not exists public.conector_lotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fonte_id uuid not null references public.conector_fontes(id) on delete cascade,
  tipo text not null check (tipo in ('descoberta', 'carga')),
  objeto text check (objeto is null or length(objeto) between 1 and 120),
  recebidos integer not null default 0,
  novos integer not null default 0,
  alterados integer not null default 0,
  iguais integer not null default 0,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  erro text check (erro is null or length(erro) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists conector_lotes_fonte on public.conector_lotes (fonte_id, created_at desc);

create table if not exists public.conector_registros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fonte_id uuid not null references public.conector_fontes(id) on delete cascade,
  objeto text not null check (length(objeto) between 1 and 120),
  -- A chave do registro na origem (os campos da chave, juntos).
  chave text not null check (length(chave) between 1 and 300),
  dados jsonb not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  versao integer not null default 1,
  sha256_anterior text check (sha256_anterior is null or sha256_anterior ~ '^[0-9a-f]{64}$'),
  lote_id uuid references public.conector_lotes(id) on delete set null,
  primeira_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  alterado_em timestamptz not null default now(),
  constraint conector_registros_unico unique (fonte_id, objeto, chave)
);
create index if not exists conector_registros_objeto on public.conector_registros (fonte_id, objeto, alterado_em desc);

create table if not exists public.conector_depara (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fonte_id uuid not null references public.conector_fontes(id) on delete cascade,
  objeto text not null,
  chave text not null,
  entidade text not null check (entidade in ('fornecedor', 'cliente', 'material', 'produto')),
  destino_id uuid not null,
  situacao text not null default 'sugerida' check (situacao in ('sugerida', 'aprovada', 'recusada')),
  origem text not null check (origem in ('regra', 'ia', 'pessoa')),
  confianca numeric(4, 3) check (confianca is null or confianca between 0 and 1),
  motivo text check (motivo is null or length(motivo) <= 300),
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_por_nome text,
  decidido_em timestamptz,
  created_at timestamptz not null default now(),
  constraint conector_depara_unico unique (fonte_id, objeto, chave, entidade)
);
create index if not exists conector_depara_fila on public.conector_depara (entidade, situacao, created_at);

comment on table public.conector_fontes is 'Conector universal: as fontes de dados (ERP, banco antigo, pasta). Segredo só em hash. Só o proprietário. PLANO-CONECTOR.';
comment on table public.conector_registros is 'Área de chegada: registro bruto de uma fonte (uma vez só por sha256; alterado vira nova versão). Não é o cadastro. PLANO-CONECTOR.';
comment on table public.conector_depara is 'De-para do conector: registro de origem → cadastro da plataforma. A regra sugere; quem pode alterar o cadastro aprova. PLANO-CONECTOR.';

drop trigger if exists conector_fontes_updated_at on public.conector_fontes;
create trigger conector_fontes_updated_at before update on public.conector_fontes for each row execute function public.set_updated_at();

alter table public.conector_fontes enable row level security;
alter table public.conector_lotes enable row level security;
alter table public.conector_registros enable row level security;
alter table public.conector_depara enable row level security;

-- Só o proprietário lê a área de chegada (pode ter dado pessoal de um sistema antigo).
drop policy if exists conector_fontes_dono on public.conector_fontes;
create policy conector_fontes_dono on public.conector_fontes for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
drop policy if exists conector_lotes_dono on public.conector_lotes;
create policy conector_lotes_dono on public.conector_lotes for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
drop policy if exists conector_registros_dono on public.conector_registros;
create policy conector_registros_dono on public.conector_registros for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
-- O de-para: o proprietário e quem pode alterar o cadastro daquela entidade (a área decide).
create or replace function public.conector_pode_decidir(p_entidade text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_entidade
    when 'fornecedor' then public.can_manage_suppliers()
    when 'cliente' then public.has_feature('fundacao.cadastros', 'operar')
    when 'material' then public.materiais_pode_cadastrar()
    when 'produto' then public.has_feature('comercial.produtos', 'operar')
    else false end;
$$;
revoke all on function public.conector_pode_decidir(text) from public, anon;
grant execute on function public.conector_pode_decidir(text) to authenticated;

drop policy if exists conector_depara_le on public.conector_depara;
create policy conector_depara_le on public.conector_depara for select to authenticated
  using (organization_id = (select public.current_organization_id()) and ((select public.is_owner()) or public.conector_pode_decidir(entidade)));

revoke all on public.conector_fontes, public.conector_lotes, public.conector_registros, public.conector_depara from anon;
revoke insert, update, delete on public.conector_fontes, public.conector_lotes, public.conector_registros, public.conector_depara from authenticated;
grant select on public.conector_fontes, public.conector_lotes, public.conector_registros, public.conector_depara to authenticated;

-- A área decide um de-para (aprovar ou recusar). O destino tem de existir no cadastro da entidade.
create or replace function public.conector_depara_decidir(p_id uuid, p_aprovar boolean, p_destino uuid default null, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  d public.conector_depara%rowtype;
  destino uuid;
  existe boolean;
begin
  select * into d from public.conector_depara where id = p_id and organization_id = org for update;
  if d.id is null then raise exception 'De-para não encontrado.'; end if;
  if me is null or not (public.is_owner() or public.conector_pode_decidir(d.entidade)) then
    raise exception 'Só quem cuida deste cadastro decide o de-para.' using errcode = '42501';
  end if;
  destino := coalesce(p_destino, d.destino_id);
  existe := case d.entidade
    when 'fornecedor' then exists (select 1 from public.suppliers where id = destino and organization_id = org)
    when 'cliente' then exists (select 1 from public.customers where id = destino and organization_id = org)
    when 'material' then exists (select 1 from public.materials where id = destino and organization_id = org)
    when 'produto' then exists (select 1 from public.products where id = destino and organization_id = org)
    else false end;
  if p_aprovar and not existe then raise exception 'O cadastro escolhido não existe.'; end if;
  update public.conector_depara set situacao = case when p_aprovar then 'aprovada' else 'recusada' end, destino_id = destino,
    origem = case when p_destino is not null and p_destino <> d.destino_id then 'pessoa' else origem end,
    motivo = left(p_motivo, 300), decidido_por = me, decidido_por_nome = (select full_name from public.profiles where id = me), decidido_em = now()
  where id = d.id;
  perform public.emit_module_event(org, 'fundacao', case when p_aprovar then 'conector.depara.aprovado' else 'conector.depara.recusado' end, 'conector_depara', d.id::text,
    format('De-para %s: %s %s → %s', case when p_aprovar then 'aprovado' else 'recusado' end, d.objeto, d.chave, d.entidade),
    jsonb_build_object('fonte', d.fonte_id, 'entidade', d.entidade, 'destino', destino));
end $$;
revoke all on function public.conector_depara_decidir(uuid, boolean, uuid, text) from public, anon;
grant execute on function public.conector_depara_decidir(uuid, boolean, uuid, text) to authenticated;

-- Sugestão por regra (só o proprietário pede): o campo do registro de origem bate com o documento (CNPJ/CPF, só
-- dígitos, sem os de dígito repetido) do fornecedor ou do cliente, ou com o código do material ou do produto. Só onde
-- há UM cadastro que bate.
-- Não sobrescreve o que a área já decidiu. Devolve quantas sugestões novas.
create or replace function public.conector_depara_sugerir(p_fonte uuid, p_objeto text, p_campo text, p_entidade text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  n integer;
begin
  if not public.is_owner() then raise exception 'Só o proprietário pede sugestões do conector.' using errcode = '42501'; end if;
  if p_campo !~ '^[A-Za-z0-9_]{1,60}$' then raise exception 'Campo inválido.'; end if;
  if p_entidade not in ('fornecedor', 'cliente', 'material', 'produto') then raise exception 'Entidade inválida.'; end if;
  with origem as (
    select r.objeto, r.chave, case when p_entidade in ('fornecedor', 'cliente') then regexp_replace(coalesce(r.dados ->> p_campo, ''), '\D', '', 'g')
      else upper(btrim(coalesce(r.dados ->> p_campo, ''))) end as valor
    from public.conector_registros r
    where r.organization_id = org and r.fonte_id = p_fonte and r.objeto = p_objeto
  ), alvo as (
    select id, regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') as valor from public.suppliers where p_entidade = 'fornecedor' and organization_id = org and merged_into is null
    union all select id, regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') from public.customers where p_entidade = 'cliente' and organization_id = org and merged_into is null
    union all select id, upper(btrim(codigo)) from public.materials where p_entidade = 'material' and organization_id = org
    union all select id, upper(btrim(codigo)) from public.products where p_entidade = 'produto' and organization_id = org
  ), unicos as (
    -- Documento de dígito repetido (000…, 111…) é cadastro provisório: não serve para ligar.
    select valor, min(id::text)::uuid as id from alvo where length(valor) >= case when p_entidade in ('fornecedor', 'cliente') then 11 else 2 end
      and not (p_entidade in ('fornecedor', 'cliente') and valor ~ '^(\d)\1*$')
    group by valor having count(*) = 1
  ), novos as (
    insert into public.conector_depara (organization_id, fonte_id, objeto, chave, entidade, destino_id, origem, confianca, motivo)
    select org, p_fonte, o.objeto, o.chave, p_entidade, u.id, 'regra', 1, format('%s igual (%s)', p_campo, case when p_entidade in ('fornecedor', 'cliente') then 'documento' else 'código' end)
    from origem o join unicos u on u.valor = o.valor
    on conflict (fonte_id, objeto, chave, entidade) do nothing
    returning 1
  )
  select count(*) into n from novos;
  return n;
end $$;
revoke all on function public.conector_depara_sugerir(uuid, text, text, text) from public, anon;
grant execute on function public.conector_depara_sugerir(uuid, text, text, text) to authenticated;

-- Recebe um lote de registros de uma fonte (só o servidor chama, com a fonte já conferida pelo segredo). O sha256 é
-- do conteúdo (jsonb normalizado); a chave são os campos indicados, juntos. Igual: só marca que foi visto de novo;
-- alterado: nova versão (guarda o sha256 anterior); novo: entra. Chave repetida no mesmo lote vale a última.
create or replace function public.conector_receber(p_fonte uuid, p_objeto text, p_chave text[], p_registros jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f public.conector_fontes%rowtype;
  lote uuid;
  v_recebidos int; v_sem_chave int; v_novos int; v_alterados int; v_iguais int;
begin
  select * into f from public.conector_fontes where id = p_fonte;
  if f.id is null or not f.ativo then raise exception 'Fonte não encontrada ou desativada.'; end if;
  if p_objeto is null or length(p_objeto) not between 1 and 120 then raise exception 'Objeto inválido.'; end if;
  if coalesce(array_length(p_chave, 1), 0) not between 1 and 6 then raise exception 'Diga de 1 a 6 campos de chave.'; end if;
  if jsonb_typeof(p_registros) <> 'array' or jsonb_array_length(p_registros) > 1000 then raise exception 'Mande de 0 a 1000 registros por lote.'; end if;

  create temp table if not exists _entrada (chave text, dados jsonb, sha text) on commit drop;
  truncate _entrada;
  insert into _entrada
  select distinct on (chave) chave, dados, sha from (
    select ord, r as dados, encode(sha256(convert_to(r::text, 'UTF8')), 'hex') as sha,
      (select string_agg(coalesce(r ->> c, ''), '|' order by i) from unnest(p_chave) with ordinality as k(c, i)) as chave
    from jsonb_array_elements(p_registros) with ordinality as e(r, ord)
  ) x where length(replace(chave, '|', '')) > 0 and length(chave) <= 300
  order by chave, ord desc;

  v_recebidos := jsonb_array_length(p_registros);
  select count(*) into v_sem_chave from jsonb_array_elements(p_registros) r
    where length(replace((select string_agg(coalesce(r ->> c, ''), '|') from unnest(p_chave) c), '|', '')) = 0;
  select count(*) filter (where e.id is null), count(*) filter (where e.id is not null and e.sha256 <> x.sha), count(*) filter (where e.sha256 = x.sha)
    into v_novos, v_alterados, v_iguais
  from _entrada x left join public.conector_registros e on e.fonte_id = f.id and e.objeto = p_objeto and e.chave = x.chave;

  insert into public.conector_lotes (organization_id, fonte_id, tipo, objeto, recebidos, novos, alterados, iguais, sha256, erro)
  values (f.organization_id, f.id, 'carga', p_objeto, v_recebidos, v_novos, v_alterados, v_iguais,
    encode(sha256(convert_to(p_registros::text, 'UTF8')), 'hex'), case when v_sem_chave > 0 then format('%s registro(s) sem chave ignorado(s)', v_sem_chave) end)
  returning id into lote;

  insert into public.conector_registros (organization_id, fonte_id, objeto, chave, dados, sha256, lote_id)
  select f.organization_id, f.id, p_objeto, x.chave, x.dados, x.sha, lote from _entrada x
  on conflict (fonte_id, objeto, chave) do update
    set dados = excluded.dados, sha256 = excluded.sha256, sha256_anterior = conector_registros.sha256, versao = conector_registros.versao + 1,
        lote_id = excluded.lote_id, alterado_em = now(), ultima_vez = now()
    where conector_registros.sha256 <> excluded.sha256;
  update public.conector_registros e set ultima_vez = now()
    from _entrada x where e.fonte_id = f.id and e.objeto = p_objeto and e.chave = x.chave and e.sha256 = x.sha;
  update public.conector_fontes set ultimo_contato = now(), ultimo_erro = null where id = f.id;

  return jsonb_build_object('lote', lote, 'recebidos', v_recebidos, 'novos', v_novos, 'alterados', v_alterados, 'iguais', v_iguais, 'sem_chave', v_sem_chave);
end $$;
revoke all on function public.conector_receber(uuid, text, text[], jsonb) from public, anon, authenticated;
