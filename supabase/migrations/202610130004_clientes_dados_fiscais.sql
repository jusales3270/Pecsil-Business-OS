-- Cadastro de clientes com os dados fiscais do destinatário da NF-e (13/10/2026, pedido do
-- proprietário: escolher o cliente na nota tem de preencher o formulário inteiro).
-- Até aqui o cliente tinha só nome e CNPJ. Agora: IE, endereço, código IBGE, UF, telefone e e-mail
-- para a nota. Quem preenche: a própria nota (ao salvar, decisão do proprietário), com a busca
-- pública por CNPJ/CEP, ou o cadastro. A gravação vinda da nota é feita pelo servidor, depois de
-- conferir a permissão (fiscal.nfe operar), pela função abaixo.

alter table public.customers
  add column if not exists ie text check (ie is null or ie ~ '^(\d{2,14}|ISENTO)$'),
  add column if not exists ind_ie smallint check (ind_ie is null or ind_ie in (1, 2, 9)),
  add column if not exists email_nfe text check (email_nfe is null or (length(email_nfe) <= 60 and email_nfe ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column if not exists cep text check (cep is null or cep ~ '^\d{8}$'),
  add column if not exists logradouro text check (logradouro is null or length(logradouro) <= 60),
  add column if not exists numero text check (numero is null or length(numero) <= 60),
  add column if not exists complemento text check (complemento is null or length(complemento) <= 60),
  add column if not exists bairro text check (bairro is null or length(bairro) <= 60),
  add column if not exists municipio text check (municipio is null or length(municipio) <= 60),
  add column if not exists codigo_municipio text check (codigo_municipio is null or codigo_municipio ~ '^\d{7}$'),
  add column if not exists uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column if not exists telefone text check (telefone is null or telefone ~ '^\d{6,14}$'),
  add column if not exists dados_fiscais_em timestamptz,
  add column if not exists dados_fiscais_por text;

-- Grava os dados fiscais vindos da nota. Acha o cliente pelo id; sem id, pelo CNPJ/CPF e depois
-- pelo nome (sem documento diferente); não achando e com documento, cria. Campo vazio na nota não
-- apaga o que o cadastro já tem; o CNPJ só é gravado se o cliente ainda não tiver um.
-- O servidor só manda documento com dígito verificador válido. Devolve o id (ou null).
create or replace function public.customer_dados_fiscais_gravar(p_org uuid, p_customer uuid, p jsonb, p_autor text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  doc text := nullif(regexp_replace(coalesce(p ->> 'documento', ''), '\D', '', 'g'), '');
  nome text := nullif(btrim(coalesce(p ->> 'nome', '')), '');
  alvo uuid := null;
  doc_atual text;
begin
  if doc is not null and length(doc) not in (11, 14) then doc := null; end if;
  if p_customer is not null then
    select id into alvo from public.customers where id = p_customer and organization_id = p_org;
  end if;
  if alvo is null and doc is not null then
    select coalesce(merged_into, id) into alvo from public.customers where organization_id = p_org and tax_id = doc limit 1;
  end if;
  if alvo is null and nome is not null then
    select id into alvo from public.customers
    where organization_id = p_org and normalized_name = public.normalize_party_name(nome) and merged_into is null
      and (tax_id is null or tax_id = doc);
  end if;
  if alvo is null then
    if doc is null or nome is null then return null; end if;
    -- Nome já usado por outro cliente com outro documento: não cria (seria outro cadastro com o mesmo nome).
    if exists (select 1 from public.customers where organization_id = p_org and normalized_name = public.normalize_party_name(nome)) then return null; end if;
    insert into public.customers (organization_id, name, tax_id) values (p_org, left(nome, 200), doc) returning id into alvo;
  end if;

  select tax_id into doc_atual from public.customers where id = alvo;
  update public.customers set
    tax_id = case when doc_atual is null and doc is not null and not exists (select 1 from public.customers o where o.organization_id = p_org and o.tax_id = doc and o.id <> alvo) then doc else tax_id end,
    ind_ie = coalesce(case when p ->> 'indIE' in ('1', '2', '9') then (p ->> 'indIE')::smallint end, ind_ie),
    ie = coalesce(case when (p ->> 'ie') ~ '^\d{2,14}$' then p ->> 'ie' end, ie),
    email_nfe = coalesce(case when length(p ->> 'email') <= 60 and (p ->> 'email') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(p ->> 'email') end, email_nfe),
    cep = coalesce(case when (p ->> 'cep') ~ '^\d{8}$' then p ->> 'cep' end, cep),
    logradouro = coalesce(nullif(left(btrim(coalesce(p ->> 'logradouro', '')), 60), ''), logradouro),
    numero = coalesce(nullif(left(btrim(coalesce(p ->> 'numero', '')), 60), ''), numero),
    complemento = coalesce(nullif(left(btrim(coalesce(p ->> 'complemento', '')), 60), ''), complemento),
    bairro = coalesce(nullif(left(btrim(coalesce(p ->> 'bairro', '')), 60), ''), bairro),
    municipio = coalesce(nullif(left(btrim(coalesce(p ->> 'municipio', '')), 60), ''), municipio),
    codigo_municipio = coalesce(case when (p ->> 'codigoMunicipio') ~ '^\d{7}$' then p ->> 'codigoMunicipio' end, codigo_municipio),
    uf = coalesce(case when upper(p ->> 'uf') ~ '^[A-Z]{2}$' then upper(p ->> 'uf') end, uf),
    telefone = coalesce(case when (p ->> 'fone') ~ '^\d{6,14}$' then p ->> 'fone' end, telefone),
    dados_fiscais_em = now(),
    dados_fiscais_por = left(p_autor, 120)
  where id = alvo;
  return alvo;
end;
$$;
revoke all on function public.customer_dados_fiscais_gravar(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.customer_dados_fiscais_gravar(uuid, uuid, jsonb, text) to service_role;
