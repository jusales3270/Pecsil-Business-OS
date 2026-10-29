-- Fiscal: a mesma NF-e não entra duas vezes (proprietário, 29/10/2026).
--
--   * A leitura das notas (fiscal_ibscbs_notas: IBS/CBS e receita do Lucro Presumido; fiscal_entradas:
--     conferência de entradas) era única por DOCUMENTO, não pela nota: o mesmo XML guardado duas vezes (anexo
--     repetido no Portal do escritório; o mesmo arquivo no Fiscal e no recebimento do Almoxarifado) virava duas
--     linhas. Achado em 29/10: NF 11170 (saída, out/2026) e NF 1079 (entrada, White Martins), cada uma em dobro.
--   * Agora a 2ª leitura da mesma chave fica marcada em `repetida_de` (aponta para a primeira; o documento
--     continua lido e não volta para a fila) e o banco não aceita duas leituras valendo da mesma chave.
--     A primeira é a do documento guardado antes.
--   * Anexo do portal: o mesmo arquivo (sha256) já guardado no Fiscal não vira documento novo; anexado de novo
--     no mesmo lugar é recusado. A função segue devolvendo o id do documento (a versão em uso continua
--     funcionando); a rota sabe que foi reaproveitado porque o caminho do documento não é o do arquivo que subiu.

-- 1. Leituras: a repetida aponta para a original.
alter table public.fiscal_ibscbs_notas add column if not exists repetida_de uuid references public.fiscal_ibscbs_notas(id) on delete cascade;
alter table public.fiscal_entradas add column if not exists repetida_de uuid references public.fiscal_entradas(id) on delete cascade;
comment on column public.fiscal_ibscbs_notas.repetida_de is 'Mesma NF-e (chave) já lida de outro documento: aponta para a leitura que vale. Não conta em nenhuma apuração.';
comment on column public.fiscal_entradas.repetida_de is 'Mesma NF-e (chave) já lida de outro documento: aponta para a leitura que vale. Não entra na conferência.';

-- 2. As repetidas de hoje: vale a do documento guardado primeiro.
with ordem as (
  select n.id,
         first_value(n.id) over w as primeira,
         row_number() over w as posicao
  from public.fiscal_ibscbs_notas n
  left join public.company_documents d on d.id = n.document_id
  where n.chave is not null and n.repetida_de is null
  window w as (partition by n.organization_id, n.chave order by coalesce(d.created_at, n.lido_em), n.lido_em, n.id)
)
update public.fiscal_ibscbs_notas n set repetida_de = o.primeira
from ordem o where n.id = o.id and o.posicao > 1;

with ordem as (
  select n.id,
         first_value(n.id) over w as primeira,
         row_number() over w as posicao
  from public.fiscal_entradas n
  left join public.company_documents d on d.id = n.document_id
  where n.chave is not null and n.repetida_de is null
  window w as (partition by n.organization_id, n.chave order by coalesce(d.created_at, n.lido_em), n.lido_em, n.id)
)
update public.fiscal_entradas n set repetida_de = o.primeira
from ordem o where n.id = o.id and o.posicao > 1;

-- 3. Uma leitura valendo por nota.
create unique index if not exists fiscal_ibscbs_notas_chave_unica on public.fiscal_ibscbs_notas (organization_id, chave)
  where chave is not null and repetida_de is null;
create unique index if not exists fiscal_entradas_chave_unica on public.fiscal_entradas (organization_id, chave)
  where chave is not null and repetida_de is null;

-- 4. Anexo do portal sem documento repetido.
create or replace function public.fiscal_portal_anexo_registrar(p_competencia uuid, p_pendencia uuid, p_original_name text, p_mime text, p_size bigint, p_sha256 text, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = me);
  doc uuid;
  igual uuid;
  ja record;
begin
  if p_competencia is null and p_pendencia is null then raise exception 'Anexe a uma competência ou a uma pendência.'; end if;
  if p_competencia is not null and not exists (select 1 from public.fiscal_competencias where id = p_competencia and organization_id = org) then raise exception 'Competência não encontrada.'; end if;
  if p_pendencia is not null and not exists (select 1 from public.fiscal_pendencias where id = p_pendencia and organization_id = org) then raise exception 'Pendência não encontrada.'; end if;
  if p_storage_path not like org::text || '/fiscal/%' then raise exception 'Caminho do arquivo inválido.'; end if;

  -- O mesmo arquivo já guardado no Fiscal. O escritório só enxerga os do portal: para ele, só esses valem.
  select id into igual from public.company_documents
   where organization_id = org and module_code = 'fiscal' and sha256 = lower(p_sha256) and superseded_by is null and archived_at is null
     and (lado = 'empresa' or feature_code = 'fiscal.portal')
   order by created_at limit 1;
  if igual is not null then
    select a.created_at, a.enviado_por_nome into ja from public.fiscal_portal_anexos a
     where a.organization_id = org and a.document_id = igual
       and a.competencia_id is not distinct from p_competencia and a.pendencia_id is not distinct from p_pendencia
     limit 1;
    if found then
      raise exception 'Este arquivo já foi anexado aqui em % por %.',
        to_char(ja.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), coalesce(ja.enviado_por_nome, 'outra pessoa')
        using errcode = '23505';
    end if;
    doc := igual;
  else
    insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
      sha256, storage_path, version, source, entity_type, entity_id, uploaded_by, uploaded_by_name)
    values (org, 'fiscal', 'fiscal.portal', left(p_original_name, 200), 'Portal do escritório', left(p_original_name, 255), p_mime, p_size,
      lower(p_sha256), p_storage_path, 1, 'envio', case when p_pendencia is not null then 'fiscal_pendencia' else 'fiscal_competencia' end,
      coalesce(p_pendencia, p_competencia)::text, me, nome)
    returning id into doc;
  end if;

  insert into public.fiscal_portal_anexos (organization_id, document_id, competencia_id, pendencia_id, lado, nome, tamanho, enviado_por_nome)
  values (org, doc, p_competencia, p_pendencia, lado, left(p_original_name, 255), coalesce(p_size, 0), nome);
  if p_pendencia is not null then update public.fiscal_pendencias set updated_at = now() where id = p_pendencia; end if;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.anexo', 'document', doc, jsonb_build_object('arquivo', left(p_original_name, 120), 'tamanho', p_size, 'ja_guardado', igual is not null), 'sensitive');
  if igual is null then
    perform public.emit_module_event(org, 'fundacao', 'fundacao.documento.enviado', 'documento', doc::text,
      format('Documento guardado em fiscal: %s', left(p_original_name, 120)), jsonb_build_object('setor', 'fiscal', 'origem', 'portal', 'versao', 1, 'tamanho', p_size));
  end if;
  return doc;
end;
$$;
revoke all on function public.fiscal_portal_anexo_registrar(uuid, uuid, text, text, bigint, text, text) from public, anon;
grant execute on function public.fiscal_portal_anexo_registrar(uuid, uuid, text, text, bigint, text, text) to authenticated;
