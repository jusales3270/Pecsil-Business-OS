-- Dados da empresa para quem trabalha com eles (decisão do proprietário, 20/10/2026). A identificação da
-- empresa (razão social, CNPJ, IE, endereço...) fica na configuração do Fiscal, que só o Fiscal lê; mas
-- RH, Financeiro, Fiscal, Compras e Comercial usam esses dados no dia a dia (notas, OC, orçamento, guias,
-- folha). Esta função devolve só a identificação (nada de certificado nem de configuração de emissão) a
-- quem tem credencial em um desses módulos. A SARA usa (consulta dados_da_empresa).
-- Também registra no banco a decisão sobre o dado clínico: quem tem rh.clinico pode consultá-lo pela SARA.

create or replace function public.empresa_dados()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  r jsonb;
begin
  if org is null or not (public.has_module('rh') or public.has_module('financeiro') or public.has_module('fiscal')
                         or public.has_module('compras') or public.has_module('comercial')) then
    raise exception 'Os dados da empresa são de quem tem credencial no RH, Financeiro, Fiscal, Compras ou Comercial.' using errcode = '42501';
  end if;
  select jsonb_strip_nulls(jsonb_build_object(
    'razao_social', coalesce(nullif(btrim(fc.razao_social), ''), o.legal_name),
    'nome_fantasia', coalesce(nullif(btrim(fc.nome_fantasia), ''), o.display_name),
    'cnpj', coalesce(nullif(fc.cnpj, ''), nullif(regexp_replace(coalesce(o.tax_id, ''), '\D', '', 'g'), '')),
    'inscricao_estadual', nullif(btrim(fc.ie), ''), 'inscricao_municipal', nullif(btrim(fc.im), ''),
    'cnae', nullif(btrim(fc.cnae), ''), 'regime_tributario_crt', fc.crt,
    'logradouro', fc.logradouro, 'numero', fc.numero, 'complemento', nullif(btrim(fc.complemento), ''), 'bairro', fc.bairro,
    'municipio', fc.municipio, 'uf', fc.uf, 'cep', fc.cep, 'codigo_municipio_ibge', fc.codigo_municipio,
    'telefone', coalesce(nullif(btrim(fc.doc_telefones), ''), fc.telefone), 'email', fc.email,
    'email_nfe', fc.doc_email_nfe, 'site', fc.doc_site))
  into r
  from public.organizations o
  left join public.fiscal_config fc on fc.organization_id = o.id
  where o.id = org;
  return coalesce(r, '{}'::jsonb);
end $$;
revoke all on function public.empresa_dados() from public, anon;
grant execute on function public.empresa_dados() to authenticated;

comment on table public.rh_absence_clinical is
  'CID, diagnóstico e observação clínica dos afastamentos. Leitura só com rh.clinico (RLS). Decisão do proprietário (20/10/2026): quem tem rh.clinico pode consultar pela SARA; a credencial é a única restrição.';
