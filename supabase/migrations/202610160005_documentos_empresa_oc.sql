-- C-17 (roadmap): a Ordem de Compra deixa de ter a identidade da PecSil fixa no código.
-- O emitente vem de fiscal_config (o mesmo da NF-e) e o que só aparece nos documentos para
-- fornecedores (telefones, site, e-mail para a NF-e e as notas da OC) vira configuração da
-- organização. Os valores da PecSil entram como DADO, iguais ao modelo do sistema antigo.

alter table public.fiscal_config
  add column if not exists doc_telefones text check (doc_telefones is null or length(doc_telefones) <= 120),
  add column if not exists doc_site text check (doc_site is null or length(doc_site) <= 120),
  add column if not exists doc_email_nfe text check (doc_email_nfe is null or length(doc_email_nfe) <= 120),
  -- Uma nota por linha; **texto** sai em negrito.
  add column if not exists doc_notas_ordem_compra text check (doc_notas_ordem_compra is null or length(doc_notas_ordem_compra) <= 3000);

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
    doc_telefones = case when p ? 'doc_telefones' then nullif(trim(p ->> 'doc_telefones'), '') else doc_telefones end,
    doc_site = case when p ? 'doc_site' then nullif(lower(trim(p ->> 'doc_site')), '') else doc_site end,
    doc_email_nfe = case when p ? 'doc_email_nfe' then nullif(lower(trim(p ->> 'doc_email_nfe')), '') else doc_email_nfe end,
    doc_notas_ordem_compra = case when p ? 'doc_notas_ordem_compra' then nullif(trim(p ->> 'doc_notas_ordem_compra'), '') else doc_notas_ordem_compra end,
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

-- Identidade da empresa para os documentos de compra. Quem vê a OC não precisa ver a configuração
-- fiscal inteira: só o que sai impresso. Sem fiscal_config, cai no cadastro da organização.
create or replace function public.empresa_documento_compra()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  r jsonb;
begin
  if org is null or not (public.has_feature('compras.cotacoes') or public.has_feature('compras.aprovacoes') or public.has_feature('compras.realizadas')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'razao_social', coalesce(fc.razao_social, o.legal_name), 'cnpj', coalesce(fc.cnpj, nullif(regexp_replace(coalesce(o.tax_id, ''), '\D', '', 'g'), '')),
    'ie', fc.ie, 'logradouro', fc.logradouro, 'numero', fc.numero, 'complemento', fc.complemento, 'bairro', fc.bairro,
    'municipio', fc.municipio, 'uf', fc.uf, 'cep', fc.cep, 'telefone', fc.telefone,
    'telefones', fc.doc_telefones, 'site', fc.doc_site, 'email_nfe', fc.doc_email_nfe, 'notas_ordem_compra', fc.doc_notas_ordem_compra)
  into r
  from public.organizations o
  left join public.fiscal_config fc on fc.organization_id = o.id
  where o.id = org;
  return r;
end;
$$;
revoke all on function public.empresa_documento_compra() from public, anon;
grant execute on function public.empresa_documento_compra() to authenticated;

-- PecSil: os dados que estavam em lib/empresa.ts (modelo da OC nº 14805).
update public.fiscal_config set
  doc_telefones = '(11) 4013-4870 / (11) 4023-2301',
  doc_site = 'www.pecsil.com.br',
  doc_email_nfe = 'nfe@pecsil.com.br',
  doc_notas_ordem_compra = concat_ws(E'\n',
    'Fazer constar o número deste pedido de compra em todas as correspondências, documentos de remessa e fatura relacionados.',
    'Enviar nota fiscal eletrônica e arquivo xml para: nfe@pecsil.com.br',
    'Horário de recebimento: **De segunda a quinta das 7h30 às 11h30 e das 13h00 às 16h30 e sexta das 7h30 às 11h30 e das 13h00 às 15h30**',
    '**NÃO RECEBEMOS MATERIAIS NOS 3 ÚLTIMOS DIAS ÚTEIS DO MÊS SEM AUTORIZAÇÃO PRÉVIA. QUALQUER EVENTUAL TENTATIVA DE ENTREGA SEM AUTORIZAÇÃO SERÁ RECUSADA.**')
where cnpj = '46839106000184' and doc_telefones is null and doc_notas_ordem_compra is null;
