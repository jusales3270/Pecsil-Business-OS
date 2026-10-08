-- Envio de notas fiscais (XML ou DANFE em PDF) pelo Fiscal e pelo Almoxarifado.
--
-- Quando a nota casa com um fornecedor do cadastro pelo NOME e esse cadastro ainda
-- não tem CNPJ, quem lança a nota (Fiscal ou Almoxarifado) pode gravar o CNPJ da
-- nota nele — mesmo sem a permissão de editar fornecedores. Só preenche o vazio:
-- nunca troca um CNPJ existente nem repete um que já está em outro cadastro.
create or replace function public.supplier_set_tax_id_from_nfe(p_supplier uuid, p_cnpj text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
begin
  if not (public.has_feature('fiscal.icms', 'operar') or public.has_feature('almoxarifado.recebimento', 'operar')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if length(cnpj) <> 14 then return false; end if;
  if exists (select 1 from public.suppliers where organization_id = org and tax_id = cnpj) then return false; end if;
  update public.suppliers set tax_id = cnpj, updated_at = now()
  where id = p_supplier and organization_id = org and tax_id is null and merged_into is null;
  return found;
end;
$$;
revoke all on function public.supplier_set_tax_id_from_nfe(uuid, text) from public;
grant execute on function public.supplier_set_tax_id_from_nfe(uuid, text) to authenticated;
