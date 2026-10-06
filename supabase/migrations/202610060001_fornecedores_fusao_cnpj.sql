-- Unificar fornecedores sem perder o CNPJ.
--
-- Antes: o fornecedor unificado ficava inativo mas guardava o CNPJ, e o índice
-- único (organização + CNPJ) continuava valendo para ele. Resultado: o CNPJ não
-- podia mais ser cadastrado no fornecedor principal ("já está vinculado a uma
-- empresa"), que a pessoa nem enxergava. Caso real: MIRAI METALS & MINERALS.
--
-- Agora: se o principal não tem CNPJ e o unificado tem, o CNPJ passa para o
-- principal. Se os dois têm CNPJs diferentes, cada um fica com o seu.
-- O corpo é o de 202609290002, com o trecho do CNPJ acrescentado.
create or replace function public.merge_suppliers(keep_id uuid, drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  keep_name text;
  drop_name text;
  keep_tax text;
  drop_tax text;
begin
  if not public.can_manage_suppliers() then
    raise exception 'Sem permissão para unificar fornecedores.' using errcode = '42501';
  end if;
  if keep_id = drop_id then
    raise exception 'Escolha dois fornecedores diferentes.';
  end if;
  select name, tax_id into keep_name, keep_tax from public.suppliers where id = keep_id and organization_id = org and merged_into is null;
  select name, tax_id into drop_name, drop_tax from public.suppliers where id = drop_id and organization_id = org and merged_into is null;
  if keep_name is null or drop_name is null then
    raise exception 'Fornecedor não encontrado.';
  end if;

  update public.cotacoes set supplier_id = keep_id where supplier_id = drop_id;
  update public.compras set supplier_id = keep_id where supplier_id = drop_id;
  update public.finance_titles set supplier_id = keep_id where supplier_id = drop_id;
  update public.suppliers set merged_into = keep_id where merged_into = drop_id;

  -- O CNPJ sai do unificado primeiro (índice único) e só depois vai ao principal.
  if keep_tax is null and drop_tax is not null then
    update public.suppliers set tax_id = null, merged_into = keep_id, active = false where id = drop_id;
    update public.suppliers set tax_id = drop_tax where id = keep_id;
  else
    update public.suppliers set merged_into = keep_id, active = false where id = drop_id;
  end if;

  perform public.emit_module_event(org, 'cadastros', 'cadastros.fornecedor.unificado', 'fornecedor', keep_id::text,
    format('Fornecedores unificados · "%s" agora é "%s"', drop_name, keep_name),
    jsonb_build_object('mantido', keep_id, 'unificado', drop_id));
end;
$$;
revoke all on function public.merge_suppliers(uuid, uuid) from public;
grant execute on function public.merge_suppliers(uuid, uuid) to authenticated;
