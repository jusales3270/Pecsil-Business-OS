-- Security boundaries: files follow metadata, approvals cannot be forged through the Data API.
-- Additive migration: historical migrations remain unchanged.

-- 1. RH Storage. A file without readable metadata cannot be listed, downloaded or signed.
-- Subqueries deliberately run as the caller and inherit documents RLS (including owner rights).
drop policy if exists rh_docs_objects_read on storage.objects;
drop policy if exists rh_docs_objects_insert on storage.objects;
drop policy if exists rh_docs_objects_update on storage.objects;
drop policy if exists rh_docs_objects_delete on storage.objects;

create policy rh_docs_objects_read on storage.objects for select to authenticated
using (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and exists (
    select 1 from public.documents d
    where d.organization_id = public.current_organization_id()
      and d.module_code = 'rh' and d.storage_bucket = 'rh-documents' and d.object_path = name
  )
);

-- The browser uploads before creating metadata. Only a fresh object can be uploaded;
-- upsert/replacement also needs SELECT + UPDATE and therefore the document's permissions.
create policy rh_docs_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and cardinality(storage.foldername(name)) = 2
  and public.has_feature('rh.documentos', 'operar')
  and coalesce(owner_id, owner::text) = auth.uid()::text
);

create policy rh_docs_objects_update on storage.objects for update to authenticated
using (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_feature('rh.documentos', 'operar')
  and exists (
    select 1 from public.documents d
    where d.organization_id = public.current_organization_id()
      and d.module_code = 'rh' and d.storage_bucket = 'rh-documents' and d.object_path = name
      and (d.classification in ('public', 'internal') or public.has_feature('rh.documentos', 'aprovar'))
  )
)
with check (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_feature('rh.documentos', 'operar')
  and exists (
    select 1 from public.documents d
    where d.organization_id = public.current_organization_id()
      and d.module_code = 'rh' and d.storage_bucket = 'rh-documents' and d.object_path = name
      and (d.classification in ('public', 'internal') or public.has_feature('rh.documentos', 'aprovar'))
  )
);

create policy rh_docs_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_feature('rh.documentos', 'operar')
  and exists (
    select 1 from public.documents d
    where d.organization_id = public.current_organization_id()
      and d.module_code = 'rh' and d.storage_bucket = 'rh-documents' and d.object_path = name
      and (d.classification in ('public', 'internal') or public.has_feature('rh.documentos', 'aprovar'))
  )
);

-- Prevent relinking an invisible sensitive object as a new public/internal document.
-- Definer is required only to inspect ownership and ALL existing links, including hidden ones;
-- the trigger still checks the session's organization, feature and uploader explicitly.
create or replace function public.rh_document_validate_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    if current_setting('role', true) in ('authenticated', 'anon') then
      raise exception 'Sessão inválida para vincular arquivo.' using errcode = '42501';
    end if;
    return new; -- trusted offline/service imports
  end if;
  if tg_op = 'UPDATE' then
    if old.storage_bucket = 'rh-documents' and
       (new.storage_bucket is distinct from old.storage_bucket or new.module_code is distinct from old.module_code
        or new.organization_id is distinct from old.organization_id) then
      raise exception 'Não é permitido mover um documento de RH para outro escopo.' using errcode = '42501';
    end if;
  end if;
  if new.storage_bucket is distinct from 'rh-documents' then return new; end if;
  if new.module_code <> 'rh' or new.organization_id is distinct from public.current_organization_id()
     or not public.has_feature('rh.documentos', 'operar') then
    raise exception 'Sem permissão para vincular arquivo do RH.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.object_path is distinct from old.object_path then
    if split_part(new.object_path, '/', 1) <> new.organization_id::text then
      raise exception 'Caminho do arquivo inválido.' using errcode = '42501';
    end if;
    -- Lock the object to serialize competing metadata registrations for the same upload.
    perform 1 from storage.objects o
      where o.bucket_id = 'rh-documents' and o.name = new.object_path
        and coalesce(o.owner_id, o.owner::text) = auth.uid()::text
      for update;
    if not found or exists (
      select 1 from public.documents d
      where d.storage_bucket = 'rh-documents' and d.object_path = new.object_path and d.id <> new.id
    ) then
      raise exception 'Arquivo indisponível para este documento.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.rh_document_validate_binding() from public, anon, authenticated;
drop trigger if exists rh_document_validate_binding on public.documents;
create trigger rh_document_validate_binding before insert or update on public.documents
for each row execute function public.rh_document_validate_binding();

-- 2. Requests and decisions. Session identity and database time are authoritative.
-- Invoker context distinguishes direct Data API writes from trusted service imports.
create or replace function public.rh_request_protect_decision()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  feature text := case tg_table_name when 'rh_absences' then 'rh.ferias' else 'rh.beneficios' end;
  me uuid := public.current_profile_id();
  can_decide boolean := public.has_feature(feature, 'aprovar');
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if me is null or new.organization_id is distinct from public.current_organization_id() then
    raise exception 'Sessão inválida para esta solicitação.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.organization_id = new.organization_id) then
    raise exception 'Colaborador fora da organização.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not can_decide and (new.status::text <> 'pending' or new.decided_at is not null or new.decided_by_profile_id is not null) then
      raise exception 'Uma solicitação deve nascer pendente, sem decisão.' using errcode = '42501';
    end if;
    new.requested_by_profile_id := me;
    new.requested_at := now();
  else
    if new.organization_id is distinct from old.organization_id or new.employee_id is distinct from old.employee_id then
      raise exception 'Não é permitido transferir a solicitação.' using errcode = '42501';
    end if;
    new.requested_by_profile_id := old.requested_by_profile_id;
    new.requested_at := old.requested_at;
    if new.status is distinct from old.status and not can_decide then
      raise exception 'Sem permissão para decidir.' using errcode = '42501';
    end if;
  end if;
  if new.status::text in ('approved', 'rejected') then
    if not can_decide then raise exception 'Sem permissão para decidir.' using errcode = '42501'; end if;
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.decided_by_profile_id := me;
      new.decided_at := now();
    else
      new.decided_by_profile_id := old.decided_by_profile_id;
      new.decided_at := old.decided_at;
    end if;
  else
    new.decided_by_profile_id := null;
    new.decided_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.rh_request_protect_decision() from public, anon, authenticated;
drop trigger if exists rh_absences_protect_decision on public.rh_absences;
create trigger rh_absences_protect_decision before insert or update on public.rh_absences
for each row execute function public.rh_request_protect_decision();
drop trigger if exists rh_benefit_requests_protect_decision on public.rh_benefit_requests;
create trigger rh_benefit_requests_protect_decision before insert or update on public.rh_benefit_requests
for each row execute function public.rh_request_protect_decision();

-- 3. Direct writes cannot manufacture approvals or ledger-derived payment totals.
-- This MUST be INVOKER: approved finance_* RPCs are SECURITY DEFINER and already authorize
-- the user. Trusting a user-settable GUC, or making this guard DEFINER, would reopen bypasses.
create or replace function public.finance_titulo_protege_aprovacao()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_approval', 'approved') then
      raise exception 'A situação inicial do título não pode registrar uma baixa.' using errcode = '42501';
    end if;
    if new.status = 'approved' and (new.direction = 'payable' or exists (
      select 1 from public.finance_approval_rules r
      where r.organization_id = new.organization_id and r.active
        and (r.direction is null or r.direction = new.direction)
        and new.original_amount >= r.min_amount and (r.max_amount is null or new.original_amount <= r.max_amount)
    )) then new.status := 'pending_approval'; end if;
    new.created_by_profile_id := public.current_profile_id();
    new.approved_by_profile_id := null;
    new.approved_at := null;
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id or new.direction is distinct from old.direction then
    raise exception 'Não é permitido transferir o escopo de um título.' using errcode = '42501';
  end if;
  if new.approved_by_profile_id is distinct from old.approved_by_profile_id or new.approved_at is distinct from old.approved_at then
    raise exception 'A aprovação só pode ser registrada pelo fluxo de alçadas.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'pending_approval')
      or (new.status = 'cancelled' and public.has_feature(public.finance_direction_feature(old.direction), 'aprovar'))) then
      raise exception 'Altere a situação pelo fluxo de aprovação ou baixa.' using errcode = '42501';
    end if;
  end if;
  if (new.original_amount is distinct from old.original_amount or new.is_forecast is distinct from old.is_forecast
      or new.is_historical is distinct from old.is_historical)
      and exists (select 1 from public.finance_installments i where i.title_id = old.id and i.settled_amount > 0) then
    raise exception 'Estorne as baixas antes de alterar o valor ou a natureza do título.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists finance_titulo_protege_aprovacao on public.finance_titles;
create trigger finance_titulo_protege_aprovacao before insert or update on public.finance_titles
for each row execute function public.finance_titulo_protege_aprovacao();

-- Any material change invalidates earlier levels, including while still pending.
-- Realizing a forecast/historical title must not retain an approval for a different amount.
create or replace function public.finance_titulo_valor_alcada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.original_amount is not distinct from old.original_amount
     and new.is_forecast is not distinct from old.is_forecast
     and new.is_historical is not distinct from old.is_historical then return new; end if;
  if new.status not in ('draft', 'pending_approval', 'approved', 'overdue') or coalesce(new.is_forecast, false) then return new; end if;
  if exists (select 1 from public.finance_installments i where i.title_id = new.id and i.settled_amount > 0) then return new; end if;
  update public.finance_approval_requests set status = 'cancelled', decided_at = now(), reason = 'Valor ou natureza do título alterado'
    where title_id = new.id and status in ('pending', 'approved');
  if exists (select 1 from public.finance_regras_do_titulo(new.organization_id, new.direction, new.original_amount)) then
    new.status := 'pending_approval';
    new.approved_at := null;
    new.approved_by_profile_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists finance_titulo_valor_alcada on public.finance_titles;
create trigger finance_titulo_valor_alcada before update of original_amount, is_forecast, is_historical on public.finance_titles
for each row execute function public.finance_titulo_valor_alcada();

create or replace function public.finance_installment_protect_ledger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  original numeric;
  allocated numeric;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.settled_amount <> 0 or new.status not in ('pending', 'overdue') then
      raise exception 'A baixa da parcela só pode ser registrada pelo fluxo financeiro.' using errcode = '42501';
    end if;
  else
    if new.organization_id is distinct from old.organization_id or new.title_id is distinct from old.title_id then
      raise exception 'Não é permitido transferir uma parcela.' using errcode = '42501';
    end if;
    if new.settled_amount is distinct from old.settled_amount then
      raise exception 'O saldo baixado é calculado pelas baixas, não editável.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
      (old.status in ('pending', 'overdue') and new.status in ('pending', 'overdue'))
      or (new.status = 'cancelled' and public.finance_title_access(old.title_id, 'aprovar'))
    ) then
      raise exception 'A situação da parcela é calculada pelo fluxo financeiro.' using errcode = '42501';
    end if;
    if new.amount is distinct from old.amount and old.settled_amount > 0 then
      raise exception 'Estorne as baixas antes de alterar o valor da parcela.' using errcode = '42501';
    end if;
  end if;
  -- Serialize allocations: an operator cannot enlarge installments beyond the approved title.
  select t.original_amount into original from public.finance_titles t
    where t.id = new.title_id and t.organization_id = new.organization_id for update;
  select coalesce(sum(i.amount), 0) into allocated from public.finance_installments i
    where i.title_id = new.title_id and i.id <> new.id;
  if original is null or allocated + new.amount > original then
    raise exception 'A soma das parcelas ultrapassa o valor original do título.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.finance_installment_protect_ledger() from public, anon, authenticated;
drop trigger if exists finance_installment_protect_ledger on public.finance_installments;
create trigger finance_installment_protect_ledger before insert or update on public.finance_installments
for each row execute function public.finance_installment_protect_ledger();
-- All application settlement writes already use authorized finance_* RPCs.
revoke insert, update, delete on public.finance_settlements from anon, authenticated;

-- Previsões não são obrigações realizadas. A baixa não pode contornar a alçada
-- mudando a natureza do título; a carga histórica exclusiva do serviço é preservada.
create or replace function public.finance_validate_settlement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  installment_total numeric(18,2);
  already_applied numeric(18,2);
  installment_org uuid;
  title_status public.finance_title_status;
  title_forecast boolean;
begin
  select i.amount, i.organization_id, t.status, t.is_forecast
    into installment_total, installment_org, title_status, title_forecast
  from public.finance_installments i
  join public.finance_titles t on t.id = i.title_id
  where i.id = new.installment_id
  for update of i, t;

  if installment_total is null then
    raise exception 'Parcela financeira não encontrada';
  end if;
  if new.organization_id <> installment_org then
    raise exception 'A baixa e a parcela devem pertencer à mesma organização';
  end if;
  if tg_op = 'INSERT' then
    if title_status not in ('approved', 'overdue', 'partially_settled') then
      raise exception 'Aprove o título antes de dar baixa.' using errcode = '42501';
    end if;
    if coalesce(title_forecast, false)
       and not (coalesce(current_setting('role', true), 'none') in ('service_role', 'none') and auth.uid() is null) then
      raise exception 'Realize a previsão e conclua a aprovação antes de dar baixa.' using errcode = '42501';
    end if;
  end if;
  if new.reversed_at is not null then
    return new;
  end if;

  select coalesce(sum(amount + discount), 0)
    into already_applied
  from public.finance_settlements
  where installment_id = new.installment_id
    and reversed_at is null
    and id <> new.id;

  if already_applied + new.amount + new.discount > installment_total then
    raise exception 'A baixa ultrapassa o saldo da parcela';
  end if;

  return new;
end;
$$;


-- 4. Version substitution is confined to the same feature; deduplication is equally scoped.
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
       or (p_source = 'coleta' and p_previous is null and public.coleta_permitida(p_module))) then
    raise exception 'Sem permissão para guardar documentos deste setor.' using errcode = '42501';
  end if;
  if p_feature not like p_module || '.%' then raise exception 'Funcionalidade não pertence ao setor.'; end if;
  if p_storage_path not like org::text || '/' || p_module || '/%' then raise exception 'Caminho do arquivo inválido.'; end if;

  if p_previous is not null then
    select * into anterior from public.company_documents where id = p_previous and organization_id = org for update;
    if anterior.id is null then raise exception 'Documento anterior não encontrado.'; end if;
    if anterior.superseded_by is not null then raise exception 'Esta versão já foi substituída; envie sobre a mais recente.'; end if;
    if anterior.module_code <> p_module or anterior.feature_code <> p_feature then
      raise exception 'A nova versão precisa pertencer à mesma funcionalidade.' using errcode = '42501';
    end if;
    if not public.has_feature(anterior.feature_code, 'operar') then
      raise exception 'Sem permissão para substituir este documento.' using errcode = '42501';
    end if;
    versao := anterior.version + 1;
  else
    select id into existente from public.company_documents
     where organization_id = org and module_code = p_module and feature_code = p_feature and sha256 = lower(p_sha256) and superseded_by is null and archived_at is null
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
