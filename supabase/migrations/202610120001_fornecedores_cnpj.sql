-- CNPJ dos fornecedores — captura automática a cada nota (12/10/2026).
--
-- Decisão do proprietário: daqui para frente, toda nota com CNPJ (Painel do ICMS, recebimento do
-- Almoxarifado, XML de NF-e guardado) liga-se SOZINHA ao fornecedor que tem aquele CNPJ. Quando o
-- cadastro não tem o CNPJ, a plataforma PROPÕE e alguém confirma:
--   completar — o fornecedor da nota (ou o de nome igual) ainda não tem CNPJ;
--   novo      — ninguém no cadastro bate com a nota;
--   conflito  — o CNPJ é de outro fornecedor, ou o da nota já tem outro CNPJ (duplicado ou filial).
-- "Marcar para unificar" alimenta a unificação de fornecedores (Etapa 1 do PLANO-JEV).
-- O CNPJ da própria empresa (organizations.tax_id) nunca vira fornecedor (diretriz multiempresa).
-- O caminho que já existia (Fiscal › Enviar notas grava o CNPJ sozinho) continua; quando ele grava,
-- a pendência correspondente é baixada aqui.

create or replace function public.cnpj_valido(p text)
returns boolean
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  p1 int[] := '{5,4,3,2,9,8,7,6,5,4,3,2}';
  p2 int[] := '{6,5,4,3,2,9,8,7,6,5,4,3,2}';
  s int := 0;
  r int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1+$' then return false; end if;
  for i in 1..12 loop s := s + substr(d, i, 1)::int * p1[i]; end loop;
  r := s % 11;
  if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + substr(d, i, 1)::int * p2[i]; end loop;
  r := s % 11;
  return (case when r < 2 then 0 else 11 - r end) = substr(d, 14, 1)::int;
end;
$$;

create or replace function public.cnpj_da_empresa(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$ select regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') from public.organizations where id = p_org $$;

create or replace function public.fornecedor_por_cnpj(p_org uuid, p_cnpj text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id from public.suppliers s
   where s.organization_id = p_org and s.merged_into is null and s.tax_id is not null
     and regexp_replace(s.tax_id, '\D', '', 'g') = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
   limit 1
$$;
revoke all on function public.cnpj_da_empresa(uuid) from public, anon;
revoke all on function public.fornecedor_por_cnpj(uuid, text) from public, anon;

-- --- Fila de pendências ---------------------------------------------------------------------------
create table if not exists public.supplier_cnpj_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo text not null check (tipo in ('completar', 'novo', 'conflito')),
  supplier_id uuid references public.suppliers(id) on delete cascade,
  outro_supplier_id uuid references public.suppliers(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^\d{14}$'),
  nome_na_nota text check (nome_na_nota is null or length(nome_na_nota) <= 200),
  origem_tipo text not null check (origem_tipo in ('nota_icms', 'recebimento', 'documento')),
  origem_id text not null check (length(origem_id) <= 80),
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'recusada', 'para_unificar')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_supplier_cnpj_suggestions_unica on public.supplier_cnpj_suggestions
  (organization_id, tipo, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), cnpj) where status = 'pendente';
create index if not exists idx_supplier_cnpj_suggestions_fila on public.supplier_cnpj_suggestions (organization_id, status, created_at desc);

alter table public.supplier_cnpj_suggestions enable row level security;
drop policy if exists supplier_cnpj_suggestions_read on public.supplier_cnpj_suggestions;
create policy supplier_cnpj_suggestions_read on public.supplier_cnpj_suggestions for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and ((select public.is_owner()) or public.has_feature('compras.fornecedores') or public.has_feature('fundacao.cadastros'))
);
revoke all on public.supplier_cnpj_suggestions from anon, authenticated;
grant select on public.supplier_cnpj_suggestions to authenticated;

-- Avalia um CNPJ visto numa nota e registra a pendência, se houver. Núcleo comum dos gatilhos das
-- notas e do registro vindo de documento (XML de NF-e).
create or replace function public.fornecedor_cnpj_avaliar(
  p_org uuid, p_cnpj text, p_nome text, p_supplier uuid, p_origem_tipo text, p_origem_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  dono uuid;
  forn public.suppliers%rowtype;
  mesmo_nome uuid;
  v_tipo text;
  v_sup uuid;
  v_outro uuid;
begin
  if not public.cnpj_valido(c) or c = public.cnpj_da_empresa(p_org) then return; end if;
  dono := public.fornecedor_por_cnpj(p_org, c);
  if p_supplier is not null then
    select * into forn from public.suppliers where id = p_supplier and organization_id = p_org;
  end if;
  if dono is not null then
    -- O CNPJ já é de alguém: só é pendência se a nota aponta para OUTRO fornecedor.
    if forn.id is null or forn.id = dono then return; end if;
    v_tipo := 'conflito'; v_sup := forn.id; v_outro := dono;
  elsif forn.id is not null then
    if forn.tax_id is null then v_tipo := 'completar'; v_sup := forn.id;
    else v_tipo := 'conflito'; v_sup := forn.id; end if; -- já tem outro CNPJ (duplicado ou filial)
  else
    select s.id into mesmo_nome from public.suppliers s
     where s.organization_id = p_org and s.merged_into is null and s.tax_id is null
       and s.normalized_name = public.normalize_party_name(p_nome);
    if mesmo_nome is not null then v_tipo := 'completar'; v_sup := mesmo_nome;
    else v_tipo := 'novo'; v_sup := null; end if;
  end if;
  insert into public.supplier_cnpj_suggestions (organization_id, tipo, supplier_id, outro_supplier_id, cnpj, nome_na_nota, origem_tipo, origem_id)
  values (p_org, v_tipo, v_sup, v_outro, c, left(nullif(trim(coalesce(p_nome, '')), ''), 200), p_origem_tipo, p_origem_id)
  on conflict (organization_id, tipo, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), cnpj) where status = 'pendente' do nothing;
end;
$$;
revoke all on function public.fornecedor_cnpj_avaliar(uuid, text, text, uuid, text, text) from public, anon, authenticated;

-- --- Gatilhos nas notas ---------------------------------------------------------------------------
-- Antes de gravar: nota sem fornecedor ganha o fornecedor que tem aquele CNPJ (exato, automático).
create or replace function public.notas_ligar_fornecedor_cnpj()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g');
begin
  if new.supplier_id is null and public.cnpj_valido(c) and c <> public.cnpj_da_empresa(new.organization_id) then
    new.supplier_id := public.fornecedor_por_cnpj(new.organization_id, c);
  end if;
  return new;
end;
$$;

-- Depois de gravar: registra a pendência (completar, novo, conflito), se houver.
create or replace function public.notas_pendencia_cnpj()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fornecedor_cnpj_avaliar(new.organization_id, new.cnpj, new.fornecedor, new.supplier_id,
    case tg_table_name when 'receipts' then 'recebimento' else 'nota_icms' end, new.id::text);
  return null;
end;
$$;

drop trigger if exists fiscal_icms_entries_fornecedor_cnpj on public.fiscal_icms_entries;
create trigger fiscal_icms_entries_fornecedor_cnpj before insert or update of cnpj, supplier_id on public.fiscal_icms_entries
for each row execute function public.notas_ligar_fornecedor_cnpj();
drop trigger if exists fiscal_icms_entries_pendencia_cnpj on public.fiscal_icms_entries;
create trigger fiscal_icms_entries_pendencia_cnpj after insert or update of cnpj, supplier_id on public.fiscal_icms_entries
for each row execute function public.notas_pendencia_cnpj();
drop trigger if exists receipts_fornecedor_cnpj on public.receipts;
create trigger receipts_fornecedor_cnpj before insert or update of cnpj, supplier_id on public.receipts
for each row execute function public.notas_ligar_fornecedor_cnpj();
drop trigger if exists receipts_pendencia_cnpj on public.receipts;
create trigger receipts_pendencia_cnpj after insert or update of cnpj, supplier_id on public.receipts
for each row execute function public.notas_pendencia_cnpj();

-- --- Quando um fornecedor ganha CNPJ (por qualquer caminho) -----------------------------------------
-- Baixa as pendências daquele CNPJ, liga as notas sem fornecedor e pede para religar os documentos.
create or replace function public.fornecedor_cnpj_gravado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := regexp_replace(coalesce(new.tax_id, ''), '\D', '', 'g');
  formatado text;
begin
  if not public.cnpj_valido(c) or (tg_op = 'UPDATE' and regexp_replace(coalesce(old.tax_id, ''), '\D', '', 'g') = c) then
    return null;
  end if;
  formatado := substr(c, 1, 2) || '.' || substr(c, 3, 3) || '.' || substr(c, 6, 3) || '/' || substr(c, 9, 4) || '-' || substr(c, 13, 2);
  update public.supplier_cnpj_suggestions
     set status = 'aceita', decided_at = now(), decided_by_name = coalesce(decided_by_name, 'Gravado no cadastro')
   where organization_id = new.organization_id and cnpj = c and status = 'pendente' and tipo in ('completar', 'novo')
     and (supplier_id is null or supplier_id = new.id);
  update public.fiscal_icms_entries set supplier_id = new.id
   where organization_id = new.organization_id and supplier_id is null and regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = c;
  update public.receipts set supplier_id = new.id
   where organization_id = new.organization_id and supplier_id is null and regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = c;
  update public.company_document_texts set linked_at = null
   where organization_id = new.organization_id and status = 'lido'
     and (position(c in coalesce(content, '')) > 0 or position(formatado in coalesce(content, '')) > 0);
  return null;
end;
$$;
drop trigger if exists suppliers_cnpj_gravado on public.suppliers;
create trigger suppliers_cnpj_gravado after insert or update of tax_id on public.suppliers
for each row when (new.tax_id is not null) execute function public.fornecedor_cnpj_gravado();

-- --- Decidir uma pendência --------------------------------------------------------------------------
-- decisões: gravar (completar) · cadastrar (novo) · ligar (novo, a um fornecedor escolhido) ·
--           unificar (conflito → fila da unificação) · recusar (qualquer)
create or replace function public.supplier_cnpj_decide(p_id uuid, p_decisao text, p_supplier uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  sg public.supplier_cnpj_suggestions%rowtype;
  alvo uuid;
  existente public.suppliers%rowtype;
  dono uuid;
  novo_status text := 'aceita';
begin
  if org is null or not (public.is_owner() or public.can_manage_suppliers()) then
    raise exception 'Sem permissão para editar fornecedores.' using errcode = '42501';
  end if;
  select * into sg from public.supplier_cnpj_suggestions where id = p_id and organization_id = org for update;
  if sg.id is null then raise exception 'Pendência não encontrada.'; end if;
  if sg.status <> 'pendente' then raise exception 'Esta pendência já foi decidida.'; end if;
  dono := public.fornecedor_por_cnpj(org, sg.cnpj);

  if p_decisao = 'recusar' then
    novo_status := 'recusada';
  elsif p_decisao = 'unificar' and sg.tipo = 'conflito' then
    novo_status := 'para_unificar';
  elsif p_decisao = 'gravar' and sg.tipo = 'completar' then
    if dono is not null then raise exception 'Este CNPJ já é de outro fornecedor no cadastro.'; end if;
    alvo := sg.supplier_id;
  elsif p_decisao = 'ligar' and sg.tipo = 'novo' then
    if dono is not null then raise exception 'Este CNPJ já é de outro fornecedor no cadastro.'; end if;
    select * into existente from public.suppliers where id = p_supplier and organization_id = org and merged_into is null;
    if existente.id is null then raise exception 'Escolha o fornecedor.'; end if;
    if existente.tax_id is not null then raise exception 'Esse fornecedor já tem outro CNPJ.'; end if;
    alvo := existente.id;
  elsif p_decisao = 'cadastrar' and sg.tipo = 'novo' then
    if dono is not null then raise exception 'Este CNPJ já é de outro fornecedor no cadastro.'; end if;
    if coalesce(trim(sg.nome_na_nota), '') = '' then raise exception 'A nota não trouxe o nome do fornecedor.'; end if;
    select * into existente from public.suppliers where organization_id = org and normalized_name = public.normalize_party_name(sg.nome_na_nota);
    if existente.id is not null then
      if existente.tax_id is not null then raise exception 'Já existe fornecedor com esse nome e outro CNPJ.'; end if;
      alvo := existente.id;
    else
      insert into public.suppliers (organization_id, name, normalized_name, active)
      values (org, trim(sg.nome_na_nota), public.normalize_party_name(sg.nome_na_nota), true)
      returning id into alvo;
    end if;
  else
    raise exception 'Decisão inválida para esta pendência.';
  end if;

  if alvo is not null then
    -- O gatilho de suppliers baixa as pendências do CNPJ, liga as notas e religa os documentos.
    update public.suppliers set tax_id = sg.cnpj, updated_at = now() where id = alvo and organization_id = org and tax_id is null;
    if not found then raise exception 'O fornecedor já tem CNPJ.'; end if;
    perform public.emit_module_event(org, 'cadastros', 'cadastros.fornecedor.cnpj_confirmado', 'fornecedor', alvo::text,
      format('CNPJ %s confirmado no fornecedor', sg.cnpj), jsonb_build_object('cnpj', sg.cnpj, 'origem', sg.origem_tipo, 'decisao', p_decisao));
  end if;
  update public.supplier_cnpj_suggestions
     set status = novo_status, supplier_id = coalesce(alvo, supplier_id), decided_by = public.current_profile_id(),
         decided_by_name = (select full_name from public.profiles where id = public.current_profile_id()), decided_at = now()
   where id = sg.id;
  return jsonb_build_object('status', novo_status, 'fornecedor', alvo);
end;
$$;
revoke all on function public.supplier_cnpj_decide(uuid, text, uuid) from public, anon;
grant execute on function public.supplier_cnpj_decide(uuid, text, uuid) to authenticated;

-- Pendência vinda de um documento guardado (XML de NF-e), só pelo servidor.
create or replace function public.supplier_cnpj_registrar(p_org uuid, p_cnpj text, p_nome text, p_documento uuid)
returns void
language sql
security definer
set search_path = public
as $$ select public.fornecedor_cnpj_avaliar(p_org, p_cnpj, p_nome, null, 'documento', p_documento::text) $$;
revoke all on function public.supplier_cnpj_registrar(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.supplier_cnpj_registrar(uuid, text, text, uuid) to service_role;

-- --- As notas que já existem ------------------------------------------------------------------------
-- Liga ao fornecedor pelo CNPJ e registra as pendências (os gatilhos acima fazem o trabalho).
update public.fiscal_icms_entries set cnpj = cnpj where cnpj is not null;
update public.receipts set cnpj = cnpj where cnpj is not null;
