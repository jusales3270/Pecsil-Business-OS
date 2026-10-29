-- Fiscal › Portal do escritório: excluir um anexo (proprietário, 29/10/2026).
--
--   * Quem é do lado que enviou (empresa ou escritório) exclui o anexo, enquanto a competência não está fechada
--     e a pendência não está resolvida. O outro lado não apaga o que não mandou.
--   * Sai o anexo; o documento sai junto quando foi criado pelo portal e não está em outro anexo nem numa guia
--     (com ele saem as leituras: IBS/CBS, receita, conferência). A função devolve o caminho do arquivo para a
--     rota apagar do armazenamento (ou null quando o documento continua).
--   * Fica na Auditoria (fiscal_portal.anexo_excluido), com o nome do arquivo e quem excluiu.

create or replace function public.fiscal_portal_anexo_excluir(p_anexo uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  a public.fiscal_portal_anexos%rowtype;
  doc public.company_documents%rowtype;
  caminho text;
begin
  select * into a from public.fiscal_portal_anexos where id = p_anexo and organization_id = org for update;
  if a.id is null then raise exception 'Anexo não encontrado.'; end if;
  if a.lado <> lado then
    raise exception '%', case when a.lado = 'empresa' then 'Este arquivo foi enviado pela empresa: só a empresa pode excluir.' else 'Este arquivo foi enviado pelo escritório: só o escritório pode excluir.' end using errcode = '42501';
  end if;
  if a.competencia_id is not null and exists (select 1 from public.fiscal_competencias where id = a.competencia_id and situacao = 'fechada') then
    raise exception 'A competência está fechada: o arquivo não pode mais ser excluído.';
  end if;
  if a.pendencia_id is not null and exists (select 1 from public.fiscal_pendencias where id = a.pendencia_id and situacao = 'resolvida') then
    raise exception 'A pendência está resolvida: o arquivo não pode mais ser excluído.';
  end if;

  delete from public.fiscal_portal_anexos where id = a.id;
  select * into doc from public.company_documents where id = a.document_id and organization_id = org;
  if doc.id is not null and doc.feature_code = 'fiscal.portal'
     and not exists (select 1 from public.fiscal_portal_anexos where document_id = doc.id)
     and not exists (select 1 from public.fiscal_guias where document_id = doc.id) then
    caminho := doc.storage_path;
    delete from public.company_documents where id = doc.id;
  end if;
  if a.pendencia_id is not null then update public.fiscal_pendencias set updated_at = now() where id = a.pendencia_id; end if;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.anexo_excluido', 'document', a.document_id,
    jsonb_build_object('arquivo', a.nome, 'enviado_por', a.enviado_por_nome, 'enviado_em', a.created_at, 'documento_apagado', caminho is not null), 'sensitive');
  return caminho;
end;
$$;
revoke all on function public.fiscal_portal_anexo_excluir(uuid) from public, anon;
grant execute on function public.fiscal_portal_anexo_excluir(uuid) to authenticated;
