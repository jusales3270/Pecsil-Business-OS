-- Segundo Cérebro, Etapa 2 (10/10/2026): coleta de arquivos dos computadores pelo navegador.
--
-- Decisões do proprietário:
--   D1 — só coleta quem ele credenciar: funcionalidade "Coletar arquivos" (fundacao.coleta).
--   D2 — a tela sugere Documentos, Área de trabalho, Downloads e a pasta da rede, e ignora
--        sempre pastas de sistema, de programas e de fotos/vídeos pessoais.
-- O aceite de cada pasta fica registrado (quem, quando, computador, pasta). A varredura e a
-- triagem acontecem no próprio computador; nada sobe sem a pessoa conferir. Documento de
-- colaborador não sobe pela coleta (vai pelo RH). Quem coleta guarda no setor certo, mas
-- depois só VÊ os setores que já via.

insert into public.access_features (code, module_code, label, levels, sort) values
  ('fundacao.coleta', 'fundacao', 'Coletar arquivos', '{ver,operar}', 60)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- Aceites de acesso a pastas ------------------------------------------------------------
create table if not exists public.file_collection_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  profile_name text,
  device_id uuid not null,
  device_name text not null check (length(trim(device_name)) between 2 and 80),
  folder_name text not null check (length(folder_name) between 1 and 200),
  user_agent text,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists idx_file_collection_consents_pessoa on public.file_collection_consents (organization_id, profile_id, accepted_at desc);

-- --- Execuções (cada varredura) ---------------------------------------------------------------
create table if not exists public.file_collection_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  consent_id uuid not null references public.file_collection_consents(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scanned integer not null default 0,
  ignored integer not null default 0,
  duplicates integer not null default 0,
  personal integer not null default 0,
  rh integer not null default 0,
  too_big integer not null default 0,
  proposed integer not null default 0,
  uploaded integer not null default 0
);
create index if not exists idx_file_collection_runs_aceite on public.file_collection_runs (organization_id, consent_id, started_at desc);

alter table public.file_collection_consents enable row level security;
alter table public.file_collection_runs enable row level security;
drop policy if exists file_collection_consents_read on public.file_collection_consents;
create policy file_collection_consents_read on public.file_collection_consents for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and (profile_id = (select public.current_profile_id()) or (select public.is_owner()))
);
drop policy if exists file_collection_runs_read on public.file_collection_runs;
create policy file_collection_runs_read on public.file_collection_runs for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and (profile_id = (select public.current_profile_id()) or (select public.is_owner()))
);
grant select on public.file_collection_consents, public.file_collection_runs to authenticated;

create or replace function public.file_collection_accept(p_device_id uuid, p_device_name text, p_folder_name text, p_user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  novo uuid;
begin
  if org is null or not public.has_feature('fundacao.coleta', 'operar') then
    raise exception 'Sem permissão para coletar arquivos.' using errcode = '42501';
  end if;
  insert into public.file_collection_consents (organization_id, profile_id, profile_name, device_id, device_name, folder_name, user_agent)
  values (org, me, (select full_name from public.profiles where id = me), p_device_id, trim(p_device_name), left(trim(p_folder_name), 200), left(p_user_agent, 200))
  returning id into novo;
  perform public.emit_module_event(org, 'fundacao', 'fundacao.coleta.acesso_concedido', 'coleta', novo::text,
    format('Acesso à pasta "%s" no computador "%s"', left(trim(p_folder_name), 80), trim(p_device_name)),
    jsonb_build_object('computador', trim(p_device_name), 'pasta', left(trim(p_folder_name), 200)));
  return novo;
end;
$$;
revoke all on function public.file_collection_accept(uuid, text, text, text) from public, anon;
grant execute on function public.file_collection_accept(uuid, text, text, text) to authenticated;

create or replace function public.file_collection_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.file_collection_consents set revoked_at = now()
   where id = p_id and organization_id = public.current_organization_id() and revoked_at is null
     and (profile_id = public.current_profile_id() or public.is_owner());
  if not found then raise exception 'Aceite não encontrado ou já revogado.'; end if;
end;
$$;
revoke all on function public.file_collection_revoke(uuid) from public, anon;
grant execute on function public.file_collection_revoke(uuid) to authenticated;

create or replace function public.file_collection_run_start(p_consent uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  novo uuid;
begin
  if not public.has_feature('fundacao.coleta', 'operar') then raise exception 'Sem permissão para coletar arquivos.' using errcode = '42501'; end if;
  if not exists (select 1 from public.file_collection_consents where id = p_consent and organization_id = org and profile_id = me and revoked_at is null) then
    raise exception 'Conceda o acesso à pasta antes de coletar.';
  end if;
  insert into public.file_collection_runs (organization_id, consent_id, profile_id) values (org, p_consent, me) returning id into novo;
  return novo;
end;
$$;
revoke all on function public.file_collection_run_start(uuid) from public, anon;
grant execute on function public.file_collection_run_start(uuid) to authenticated;

create or replace function public.file_collection_run_finish(p_run uuid, p_counts jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  r public.file_collection_runs%rowtype;
  n int := 0;
begin
  select * into r from public.file_collection_runs where id = p_run and organization_id = org and profile_id = public.current_profile_id() for update;
  if r.id is null then raise exception 'Coleta não encontrada.'; end if;
  select count(*) into n from public.company_documents
   where organization_id = org and source = 'coleta' and uploaded_by = r.profile_id and created_at >= r.started_at;
  update public.file_collection_runs set finished_at = now(),
    scanned = greatest(0, coalesce((p_counts ->> 'scanned')::int, 0)), ignored = greatest(0, coalesce((p_counts ->> 'ignored')::int, 0)),
    duplicates = greatest(0, coalesce((p_counts ->> 'duplicates')::int, 0)), personal = greatest(0, coalesce((p_counts ->> 'personal')::int, 0)),
    rh = greatest(0, coalesce((p_counts ->> 'rh')::int, 0)), too_big = greatest(0, coalesce((p_counts ->> 'too_big')::int, 0)),
    proposed = greatest(0, coalesce((p_counts ->> 'proposed')::int, 0)),
    uploaded = n
   where id = r.id;
  perform public.emit_module_event(org, 'fundacao', 'fundacao.coleta.concluida', 'coleta', r.id::text,
    format('Coleta concluída: %s arquivos guardados de %s varridos', n, coalesce((p_counts ->> 'scanned')::int, 0)),
    jsonb_build_object('varridos', coalesce((p_counts ->> 'scanned')::int, 0), 'guardados', n, 'repetidos', coalesce((p_counts ->> 'duplicates')::int, 0)));
end;
$$;
revoke all on function public.file_collection_run_finish(uuid, jsonb) from public, anon;
grant execute on function public.file_collection_run_finish(uuid, jsonb) to authenticated;

-- Quais destes arquivos (sha256) já estão na plataforma? Responde só sim/não: sem nome nem setor.
create or replace function public.company_document_hashes_exist(p_hashes text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_feature('fundacao.coleta', 'operar') then raise exception 'Sem permissão para coletar arquivos.' using errcode = '42501'; end if;
  if coalesce(array_length(p_hashes, 1), 0) > 2000 then raise exception 'No máximo 2.000 arquivos por consulta.'; end if;
  return coalesce((
    select array_agg(distinct d.sha256) from public.company_documents d
     where d.organization_id = public.current_organization_id() and d.archived_at is null and d.sha256 = any (select lower(h) from unnest(p_hashes) h)
  ), '{}');
end;
$$;
revoke all on function public.company_document_hashes_exist(text[]) from public, anon;
grant execute on function public.company_document_hashes_exist(text[]) to authenticated;

-- Registro de documento: igual ao de 202610100002, mas a coleta (source='coleta') é aceita de
-- quem tem "Coletar arquivos" — quem coleta guarda no setor certo sem precisar operar nele.
create or replace function public.company_document_register(
  p_module text, p_feature text, p_title text, p_category text, p_original_name text, p_mime text,
  p_size bigint, p_sha256 text, p_storage_path text, p_source text,
  p_intake uuid default null, p_entity_type text default null, p_entity_id text default null, p_previous uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  anterior public.company_documents%rowtype;
  existente uuid;
  novo uuid;
  versao int := 1;
begin
  if org is null or not (public.is_owner() or public.has_feature(p_feature, 'operar')
       or (p_source = 'coleta' and p_previous is null and public.has_feature('fundacao.coleta', 'operar'))) then
    raise exception 'Sem permissão para guardar documentos deste setor.' using errcode = '42501';
  end if;
  if p_feature not like p_module || '.%' then raise exception 'Funcionalidade não pertence ao setor.'; end if;
  if p_storage_path not like org::text || '/' || p_module || '/%' then raise exception 'Caminho do arquivo inválido.'; end if;

  if p_previous is not null then
    select * into anterior from public.company_documents where id = p_previous and organization_id = org for update;
    if anterior.id is null then raise exception 'Documento anterior não encontrado.'; end if;
    if anterior.superseded_by is not null then raise exception 'Esta versão já foi substituída; envie sobre a mais recente.'; end if;
    if anterior.module_code <> p_module then raise exception 'A nova versão precisa ser do mesmo setor.'; end if;
    versao := anterior.version + 1;
  else
    select id into existente from public.company_documents
     where organization_id = org and module_code = p_module and sha256 = lower(p_sha256) and superseded_by is null and archived_at is null
     limit 1;
    if existente is not null then
      if p_intake is not null then
        update public.file_intakes set document_id = existente where id = p_intake and organization_id = org and document_id is null;
      end if;
      return jsonb_build_object('id', existente, 'existente', true);
    end if;
  end if;

  insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
    sha256, storage_path, version, previous_id, source, file_intake_id, entity_type, entity_id, uploaded_by, uploaded_by_name)
  values (org, p_module, p_feature, left(coalesce(nullif(trim(p_title), ''), p_original_name), 200), nullif(left(trim(coalesce(p_category, '')), 60), ''),
    left(p_original_name, 255), p_mime, p_size, lower(p_sha256), p_storage_path, versao, p_previous, coalesce(p_source, 'envio'), p_intake,
    p_entity_type, p_entity_id, me, (select full_name from public.profiles where id = me))
  returning id into novo;

  if p_previous is not null then update public.company_documents set superseded_by = novo where id = p_previous; end if;
  if p_intake is not null then update public.file_intakes set document_id = novo where id = p_intake and organization_id = org; end if;

  perform public.emit_module_event(org, 'fundacao', 'fundacao.documento.enviado', 'documento', novo::text,
    format('Documento guardado em %s: %s%s', p_module, left(p_original_name, 120), case when versao > 1 then format(' (versão %s)', versao) else '' end),
    jsonb_build_object('setor', p_module, 'origem', coalesce(p_source, 'envio'), 'versao', versao, 'tamanho', p_size));
  return jsonb_build_object('id', novo, 'existente', false, 'versao', versao);
end;
$$;
revoke all on function public.company_document_register(text, text, text, text, text, text, bigint, text, text, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.company_document_register(text, text, text, text, text, text, bigint, text, text, text, uuid, text, text, uuid) to authenticated;

-- Decidir sugestão: igual ao de 202610100001, mais a coleta — quem coleta confirma ou corrige o
-- setor sugerido pelo Clef (é assim que se mede o acerto da triagem).
create or replace function public.ai_judgment_decide(p_id uuid, p_outcome text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  j public.ai_judgments%rowtype;
begin
  if p_outcome not in ('aceita', 'recusada', 'corrigida', 'ignorada') then raise exception 'Decisão inválida.'; end if;
  select * into j from public.ai_judgments where id = p_id and organization_id = org for update;
  if j.id is null then raise exception 'Sugestão não encontrada.'; end if;
  if not (public.is_owner()
          or (public.has_feature('fundacao.sugestoes', 'operar') and public.has_feature(j.feature_code, 'operar'))
          or (j.feature_code = 'fundacao.coleta' and public.has_feature('fundacao.coleta', 'operar'))) then
    raise exception 'Sem permissão para decidir esta sugestão.' using errcode = '42501';
  end if;
  if j.outcome <> 'pendente' then raise exception 'Esta sugestão já foi decidida.'; end if;
  if p_outcome = 'corrigida' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Diga qual é a resposta certa.'; end if;

  update public.ai_judgments
     set outcome = p_outcome, decided_by = public.current_profile_id(),
         decided_by_name = (select full_name from public.profiles where id = public.current_profile_id()),
         decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = j.id;

  perform public.emit_module_event(org, 'fundacao', 'fundacao.sugestao.decidida', 'sugestao', j.id::text,
    format('Sugestão da IA %s (%s)', p_outcome, j.use_code),
    jsonb_build_object('uso', j.use_code, 'decisao', p_outcome, 'confianca', j.confidence, 'faixa', j.band));
end;
$$;
revoke all on function public.ai_judgment_decide(uuid, text, text) from public, anon;
grant execute on function public.ai_judgment_decide(uuid, text, text) to authenticated;

-- Uso do Clef na triagem da coleta (nasce desligado; o proprietário liga no painel).
insert into public.ai_uses (organization_id, code, label, module_code, feature_code)
select o.id, 'fundacao.coleta_triagem', 'Triagem da coleta', 'fundacao', 'fundacao.coleta' from public.organizations o
on conflict (organization_id, code) do nothing;
