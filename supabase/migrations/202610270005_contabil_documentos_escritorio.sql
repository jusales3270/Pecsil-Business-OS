-- ============================================================================
-- Documentos do escritório, entregas de obrigação e responsável técnico (Contábil-Fiscal, N-04 passo 6) (27/10/2026)
-- ============================================================================
-- O que o escritório contábil entrega (ECD, balanços, DREs, balancetes, recibos) fica em Documentos › Fiscal com a
-- origem "escritorio". A entrega de uma obrigação (recibo da Receita) fica registrada e aparece no calendário fiscal.
-- Do contabilista, o perfil guarda só nome e CRC: CPF de pessoa não entra em tabela.
-- ============================================================================

alter table public.company_documents drop constraint if exists company_documents_source_check;
alter table public.company_documents add constraint company_documents_source_check
  check (source in ('envio', 'extrato', 'nota', 'recebimento', 'coleta', 'sefaz', 'emissao', 'escritorio'));

create or replace function public.company_document_register_sistema(p_org uuid, p_module text, p_feature text, p_title text, p_original_name text, p_mime text, p_size bigint, p_sha256 text, p_storage_path text, p_source text, p_autor text, p_entity_type text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  existente uuid;
  novo uuid;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then raise exception 'Organização inválida.'; end if;
  if p_source not in ('sefaz', 'emissao', 'escritorio') then raise exception 'Origem não permitida para o sistema.'; end if;
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
$function$;

-- Entrega de uma obrigação do calendário: período no formato do calendário (anual = AAAA-12, mensal = AAAA-MM).
create table if not exists public.fiscal_obrigacoes_entregas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao text not null check (obrigacao ~ '^[a-z0-9_]{2,40}$'),
  periodo text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  entregue_em timestamptz not null,
  recibo text check (recibo is null or length(recibo) <= 120),
  document_id uuid references public.company_documents(id) on delete set null,
  observacao text check (observacao is null or length(observacao) <= 300),
  registrado_por_nome text,
  created_at timestamptz not null default now(),
  unique (organization_id, obrigacao, periodo)
);
comment on table public.fiscal_obrigacoes_entregas is 'Obrigação entregue (declaração transmitida): recibo, data e o documento guardado. O calendário fiscal mostra a entrega.';
alter table public.fiscal_obrigacoes_entregas enable row level security;
drop policy if exists fiscal_obrigacoes_entregas_leitura on public.fiscal_obrigacoes_entregas;
create policy fiscal_obrigacoes_entregas_leitura on public.fiscal_obrigacoes_entregas for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.fiscal_calendario_pode_ver()));
revoke all on public.fiscal_obrigacoes_entregas from anon;
revoke insert, update, delete on public.fiscal_obrigacoes_entregas from authenticated;
grant select on public.fiscal_obrigacoes_entregas to authenticated;

-- Registra a entrega pelo servidor (recibo trazido do escritório).
create or replace function public.fiscal_obrigacao_entrega_registrar(p_org uuid, p_obrigacao text, p_periodo text, p_entregue_em timestamptz, p_recibo text, p_document uuid, p_observacao text, p_autor_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid;
begin
  if p_document is not null and not exists (select 1 from public.company_documents where id = p_document and organization_id = p_org) then raise exception 'Documento não encontrado.'; end if;
  insert into public.fiscal_obrigacoes_entregas (organization_id, obrigacao, periodo, entregue_em, recibo, document_id, observacao, registrado_por_nome)
  values (p_org, p_obrigacao, p_periodo, p_entregue_em, nullif(btrim(p_recibo), ''), p_document, nullif(btrim(p_observacao), ''), p_autor_nome)
  on conflict (organization_id, obrigacao, periodo) do update set entregue_em = excluded.entregue_em, recibo = excluded.recibo, document_id = excluded.document_id,
    observacao = excluded.observacao, registrado_por_nome = excluded.registrado_por_nome
  returning id into novo;
  perform public.contabil_escrita_registrar(p_org, 'fiscal.obrigacao.entregue', 'fiscal_obrigacoes_entregas', novo,
    format('%s: %s de %s entregue em %s', coalesce(p_autor_nome, 'Plataforma'), p_obrigacao, p_periodo, to_char(p_entregue_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
    jsonb_build_object('obrigacao', p_obrigacao, 'periodo', p_periodo, 'recibo', p_recibo));
  return novo;
end;
$$;
revoke all on function public.fiscal_obrigacao_entrega_registrar(uuid, text, text, timestamptz, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fiscal_obrigacao_entrega_registrar(uuid, text, text, timestamptz, text, uuid, text, text) to service_role;

-- O calendário passa a trazer as entregas.
create or replace function public.fiscal_calendario_dados() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  cfg record;
begin
  if org is null or not public.fiscal_calendario_pode_ver() then raise exception 'Sem permissão para o calendário fiscal.' using errcode = '42501'; end if;
  select uf, codigo_municipio into cfg from public.fiscal_config where organization_id = org;
  return jsonb_build_object(
    'uf', cfg.uf, 'codigo_municipio', cfg.codigo_municipio,
    'perfil', (select jsonb_build_object('modo', modo, 'regime', regime) from public.contabil_perfil_empresa where organization_id = org),
    'obrigacoes', coalesce((select jsonb_agg(jsonb_build_object('escopo', escopo, 'uf', uf, 'valor', valor, 'situacao', situacao, 'vigente_de', vigente_de, 'vigente_ate', vigente_ate, 'fonte', fonte) order by escopo, vigente_de)
      from public.contabil_parametros where chave = 'calendario_obrigacoes' and situacao <> 'descartado'
        and (escopo = 'legal' or (escopo = 'uf' and uf = cfg.uf) or (escopo = 'municipio' and codigo_municipio = cfg.codigo_municipio))), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(d) from public.contabil_parametros p, jsonb_array_elements(p.valor -> 'datas') d
      where p.chave = 'feriados_nacionais_lista' and p.situacao <> 'descartado'
        and (p.escopo = 'legal' or (p.escopo = 'uf' and p.uf = cfg.uf) or (p.escopo = 'municipio' and p.codigo_municipio = cfg.codigo_municipio))), '[]'::jsonb),
    'entregas', coalesce((select jsonb_agg(jsonb_build_object('obrigacao', obrigacao, 'periodo', periodo, 'entregue_em', entregue_em, 'recibo', recibo, 'document_id', document_id, 'observacao', observacao) order by entregue_em desc)
      from public.fiscal_obrigacoes_entregas where organization_id = org), '[]'::jsonb)
  );
end;
$$;

-- Responsável técnico (contabilista) no perfil: nome e CRC, nada de CPF.
alter table public.contabil_perfil_empresa
  add column if not exists responsavel_tecnico_nome text check (responsavel_tecnico_nome is null or length(responsavel_tecnico_nome) <= 120),
  add column if not exists responsavel_tecnico_crc text check (responsavel_tecnico_crc is null or responsavel_tecnico_crc ~ '^[A-Z]{2}-[0-9]{3,8}(/[A-Z]-?[0-9])?$');
comment on column public.contabil_perfil_empresa.responsavel_tecnico_crc is 'CRC do contabilista responsável (UF-número, ex.: SP-233810). Sem CPF.';

create or replace function public.contabil_perfil_salvar(p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  if org is null or not public.has_feature('fiscal.config', 'operar') then
    raise exception 'Sem permissão para alterar o perfil fiscal da empresa.' using errcode = '42501';
  end if;
  insert into public.contabil_perfil_empresa (organization_id, modo, regime, cnaes_secundarios, rat, fap, beneficio_estadual, observacao, responsavel_tecnico_nome, responsavel_tecnico_crc, updated_at, updated_by, updated_by_name)
  values (org, coalesce(p ->> 'modo', 'escritorio'), coalesce(p ->> 'regime', 'a_definir'),
    coalesce(array(select regexp_replace(x, '\D', '', 'g') from jsonb_array_elements_text(coalesce(p -> 'cnaes_secundarios', '[]'::jsonb)) x where regexp_replace(x, '\D', '', 'g') ~ '^[0-9]{7}$'), '{}'),
    nullif(p ->> 'rat', '')::numeric, nullif(p ->> 'fap', '')::numeric,
    nullif(btrim(coalesce(p ->> 'beneficio_estadual', '')), ''), nullif(btrim(coalesce(p ->> 'observacao', '')), ''),
    nullif(btrim(coalesce(p ->> 'responsavel_tecnico_nome', '')), ''), nullif(upper(btrim(coalesce(p ->> 'responsavel_tecnico_crc', ''))), ''), now(), me, nome)
  on conflict (organization_id) do update set
    modo = excluded.modo, regime = excluded.regime, cnaes_secundarios = excluded.cnaes_secundarios, rat = excluded.rat, fap = excluded.fap,
    beneficio_estadual = excluded.beneficio_estadual, observacao = excluded.observacao,
    -- Tela antiga (sem os campos do responsável técnico) não apaga o que já está gravado.
    responsavel_tecnico_nome = case when p ? 'responsavel_tecnico_nome' then excluded.responsavel_tecnico_nome else contabil_perfil_empresa.responsavel_tecnico_nome end,
    responsavel_tecnico_crc = case when p ? 'responsavel_tecnico_crc' then excluded.responsavel_tecnico_crc else contabil_perfil_empresa.responsavel_tecnico_crc end,
    updated_at = now(), updated_by = me, updated_by_name = nome;
end;
$function$;
