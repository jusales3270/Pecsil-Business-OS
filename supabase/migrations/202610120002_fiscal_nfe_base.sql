-- Fiscal — base da NF-e (Entrega 1, 12/10/2026; plano em docs/FISCAL-NFE.md).
--
-- 1. Configuração fiscal por organização (o emitente é dado da empresa, nunca fixo no código).
-- 2. Certificado A1 no Supabase Vault (cifrado). Só o proprietário envia; só o servidor lê.
-- 3. Notas recebidas da SEFAZ (distribuição de documentos): o que o governo tem contra o nosso
--    CNPJ, para conferir com o Painel do ICMS e com o Almoxarifado.
-- 4. Permissões novas: fiscal.nfe (ver/operar/aprovar) e fiscal.config (ver/operar).
--
-- A conversa com a SEFAZ é do transmissor (serviço separado, contrato em lib/fiscal/transmissor);
-- o banco só guarda o estado.

-- --- Permissões -------------------------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('fiscal.nfe', 'fiscal', 'Notas fiscais (NF-e)', '{ver,operar,aprovar}', 20),
  ('fiscal.config', 'fiscal', 'Configuração fiscal', '{ver,operar}', 30)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- Documentos: duas origens novas -------------------------------------------------------------
-- sefaz   = XML baixado da SEFAZ pela busca automática;
-- emissao = XML e DANFE das notas que a própria empresa emite (Entrega 2).
alter table public.company_documents drop constraint if exists company_documents_source_check;
alter table public.company_documents add constraint company_documents_source_check
  check (source = any (array['envio', 'extrato', 'nota', 'recebimento', 'coleta', 'sefaz', 'emissao']));

-- Registro de documento feito pelo SISTEMA (rodada agendada, sem sessão de pessoa). Mesmas regras
-- do company_document_register, mas a organização vem no parâmetro e só o servidor chama.
create or replace function public.company_document_register_sistema(
  p_org uuid, p_module text, p_feature text, p_title text, p_original_name text, p_mime text,
  p_size bigint, p_sha256 text, p_storage_path text, p_source text, p_autor text,
  p_entity_type text default null, p_entity_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existente uuid;
  novo uuid;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then raise exception 'Organização inválida.'; end if;
  if p_source not in ('sefaz', 'emissao') then raise exception 'Origem não permitida para o sistema.'; end if;
  if p_feature not like p_module || '.%' then raise exception 'Funcionalidade não pertence ao setor.'; end if;
  if p_storage_path not like p_org::text || '/' || p_module || '/%' then raise exception 'Caminho do arquivo inválido.'; end if;

  select id into existente from public.company_documents
   where organization_id = p_org and module_code = p_module and sha256 = lower(p_sha256) and superseded_by is null and archived_at is null
   limit 1;
  if existente is not null then return jsonb_build_object('id', existente, 'existente', true); end if;

  insert into public.company_documents (organization_id, module_code, feature_code, title, original_name, mime_type, size_bytes,
    sha256, storage_path, version, source, entity_type, entity_id, uploaded_by, uploaded_by_name)
  values (p_org, p_module, p_feature, left(coalesce(nullif(trim(p_title), ''), p_original_name), 200), left(p_original_name, 255), p_mime, p_size,
    lower(p_sha256), p_storage_path, 1, p_source, p_entity_type, p_entity_id, null, left(coalesce(p_autor, 'Sistema'), 120))
  returning id into novo;

  perform public.emit_module_event(p_org, 'fundacao', 'fundacao.documento.enviado', 'documento', novo::text,
    format('Documento guardado em %s: %s', p_module, left(p_original_name, 120)),
    jsonb_build_object('setor', p_module, 'origem', p_source, 'versao', 1, 'tamanho', p_size));
  return jsonb_build_object('id', novo, 'existente', false, 'versao', 1);
end;
$$;
revoke all on function public.company_document_register_sistema(uuid, text, text, text, text, text, bigint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.company_document_register_sistema(uuid, text, text, text, text, text, bigint, text, text, text, text, text, text) to service_role;

-- --- Configuração fiscal (uma por organização) -------------------------------------------------
create table if not exists public.fiscal_config (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Emitente
  razao_social text check (razao_social is null or length(razao_social) <= 60),
  nome_fantasia text check (nome_fantasia is null or length(nome_fantasia) <= 60),
  cnpj text check (cnpj is null or cnpj ~ '^\d{14}$'),
  ie text check (ie is null or ie ~ '^(\d{2,14}|ISENTO)$'),
  im text check (im is null or length(im) <= 15),
  cnae text check (cnae is null or cnae ~ '^\d{7}$'),
  -- CRT: 1 Simples Nacional; 2 Simples, excesso de sublimite; 3 Regime normal; 4 MEI.
  crt smallint check (crt is null or crt between 1 and 4),
  logradouro text check (logradouro is null or length(logradouro) <= 60),
  numero text check (numero is null or length(numero) <= 60),
  complemento text check (complemento is null or length(complemento) <= 60),
  bairro text check (bairro is null or length(bairro) <= 60),
  codigo_municipio text check (codigo_municipio is null or codigo_municipio ~ '^\d{7}$'),
  municipio text check (municipio is null or length(municipio) <= 60),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  cep text check (cep is null or cep ~ '^\d{8}$'),
  telefone text check (telefone is null or telefone ~ '^\d{6,14}$'),
  email text check (email is null or length(email) <= 60),
  -- Emissão
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  serie_padrao int not null default 1 check (serie_padrao between 0 and 999),
  -- Notas recebidas (distribuição de documentos da SEFAZ)
  dfe_ativo boolean not null default false,
  ciencia_automatica boolean not null default false,
  dfe_ultimo_nsu text not null default '000000000000000' check (dfe_ultimo_nsu ~ '^\d{15}$'),
  dfe_max_nsu text check (dfe_max_nsu is null or dfe_max_nsu ~ '^\d{15}$'),
  dfe_proxima_consulta timestamptz,
  dfe_ultima_consulta timestamptz,
  dfe_ultimo_status text check (dfe_ultimo_status is null or length(dfe_ultimo_status) <= 300),
  -- Certificado A1: só os dados públicos dele. O arquivo e a senha ficam no Vault.
  cert_titular text,
  cert_cnpj text check (cert_cnpj is null or cert_cnpj ~ '^\d{14}$'),
  cert_validade timestamptz,
  cert_enviado_por uuid references public.profiles(id) on delete set null,
  cert_enviado_por_nome text,
  cert_enviado_em timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Onde o certificado está no Vault. Sem nenhuma política: só o servidor (e as funções abaixo) vê.
create table if not exists public.fiscal_certificado_segredos (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  pfx_secret_id uuid not null,
  senha_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

-- Numeração por série. "proximo_numero" continua a numeração do sistema anterior; a reserva
-- atômica (nunca repete nem pula) vem com a emissão (Entrega 2).
create table if not exists public.fiscal_series (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  serie int not null check (serie between 0 and 999),
  proximo_numero bigint not null default 1 check (proximo_numero between 1 and 999999999),
  updated_at timestamptz not null default now(),
  primary key (organization_id, serie)
);

alter table public.fiscal_config enable row level security;
alter table public.fiscal_certificado_segredos enable row level security;
alter table public.fiscal_series enable row level security;

drop policy if exists fiscal_config_read on public.fiscal_config;
create policy fiscal_config_read on public.fiscal_config for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('fiscal.config')) or (select public.has_feature('fiscal.nfe')) or (select public.has_feature('fiscal.icms')))
);
drop policy if exists fiscal_series_read on public.fiscal_series;
create policy fiscal_series_read on public.fiscal_series for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('fiscal.config')) or (select public.has_feature('fiscal.nfe')))
);
-- Escrita só pelas funções abaixo (lista fechada de campos).
revoke insert, update, delete on public.fiscal_config, public.fiscal_series from anon, authenticated;
revoke all on public.fiscal_certificado_segredos from anon, authenticated;

-- A organização começa com o que já se sabe dela (razão social e CNPJ do cadastro).
insert into public.fiscal_config (organization_id, razao_social, cnpj)
select o.id, left(o.legal_name, 60), nullif(regexp_replace(coalesce(o.tax_id, ''), '\D', '', 'g'), '')
from public.organizations o
where length(regexp_replace(coalesce(o.tax_id, ''), '\D', '', 'g')) in (0, 14)
on conflict (organization_id) do nothing;

-- Salvar a configuração: só os campos do emitente e da emissão. O certificado e o estado da busca
-- têm caminho próprio. Produção só o proprietário liga.
create or replace function public.fiscal_config_salvar(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  atual public.fiscal_config%rowtype;
  so_digitos text;
begin
  if org is null or not public.has_feature('fiscal.config', 'operar') then
    raise exception 'Sem permissão para alterar a configuração fiscal.' using errcode = '42501';
  end if;
  insert into public.fiscal_config (organization_id) values (org) on conflict (organization_id) do nothing;
  select * into atual from public.fiscal_config where organization_id = org for update;

  if p ? 'ambiente' and p ->> 'ambiente' = 'producao' and atual.ambiente <> 'producao' and not public.is_owner() then
    raise exception 'Só o proprietário liga a emissão em produção.' using errcode = '42501';
  end if;

  update public.fiscal_config set
    razao_social = case when p ? 'razao_social' then nullif(upper(trim(p ->> 'razao_social')), '') else razao_social end,
    nome_fantasia = case when p ? 'nome_fantasia' then nullif(trim(p ->> 'nome_fantasia'), '') else nome_fantasia end,
    cnpj = case when p ? 'cnpj' then nullif(regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), '') else cnpj end,
    ie = case when p ? 'ie' then nullif(case when upper(trim(p ->> 'ie')) = 'ISENTO' then 'ISENTO' else regexp_replace(coalesce(p ->> 'ie', ''), '\D', '', 'g') end, '') else ie end,
    im = case when p ? 'im' then nullif(trim(p ->> 'im'), '') else im end,
    cnae = case when p ? 'cnae' then nullif(regexp_replace(coalesce(p ->> 'cnae', ''), '\D', '', 'g'), '') else cnae end,
    crt = case when p ? 'crt' then nullif(p ->> 'crt', '')::smallint else crt end,
    logradouro = case when p ? 'logradouro' then nullif(trim(p ->> 'logradouro'), '') else logradouro end,
    numero = case when p ? 'numero' then nullif(trim(p ->> 'numero'), '') else numero end,
    complemento = case when p ? 'complemento' then nullif(trim(p ->> 'complemento'), '') else complemento end,
    bairro = case when p ? 'bairro' then nullif(trim(p ->> 'bairro'), '') else bairro end,
    codigo_municipio = case when p ? 'codigo_municipio' then nullif(regexp_replace(coalesce(p ->> 'codigo_municipio', ''), '\D', '', 'g'), '') else codigo_municipio end,
    municipio = case when p ? 'municipio' then nullif(upper(trim(p ->> 'municipio')), '') else municipio end,
    uf = case when p ? 'uf' then nullif(upper(trim(p ->> 'uf')), '') else uf end,
    cep = case when p ? 'cep' then nullif(regexp_replace(coalesce(p ->> 'cep', ''), '\D', '', 'g'), '') else cep end,
    telefone = case when p ? 'telefone' then nullif(regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g'), '') else telefone end,
    email = case when p ? 'email' then nullif(lower(trim(p ->> 'email')), '') else email end,
    ambiente = case when p ? 'ambiente' then p ->> 'ambiente' else ambiente end,
    serie_padrao = case when p ? 'serie_padrao' then (p ->> 'serie_padrao')::int else serie_padrao end,
    dfe_ativo = case when p ? 'dfe_ativo' then (p ->> 'dfe_ativo')::boolean else dfe_ativo end,
    ciencia_automatica = case when p ? 'ciencia_automatica' then (p ->> 'ciencia_automatica')::boolean else ciencia_automatica end,
    updated_by = me,
    updated_at = now()
  where organization_id = org;

  -- Próximo número da série padrão (para continuar a numeração do sistema anterior).
  if p ? 'proximo_numero' and nullif(p ->> 'proximo_numero', '') is not null then
    so_digitos := regexp_replace(p ->> 'proximo_numero', '\D', '', 'g');
    insert into public.fiscal_series (organization_id, serie, proximo_numero)
    values (org, (select serie_padrao from public.fiscal_config where organization_id = org), so_digitos::bigint)
    on conflict (organization_id, serie) do update set proximo_numero = excluded.proximo_numero, updated_at = now();
  end if;

  perform public.emit_module_event(org, 'fiscal', 'fiscal.config.alterada', 'fiscal_config', org::text,
    'Configuração fiscal alterada', jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
end;
$$;
revoke all on function public.fiscal_config_salvar(jsonb) from public, anon;
grant execute on function public.fiscal_config_salvar(jsonb) to authenticated;

-- --- Certificado A1 no Vault --------------------------------------------------------------------
-- Salvar: só o proprietário. O servidor já conferiu a senha e leu titular, CNPJ e validade (pelo
-- transmissor) antes de chamar. O CNPJ do certificado tem de ser o do emitente (a raiz, os 8
-- primeiros dígitos: o certificado da matriz serve às filiais).
create or replace function public.fiscal_certificado_salvar(p_pfx text, p_senha text, p_titular text, p_cnpj text, p_validade timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  seg public.fiscal_certificado_segredos%rowtype;
  emitente text;
  cnpj_cert text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  nome text := 'fiscal_cert_' || org::text;
begin
  if org is null or not public.is_owner() then
    raise exception 'Só o proprietário envia o certificado digital.' using errcode = '42501';
  end if;
  if coalesce(length(p_pfx), 0) < 100 or coalesce(length(p_senha), 0) < 1 then raise exception 'Certificado ou senha vazios.'; end if;
  if cnpj_cert !~ '^\d{14}$' then raise exception 'O certificado não traz um CNPJ.'; end if;
  if p_validade is null or p_validade < now() then raise exception 'O certificado está vencido.'; end if;
  insert into public.fiscal_config (organization_id) values (org) on conflict (organization_id) do nothing;
  select cnpj into emitente from public.fiscal_config where organization_id = org;
  emitente := coalesce(emitente, public.cnpj_da_empresa(org));
  if emitente ~ '^\d{14}$' and left(emitente, 8) <> left(cnpj_cert, 8) then
    raise exception 'O certificado é de outro CNPJ (%), não do emitente.', cnpj_cert;
  end if;

  select * into seg from public.fiscal_certificado_segredos where organization_id = org for update;
  if seg.organization_id is null then
    insert into public.fiscal_certificado_segredos (organization_id, pfx_secret_id, senha_secret_id)
    values (org, vault.create_secret(p_pfx, nome || '_pfx', 'Certificado A1 (pfx, base64)'),
                 vault.create_secret(p_senha, nome || '_senha', 'Senha do certificado A1'));
  else
    perform vault.update_secret(seg.pfx_secret_id, p_pfx);
    perform vault.update_secret(seg.senha_secret_id, p_senha);
    update public.fiscal_certificado_segredos set updated_at = now() where organization_id = org;
  end if;

  update public.fiscal_config set
    cert_titular = left(p_titular, 200), cert_cnpj = cnpj_cert, cert_validade = p_validade,
    cert_enviado_por = me, cert_enviado_por_nome = (select full_name from public.profiles where id = me), cert_enviado_em = now(),
    cnpj = coalesce(cnpj, cnpj_cert), updated_at = now()
  where organization_id = org;

  perform public.emit_module_event(org, 'fiscal', 'fiscal.certificado.enviado', 'fiscal_config', org::text,
    format('Certificado digital enviado (válido até %s)', to_char(p_validade at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
    jsonb_build_object('validade', p_validade));
end;
$$;
revoke all on function public.fiscal_certificado_salvar(text, text, text, text, timestamptz) from public, anon;
grant execute on function public.fiscal_certificado_salvar(text, text, text, text, timestamptz) to authenticated;

-- Remover: só o proprietário. Apaga do Vault e limpa os dados públicos.
create or replace function public.fiscal_certificado_remover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  seg public.fiscal_certificado_segredos%rowtype;
begin
  if org is null or not public.is_owner() then
    raise exception 'Só o proprietário remove o certificado digital.' using errcode = '42501';
  end if;
  select * into seg from public.fiscal_certificado_segredos where organization_id = org for update;
  if seg.organization_id is not null then
    delete from vault.secrets where id in (seg.pfx_secret_id, seg.senha_secret_id);
    delete from public.fiscal_certificado_segredos where organization_id = org;
  end if;
  update public.fiscal_config set cert_titular = null, cert_cnpj = null, cert_validade = null, cert_enviado_por = null,
    cert_enviado_por_nome = null, cert_enviado_em = null, dfe_ativo = false, updated_at = now()
  where organization_id = org;
  perform public.emit_module_event(org, 'fiscal', 'fiscal.certificado.removido', 'fiscal_config', org::text,
    'Certificado digital removido', '{}'::jsonb);
end;
$$;
revoke all on function public.fiscal_certificado_remover() from public, anon;
grant execute on function public.fiscal_certificado_remover() to authenticated;

-- Ler: SÓ o servidor (chave de serviço), na hora de falar com a SEFAZ. Nenhum usuário lê.
create or replace function public.fiscal_certificado_ler(p_org uuid)
returns table (pfx text, senha text)
language sql
stable
security definer
set search_path = public
as $$
  select p.decrypted_secret, s.decrypted_secret
  from public.fiscal_certificado_segredos c
  join vault.decrypted_secrets p on p.id = c.pfx_secret_id
  join vault.decrypted_secrets s on s.id = c.senha_secret_id
  where c.organization_id = p_org
$$;
revoke all on function public.fiscal_certificado_ler(uuid) from public, anon, authenticated;
grant execute on function public.fiscal_certificado_ler(uuid) to service_role;

-- --- Notas recebidas da SEFAZ ------------------------------------------------------------------
-- Uma linha por nota (chave). Chega primeiro o resumo; com a ciência da operação, a SEFAZ libera
-- o XML completo, que vai para Documentos (setor Fiscal) e a linha passa a apontar para ele.
create table if not exists public.fiscal_dfe (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null check (chave ~ '^\d{44}$'),
  nsu_resumo text check (nsu_resumo is null or nsu_resumo ~ '^\d{15}$'),
  nsu_nota text check (nsu_nota is null or nsu_nota ~ '^\d{15}$'),
  emitente_cnpj text check (emitente_cnpj is null or emitente_cnpj ~ '^\d{11,14}$'),
  emitente_nome text check (emitente_nome is null or length(emitente_nome) <= 200),
  emitente_ie text,
  valor numeric(18,2),
  emissao timestamptz,
  -- tpNF do emitente: 0 = entrada (ex.: devolução), 1 = saída (a venda para nós).
  tipo_nf smallint check (tipo_nf is null or tipo_nf in (0, 1)),
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'denegada', 'cancelada')),
  protocolo text,
  manifestacao text not null default 'nenhuma' check (manifestacao in ('nenhuma', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada')),
  manifestacao_em timestamptz,
  manifestacao_erro text check (manifestacao_erro is null or length(manifestacao_erro) <= 600),
  document_id uuid references public.company_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, chave)
);
create index if not exists idx_fiscal_dfe_org_emissao on public.fiscal_dfe (organization_id, emissao desc);
create index if not exists idx_fiscal_dfe_sem_xml on public.fiscal_dfe (organization_id) where document_id is null;

-- Eventos das notas recebidas (cancelamento pelo emitente, carta de correção, a nossa ciência…).
create table if not exists public.fiscal_dfe_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nsu text not null check (nsu ~ '^\d{15}$'),
  chave text not null check (chave ~ '^\d{44}$'),
  tp_evento text not null check (tp_evento ~ '^\d{6}$'),
  descricao text check (descricao is null or length(descricao) <= 120),
  sequencia int,
  data_evento timestamptz,
  protocolo text,
  autor_cnpj text,
  created_at timestamptz not null default now(),
  unique (organization_id, nsu)
);
create index if not exists idx_fiscal_dfe_eventos_chave on public.fiscal_dfe_eventos (organization_id, chave);

alter table public.fiscal_dfe enable row level security;
alter table public.fiscal_dfe_eventos enable row level security;
drop policy if exists fiscal_dfe_read on public.fiscal_dfe;
create policy fiscal_dfe_read on public.fiscal_dfe for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('fiscal.icms')) or (select public.has_feature('fiscal.nfe')))
);
drop policy if exists fiscal_dfe_eventos_read on public.fiscal_dfe_eventos;
create policy fiscal_dfe_eventos_read on public.fiscal_dfe_eventos for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('fiscal.icms')) or (select public.has_feature('fiscal.nfe')))
);
revoke insert, update, delete on public.fiscal_dfe, public.fiscal_dfe_eventos from anon, authenticated;

-- Registrar um documento da distribuição (só o servidor). p:
--   { tipo: 'resumo'|'nota'|'evento', nsu, chave, emitente_cnpj?, emitente_nome?, emitente_ie?, valor?,
--     emissao?, tipo_nf?, situacao?, protocolo?, document_id?, tp_evento?, descricao?, sequencia?,
--     data_evento?, autor_cnpj? }
-- Devolve { nova: bool } — nova = primeira vez que a nota aparece.
create or replace function public.fiscal_dfe_registrar(p_org uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tipo text := p ->> 'tipo';
  ch text := p ->> 'chave';
  v_nsu text := lpad(coalesce(p ->> 'nsu', ''), 15, '0');
  linha public.fiscal_dfe%rowtype;
  nova boolean := false;
  no_painel boolean;
begin
  if tipo not in ('resumo', 'nota', 'evento') or ch !~ '^\d{44}$' then raise exception 'Documento da distribuição inválido.'; end if;

  if tipo = 'evento' then
    insert into public.fiscal_dfe_eventos (organization_id, nsu, chave, tp_evento, descricao, sequencia, data_evento, protocolo, autor_cnpj)
    values (p_org, v_nsu, ch, p ->> 'tp_evento', left(p ->> 'descricao', 120), nullif(p ->> 'sequencia', '')::int,
      nullif(p ->> 'data_evento', '')::timestamptz, p ->> 'protocolo', p ->> 'autor_cnpj')
    on conflict (organization_id, nsu) do nothing;
    -- 110111 = cancelamento pelo emitente.
    if p ->> 'tp_evento' = '110111' then
      update public.fiscal_dfe set situacao = 'cancelada', updated_at = now()
       where organization_id = p_org and chave = ch and situacao <> 'cancelada'
      returning * into linha;
      if linha.id is not null then
        select exists (select 1 from public.fiscal_icms_entries where organization_id = p_org and chave = ch) into no_painel;
        perform public.emit_module_event(p_org, 'fiscal', 'fiscal.dfe.cancelada', 'fiscal_dfe', linha.id::text,
          format('Nota cancelada pelo emitente · %s · R$ %s', coalesce(linha.emitente_nome, linha.emitente_cnpj), public.brl(coalesce(linha.valor, 0))),
          jsonb_build_object('chave', ch, 'no_painel', no_painel));
        if no_painel then
          perform public.notify_feature(p_org, 'fiscal.icms', 'operar', 'fiscal', 'attention',
            format('Nota cancelada pelo emitente · %s', coalesce(linha.emitente_nome, linha.emitente_cnpj)),
            format('A nota de R$ %s já está no Painel do ICMS. Confira o lançamento.', public.brl(coalesce(linha.valor, 0))),
            '/?module=fiscal&secao=Notas%20recebidas', null);
        end if;
      end if;
    end if;
    return jsonb_build_object('nova', false);
  end if;

  select * into linha from public.fiscal_dfe where organization_id = p_org and chave = ch for update;
  if linha.id is null then
    nova := true;
    insert into public.fiscal_dfe (organization_id, chave, nsu_resumo, nsu_nota, emitente_cnpj, emitente_nome, emitente_ie, valor, emissao,
      tipo_nf, situacao, protocolo, document_id)
    values (p_org, ch, case when tipo = 'resumo' then v_nsu end, case when tipo = 'nota' then v_nsu end,
      nullif(regexp_replace(coalesce(p ->> 'emitente_cnpj', ''), '\D', '', 'g'), ''), left(p ->> 'emitente_nome', 200), p ->> 'emitente_ie',
      nullif(p ->> 'valor', '')::numeric, nullif(p ->> 'emissao', '')::timestamptz, nullif(p ->> 'tipo_nf', '')::smallint,
      coalesce(p ->> 'situacao', 'autorizada'), p ->> 'protocolo', nullif(p ->> 'document_id', '')::uuid)
    returning * into linha;
    perform public.emit_module_event(p_org, 'fiscal', 'fiscal.dfe.recebida', 'fiscal_dfe', linha.id::text,
      format('Nota na SEFAZ contra o nosso CNPJ · %s · R$ %s', coalesce(linha.emitente_nome, linha.emitente_cnpj), public.brl(coalesce(linha.valor, 0))),
      jsonb_build_object('chave', ch, 'tipo', tipo));
  else
    update public.fiscal_dfe set
      nsu_resumo = coalesce(nsu_resumo, case when tipo = 'resumo' then v_nsu end),
      nsu_nota = coalesce(nsu_nota, case when tipo = 'nota' then v_nsu end),
      emitente_cnpj = coalesce(emitente_cnpj, nullif(regexp_replace(coalesce(p ->> 'emitente_cnpj', ''), '\D', '', 'g'), '')),
      emitente_nome = coalesce(emitente_nome, left(p ->> 'emitente_nome', 200)),
      emitente_ie = coalesce(emitente_ie, p ->> 'emitente_ie'),
      valor = coalesce(valor, nullif(p ->> 'valor', '')::numeric),
      emissao = coalesce(emissao, nullif(p ->> 'emissao', '')::timestamptz),
      tipo_nf = coalesce(tipo_nf, nullif(p ->> 'tipo_nf', '')::smallint),
      -- cancelada não volta a autorizada por um resumo atrasado
      situacao = case when situacao = 'cancelada' then situacao else coalesce(p ->> 'situacao', situacao) end,
      protocolo = coalesce(protocolo, p ->> 'protocolo'),
      document_id = coalesce(document_id, nullif(p ->> 'document_id', '')::uuid),
      updated_at = now()
    where id = linha.id;
  end if;
  return jsonb_build_object('nova', nova, 'id', linha.id);
end;
$$;
revoke all on function public.fiscal_dfe_registrar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fiscal_dfe_registrar(uuid, jsonb) to service_role;

-- Lista para a tela, com a conferência "o governo tem e nós não": a nota já está no Painel do ICMS?
-- Já foi recebida no Almoxarifado? (Quem é do Fiscal pode não ver o Almoxarifado; aqui só sai sim/não.)
create or replace function public.fiscal_dfe_listar(p_filtro text default 'todas', p_limite int default 200)
returns table (
  id uuid, chave text, emitente_cnpj text, emitente_nome text, valor numeric, emissao timestamptz, tipo_nf smallint,
  situacao text, manifestacao text, manifestacao_erro text, document_id uuid, no_painel boolean, recebida boolean, supplier_id uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if org is null or not (public.has_feature('fiscal.icms') or public.has_feature('fiscal.nfe')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select d.id, d.chave, d.emitente_cnpj, d.emitente_nome, d.valor, d.emissao, d.tipo_nf, d.situacao, d.manifestacao, d.manifestacao_erro, d.document_id,
    exists (select 1 from public.fiscal_icms_entries e where e.organization_id = org and e.chave = d.chave),
    exists (select 1 from public.receipts r where r.organization_id = org and r.nf_chave = d.chave),
    case when d.emitente_cnpj ~ '^\d{14}$' then public.fornecedor_por_cnpj(org, d.emitente_cnpj) end,
    d.created_at
  from public.fiscal_dfe d
  where d.organization_id = org
    and case coalesce(p_filtro, 'todas')
      when 'fora_do_painel' then d.situacao = 'autorizada' and not exists (select 1 from public.fiscal_icms_entries e where e.organization_id = org and e.chave = d.chave)
      when 'sem_xml' then d.document_id is null and d.situacao = 'autorizada'
      when 'canceladas' then d.situacao = 'cancelada'
      else true end
  order by d.emissao desc nulls last, d.created_at desc
  limit least(greatest(coalesce(p_limite, 200), 1), 1000);
end;
$$;
revoke all on function public.fiscal_dfe_listar(text, int) from public, anon;
grant execute on function public.fiscal_dfe_listar(text, int) to authenticated;
