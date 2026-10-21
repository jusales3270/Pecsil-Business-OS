-- Fundição › Biblioteca de desenhos (P-11, 21/10/2026).
--
-- Decisões do proprietário:
--   * 18/10: os desenhos da Forja ficam guardados NA PLATAFORMA, no módulo da Fundição, e fora
--     do backup (bucket "fundicao-desenhos" em BACKUP_EXCLUIR_BUCKETS).
--   * 21/10: entram TODOS os desenhos da Forja (com o selo previsto/fundido para filtrar); a
--     Fundição faz anotações por peça e envia os desenhos antigos da pasta física; ver e baixar,
--     com cada download no histórico.
--
-- A Forja é a fonte; aqui fica uma cópia que não se perde: quando a Forja troca o arquivo (ela
-- apaga o antigo) a versão anterior continua, marcada como substituída; quando exclui o desenho,
-- ele fica marcado como "removido na Forja". Cada arquivo é gravado uma vez (sha256).
-- Quem escreve o que vem da Forja é só a sincronização (chave de serviço); as pessoas escrevem
-- pelas funções abaixo, cada uma conferindo a permissão.

-- --- Permissão ------------------------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('fundicao.biblioteca', 'fundicao', 'Biblioteca de desenhos', '{ver,operar}', 20)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- Arquivos (privado; sobe e desce só pelo servidor) -----------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('fundicao-desenhos', 'fundicao-desenhos', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- --- Desenhos ----------------------------------------------------------------------------------
create table if not exists public.fundicao_desenhos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  origem text not null check (origem in ('forja', 'acervo')),
  forja_desenho_id text,
  forja_artigo_id text,
  product_id uuid references public.products(id) on delete set null,
  artigo_codigo text not null check (length(btrim(artigo_codigo)) between 1 and 100),
  artigo_chave text generated always as (upper(btrim(artigo_codigo))) stored,
  artigo_descricao text,
  cliente_nome text,
  tipo text not null check (tipo in ('cliente', 'forma', 'acompanhamento_dim', 'outro')),
  codigo text not null check (length(btrim(codigo)) between 1 and 100),
  revisao text not null default '',
  data_revisao date,
  observacoes text,
  -- Selo da Fundição, como a Forja informa (roteiro e carimbo de entrada dos lotes).
  fundicao_prevista boolean not null default false,
  primeira_fundicao_em timestamptz,
  ultima_fundicao_em timestamptz,
  os_codigos text[] not null default '{}',
  -- Chave do arquivo na Forja: muda a cada troca de arquivo (sinal para baixar de novo).
  forja_arquivo_key text,
  forja_atualizado_em timestamptz,
  removido_na_forja_em timestamptz,
  enviado_por uuid references public.profiles(id) on delete set null,
  enviado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fundicao_desenhos_origem_forja check ((origem = 'forja') = (forja_desenho_id is not null)),
  unique (organization_id, forja_desenho_id)
);
create index if not exists idx_fundicao_desenhos_artigo on public.fundicao_desenhos (organization_id, artigo_chave);
create index if not exists idx_fundicao_desenhos_cliente on public.fundicao_desenhos (organization_id, cliente_nome);
comment on table public.fundicao_desenhos is 'Biblioteca da Fundição: cópia dos desenhos da Forja (origem forja) e desenhos antigos da pasta física (origem acervo).';

create table if not exists public.fundicao_desenho_arquivos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  desenho_id uuid not null references public.fundicao_desenhos(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  mime text,
  tamanho bigint,
  nome text,
  recebido_em timestamptz not null default now(),
  -- Preenchido quando chega um arquivo novo para o mesmo desenho (a versão antiga fica).
  substituido_em timestamptz,
  unique (desenho_id, sha256)
);
create index if not exists idx_fundicao_desenho_arquivos_hash on public.fundicao_desenho_arquivos (organization_id, sha256);
create unique index if not exists uq_fundicao_desenho_arquivo_atual on public.fundicao_desenho_arquivos (desenho_id) where substituido_em is null;

-- --- Anotações da Fundição (uma por pessoa e nota, valem para todas as revisões da peça) -----
create table if not exists public.fundicao_notas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artigo_chave text not null check (artigo_chave = upper(btrim(artigo_chave)) and length(artigo_chave) between 1 and 100),
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  autor_id uuid references public.profiles(id) on delete set null,
  autor_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fundicao_notas_artigo on public.fundicao_notas (organization_id, artigo_chave, created_at desc);

-- --- Leitura: quem tem a Biblioteca ------------------------------------------------------------
alter table public.fundicao_desenhos enable row level security;
alter table public.fundicao_desenho_arquivos enable row level security;
alter table public.fundicao_notas enable row level security;

drop policy if exists fundicao_desenhos_read on public.fundicao_desenhos;
create policy fundicao_desenhos_read on public.fundicao_desenhos for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('fundicao.biblioteca')));
drop policy if exists fundicao_desenho_arquivos_read on public.fundicao_desenho_arquivos;
create policy fundicao_desenho_arquivos_read on public.fundicao_desenho_arquivos for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('fundicao.biblioteca')));
drop policy if exists fundicao_notas_read on public.fundicao_notas;
create policy fundicao_notas_read on public.fundicao_notas for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('fundicao.biblioteca')));

revoke insert, update, delete on public.fundicao_desenhos, public.fundicao_desenho_arquivos, public.fundicao_notas from anon, authenticated;
grant select on public.fundicao_desenhos, public.fundicao_desenho_arquivos, public.fundicao_notas to authenticated;

-- --- Funções das pessoas -----------------------------------------------------------------------
create or replace function public.fundicao_exigir_biblioteca(p_nivel public.access_level default 'operar')
returns uuid language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not public.has_feature('fundicao.biblioteca', p_nivel) then
    raise exception 'Você não tem permissão para % a Biblioteca da Fundição.', case when p_nivel = 'operar' then 'alterar' else 'ver' end using errcode = '42501';
  end if;
  return org;
end $$;
revoke all on function public.fundicao_exigir_biblioteca(public.access_level) from public, anon;

create or replace function public.fundicao_meu_nome()
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = public.current_profile_id()
$$;
revoke all on function public.fundicao_meu_nome() from public, anon;

-- Anotação: nova (sem id) ou edição (com id; só a própria, ou o proprietário).
create or replace function public.fundicao_nota_gravar(p_id uuid, p_artigo_codigo text, p_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.fundicao_exigir_biblioteca('operar');
  n public.fundicao_notas%rowtype;
  v_chave text := upper(btrim(coalesce(p_artigo_codigo, '')));
begin
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva a anotação.'; end if;
  if p_id is null then
    if v_chave = '' then raise exception 'Informe a peça da anotação.'; end if;
    insert into public.fundicao_notas (organization_id, artigo_chave, texto, autor_id, autor_nome)
    values (org, v_chave, btrim(p_texto), public.current_profile_id(), public.fundicao_meu_nome())
    returning * into n;
  else
    select * into n from public.fundicao_notas where id = p_id and organization_id = org;
    if n.id is null then raise exception 'Anotação não encontrada.'; end if;
    if n.autor_id is distinct from public.current_profile_id() and not public.is_owner() then
      raise exception 'Só quem escreveu a anotação pode alterá-la.' using errcode = '42501';
    end if;
    update public.fundicao_notas set texto = btrim(p_texto), updated_at = now() where id = p_id returning * into n;
  end if;
  perform public.emit_module_event(org, 'fundicao', 'fundicao.nota.gravada', 'fundicao_nota', n.id::text,
    format('Anotação da Fundição %s na peça %s', case when p_id is null then 'escrita' else 'alterada' end, n.artigo_chave),
    jsonb_build_object('artigo', n.artigo_chave, 'nova', p_id is null));
  return to_jsonb(n);
end $$;
revoke all on function public.fundicao_nota_gravar(uuid, text, text) from public, anon;
grant execute on function public.fundicao_nota_gravar(uuid, text, text) to authenticated;

create or replace function public.fundicao_nota_apagar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.fundicao_exigir_biblioteca('operar');
  n public.fundicao_notas%rowtype;
begin
  select * into n from public.fundicao_notas where id = p_id and organization_id = org;
  if n.id is null then raise exception 'Anotação não encontrada.'; end if;
  if n.autor_id is distinct from public.current_profile_id() and not public.is_owner() then
    raise exception 'Só quem escreveu a anotação pode apagá-la.' using errcode = '42501';
  end if;
  delete from public.fundicao_notas where id = p_id;
  perform public.emit_module_event(org, 'fundicao', 'fundicao.nota.apagada', 'fundicao_nota', n.id::text,
    format('Anotação da Fundição apagada na peça %s', n.artigo_chave), jsonb_build_object('artigo', n.artigo_chave));
end $$;
revoke all on function public.fundicao_nota_apagar(uuid) from public, anon;
grant execute on function public.fundicao_nota_apagar(uuid) to authenticated;

-- Desenho antigo (pasta física). O arquivo já subiu pelo servidor; aqui só o registro.
-- Mesmo arquivo já na Biblioteca (sha256) não duplica: devolve o existente.
create or replace function public.fundicao_acervo_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.fundicao_exigir_biblioteca('operar');
  v_hash text := lower(coalesce(p ->> 'sha256', ''));
  igual record;
  d public.fundicao_desenhos%rowtype;
  v_produto uuid := nullif(p ->> 'product_id', '')::uuid;
  v_codigo text := nullif(btrim(p ->> 'artigo_codigo'), '');
  v_descricao text := nullif(btrim(p ->> 'artigo_descricao'), '');
  v_cliente text := nullif(btrim(p ->> 'cliente_nome'), '');
begin
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Arquivo inválido.'; end if;
  select a.desenho_id, fd.artigo_codigo into igual
  from public.fundicao_desenho_arquivos a join public.fundicao_desenhos fd on fd.id = a.desenho_id
  where a.organization_id = org and a.sha256 = v_hash limit 1;
  if igual.desenho_id is not null then
    return jsonb_build_object('existente', true, 'id', igual.desenho_id, 'artigo_codigo', igual.artigo_codigo);
  end if;
  if v_produto is not null then
    select coalesce(v_codigo, pr.codigo), coalesce(v_descricao, pr.descricao), coalesce(v_cliente, c.name) into v_codigo, v_descricao, v_cliente
    from public.products pr left join public.customers c on c.id = pr.customer_id where pr.id = v_produto and pr.organization_id = org;
    if not found then raise exception 'Produto não encontrado.'; end if;
  end if;
  if v_codigo is null then raise exception 'Informe a peça (código do artigo).'; end if;
  if nullif(btrim(p ->> 'codigo'), '') is null then raise exception 'Informe o código do desenho.'; end if;

  insert into public.fundicao_desenhos (organization_id, origem, product_id, artigo_codigo, artigo_descricao, cliente_nome, tipo, codigo,
    revisao, data_revisao, observacoes, enviado_por, enviado_por_nome)
  values (org, 'acervo', v_produto, v_codigo, v_descricao, v_cliente, coalesce(nullif(p ->> 'tipo', ''), 'outro'), btrim(p ->> 'codigo'),
    coalesce(btrim(p ->> 'revisao'), ''), nullif(p ->> 'data_revisao', '')::date, nullif(btrim(p ->> 'observacoes'), ''),
    public.current_profile_id(), public.fundicao_meu_nome())
  returning * into d;
  insert into public.fundicao_desenho_arquivos (organization_id, desenho_id, sha256, storage_path, mime, tamanho, nome)
  values (org, d.id, v_hash, p ->> 'storage_path', nullif(p ->> 'mime', ''), nullif(p ->> 'tamanho', '')::bigint, nullif(p ->> 'nome', ''));
  perform public.emit_module_event(org, 'fundicao', 'fundicao.acervo.enviado', 'fundicao_desenho', d.id::text,
    format('Desenho antigo %s da peça %s enviado à Biblioteca', d.codigo, d.artigo_codigo),
    jsonb_build_object('artigo', d.artigo_codigo, 'codigo', d.codigo, 'revisao', d.revisao));
  return jsonb_build_object('existente', false, 'id', d.id, 'artigo_codigo', d.artigo_codigo);
end $$;
revoke all on function public.fundicao_acervo_registrar(jsonb) from public, anon;
grant execute on function public.fundicao_acervo_registrar(jsonb) to authenticated;

-- Apagar um desenho antigo enviado por engano (só o do acervo; o próprio envio, ou o proprietário).
-- Devolve os caminhos para o servidor apagar os arquivos.
create or replace function public.fundicao_acervo_apagar(p_id uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.fundicao_exigir_biblioteca('operar');
  d public.fundicao_desenhos%rowtype;
  caminhos text[];
begin
  select * into d from public.fundicao_desenhos where id = p_id and organization_id = org;
  if d.id is null then raise exception 'Desenho não encontrado.'; end if;
  if d.origem <> 'acervo' then raise exception 'Desenho da Forja não se apaga aqui: ele segue a Forja.'; end if;
  if d.enviado_por is distinct from public.current_profile_id() and not public.is_owner() then
    raise exception 'Só quem enviou o desenho pode apagá-lo.' using errcode = '42501';
  end if;
  select coalesce(array_agg(storage_path), '{}') into caminhos from public.fundicao_desenho_arquivos where desenho_id = d.id;
  delete from public.fundicao_desenhos where id = d.id;
  perform public.emit_module_event(org, 'fundicao', 'fundicao.acervo.apagado', 'fundicao_desenho', d.id::text,
    format('Desenho antigo %s da peça %s apagado da Biblioteca', d.codigo, d.artigo_codigo),
    jsonb_build_object('artigo', d.artigo_codigo, 'codigo', d.codigo));
  return caminhos;
end $$;
revoke all on function public.fundicao_acervo_apagar(uuid) from public, anon;
grant execute on function public.fundicao_acervo_apagar(uuid) to authenticated;

-- Abrir um arquivo: confere a permissão e devolve onde ele está. Baixar fica no histórico.
create or replace function public.fundicao_arquivo_abrir(p_arquivo uuid, p_baixar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.fundicao_exigir_biblioteca('ver');
  a record;
begin
  select fa.id, fa.storage_path, fa.mime, fa.nome, fa.substituido_em, fd.id as desenho_id, fd.codigo, fd.revisao, fd.artigo_codigo into a
  from public.fundicao_desenho_arquivos fa join public.fundicao_desenhos fd on fd.id = fa.desenho_id
  where fa.id = p_arquivo and fa.organization_id = org;
  if a.id is null then raise exception 'Arquivo não encontrado.'; end if;
  if p_baixar then
    perform public.emit_module_event(org, 'fundicao', 'fundicao.desenho.baixado', 'fundicao_desenho', a.desenho_id::text,
      format('Desenho %s rev. %s da peça %s baixado', a.codigo, nullif(a.revisao, ''), a.artigo_codigo),
      jsonb_build_object('arquivo', a.id, 'artigo', a.artigo_codigo, 'codigo', a.codigo, 'revisao', a.revisao, 'versao_antiga', a.substituido_em is not null));
  end if;
  return jsonb_build_object('storage_path', a.storage_path, 'mime', a.mime, 'nome', a.nome);
end $$;
revoke all on function public.fundicao_arquivo_abrir(uuid, boolean) from public, anon;
grant execute on function public.fundicao_arquivo_abrir(uuid, boolean) to authenticated;
