-- ============================================================================
-- Financeiro › Plano de contas
-- ============================================================================
-- Carrega o plano de contas em uso na PecSil (relatórios do sistema atual,
-- 30/09/2026), com os MESMOS códigos — a equipe trabalha por eles — e prepara
-- a manutenção pela plataforma: incluir, editar, excluir e mover uma conta
-- para outro grupo, quando ela assume o próximo código livre da classe de
-- destino (nenhuma outra conta muda de código).
--
-- Tipo gerencial (receita, despesa/custo fixo e variável, investimento,
-- repasse) por conta, como nos relatórios — inclusive as exceções (conta de um
-- grupo com tipo de outro). É o que a análise de custo e margem usa.
--
-- Cinco contas vêm SEM código nos relatórios; entram assim, na raiz. Ao serem
-- movidas para um grupo, ganham o código dele.
-- ============================================================================

do $$ begin
  create type public.finance_management_type as enum
    ('receita', 'despesa_variavel', 'despesa_fixa', 'custo_variavel', 'custo_fixo', 'investimento', 'repasse');
exception when duplicate_object then null; end $$;

alter table public.finance_chart_accounts
  add column if not exists management_type public.finance_management_type not null default 'despesa_variavel';

alter table public.finance_chart_accounts alter column code drop not null;

do $$ begin
  alter table public.finance_chart_accounts
    add constraint finance_chart_accounts_code_format
    check (code is null or code ~ '^\d{2,3}(\.\d{2,3}){0,2}$');
exception when duplicate_object then null; end $$;

create index if not exists idx_finance_chart_accounts_parent on public.finance_chart_accounts(parent_id);

-- --- Permissão --------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('financeiro.plano', 'financeiro', 'Plano de contas', '{ver,operar}', 55)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- Todos do Financeiro leem o plano (classificar um título depende dele);
-- quem mantém é quem tem Plano de contas em operar.
drop policy if exists finance_chart_accounts_read on public.finance_chart_accounts;
create policy finance_chart_accounts_read on public.finance_chart_accounts for select to authenticated
using (organization_id = public.current_organization_id() and public.has_module('financeiro'));

drop policy if exists finance_chart_accounts_admin on public.finance_chart_accounts;
drop policy if exists finance_chart_accounts_manage on public.finance_chart_accounts;
create policy finance_chart_accounts_manage on public.finance_chart_accounts for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('financeiro.plano', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('financeiro.plano', 'operar'));

-- --- Tipo contábil derivado do tipo gerencial ---------------------------------
create or replace function public.finance_chart_derive_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.account_type := case new.management_type
    when 'receita' then 'revenue'
    when 'repasse' then 'transfer'
    when 'investimento' then 'asset'
    else 'expense'
  end::public.finance_account_type;
  return new;
end;
$$;

drop trigger if exists finance_chart_accounts_derive_type on public.finance_chart_accounts;
create trigger finance_chart_accounts_derive_type
before insert or update of management_type on public.finance_chart_accounts
for each row execute function public.finance_chart_derive_type();

-- --- Grupo com subcontas não recebe lançamento --------------------------------
create or replace function public.finance_chart_sync_posting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.parent_id is not null then
    update public.finance_chart_accounts set allows_posting = false
    where id = new.parent_id and allows_posting;
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.parent_id is not null
     and (tg_op = 'DELETE' or old.parent_id is distinct from new.parent_id) then
    update public.finance_chart_accounts p set allows_posting = true
    where p.id = old.parent_id and not p.allows_posting
      and not exists (select 1 from public.finance_chart_accounts c where c.parent_id = p.id);
  end if;
  return null;
end;
$$;
revoke all on function public.finance_chart_sync_posting() from public;

drop trigger if exists finance_chart_accounts_sync_posting on public.finance_chart_accounts;
create trigger finance_chart_accounts_sync_posting
after insert or delete or update of parent_id on public.finance_chart_accounts
for each row execute function public.finance_chart_sync_posting();

-- --- Próximo código livre de um grupo ------------------------------------------
-- Filho de grupo raiz: 2 dígitos (02.20); 3º nível: 3 dígitos (02.01.016);
-- raiz: 2 dígitos (10). Continua do maior número dos irmãos, qualquer que seja
-- a largura com que foram escritos (02.006 e 02.19 convivem no plano).
create or replace function public.finance_next_account_code(p_parent uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  parent_code text;
  depth int := 0;
  width int := 2;
  n int;
  candidate text;
begin
  if p_parent is not null then
    select code into parent_code from public.finance_chart_accounts where id = p_parent and organization_id = org;
    if not found then raise exception 'Grupo de destino não encontrado.'; end if;
    if parent_code is null then
      raise exception 'O grupo de destino ainda não tem código. Dê um código a ele (ou mova-o para um grupo) antes.';
    end if;
    depth := array_length(string_to_array(parent_code, '.'), 1);
    if depth >= 3 then raise exception 'O plano de contas tem no máximo 3 níveis.'; end if;
    width := case when depth = 1 then 2 else 3 end;
  end if;

  select coalesce(max(split_part(code, '.', depth + 1)::int), 0) into n
  from public.finance_chart_accounts
  where organization_id = org and code is not null
    and parent_id is not distinct from p_parent;

  loop
    n := n + 1;
    candidate := coalesce(parent_code || '.', '') || lpad(n::text, greatest(width, length(n::text)), '0');
    exit when not exists (select 1 from public.finance_chart_accounts where organization_id = org and code = candidate);
  end loop;
  return candidate;
end;
$$;
revoke all on function public.finance_next_account_code(uuid) from public;
grant execute on function public.finance_next_account_code(uuid) to authenticated;

-- --- Mover uma conta (com as subcontas) para outro grupo ------------------------
create or replace function public.finance_move_account(p_account uuid, p_parent uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  acc public.finance_chart_accounts%rowtype;
  dest public.finance_chart_accounts%rowtype;
  dest_depth int := 0;
  height int;
  new_code text;
  child record;
  seq int := 0;
  seg text;
begin
  if not public.has_feature('financeiro.plano', 'operar') then
    raise exception 'Sem permissão para alterar o plano de contas.' using errcode = '42501';
  end if;
  select * into acc from public.finance_chart_accounts where id = p_account and organization_id = org;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if p_parent is not distinct from acc.parent_id then return acc.code; end if;

  if p_parent is not null then
    select * into dest from public.finance_chart_accounts where id = p_parent and organization_id = org;
    if not found then raise exception 'Grupo de destino não encontrado.'; end if;
    if p_parent = p_account or exists (
      with recursive sub as (
        select id from public.finance_chart_accounts where parent_id = p_account
        union all
        select c.id from public.finance_chart_accounts c join sub on c.parent_id = sub.id
      ) select 1 from sub where id = p_parent
    ) then
      raise exception 'Uma conta não pode ser movida para dentro dela mesma.';
    end if;
    if dest.code is null then
      raise exception 'O grupo de destino ainda não tem código. Dê um código a ele (ou mova-o para um grupo) antes.';
    end if;
    dest_depth := array_length(string_to_array(dest.code, '.'), 1);
  end if;

  -- Quantos níveis a conta carrega abaixo dela (0 = sem subcontas).
  with recursive sub as (
    select id, 1 as lvl from public.finance_chart_accounts where parent_id = p_account
    union all
    select c.id, sub.lvl + 1 from public.finance_chart_accounts c join sub on c.parent_id = sub.id
  ) select coalesce(max(lvl), 0) into height from sub;
  if dest_depth + 1 + height > 3 then
    raise exception 'Não cabe: o plano de contas tem no máximo 3 níveis.';
  end if;

  new_code := public.finance_next_account_code(p_parent);

  update public.finance_chart_accounts
  set parent_id = p_parent,
      code = new_code,
      management_type = case when p_parent is null then management_type else dest.management_type end
  where id = p_account;

  -- Subcontas acompanham: mesmo final quando já é de 3 dígitos; senão, em sequência.
  perform set_config('pecsil.plano_em_lote', '1', true);
  for child in
    select id, code from public.finance_chart_accounts where parent_id = p_account order by code nulls last, name
  loop
    seq := seq + 1;
    seg := case when child.code is null then null else split_part(child.code, '.', array_length(string_to_array(child.code, '.'), 1)) end;
    update public.finance_chart_accounts
    set code = new_code || '.' || case
          when dest_depth = 0 and seg is not null then seg
          when seg ~ '^\d{3}$' then seg
          else lpad(seq::text, 3, '0') end,
        management_type = case when p_parent is null then management_type else dest.management_type end
    where id = child.id;
  end loop;
  perform set_config('pecsil.plano_em_lote', '', true);

  return new_code;
end;
$$;
revoke all on function public.finance_move_account(uuid, uuid) from public;
grant execute on function public.finance_move_account(uuid, uuid) to authenticated;

-- --- Excluir: só conta sem subcontas e sem uso -----------------------------------
create or replace function public.finance_delete_account(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  usos int;
begin
  if not public.has_feature('financeiro.plano', 'operar') then
    raise exception 'Sem permissão para alterar o plano de contas.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.finance_chart_accounts where id = p_account and organization_id = org) then
    raise exception 'Conta não encontrada.';
  end if;
  if exists (select 1 from public.finance_chart_accounts where parent_id = p_account) then
    raise exception 'Esta conta tem subcontas. Mova ou exclua as subcontas antes.';
  end if;
  select count(*) into usos from public.finance_titles where chart_account_id = p_account;
  if usos > 0 then
    raise exception 'Esta conta já foi usada em % título(s). Em vez de excluir, inative.', usos;
  end if;
  delete from public.finance_chart_accounts where id = p_account;
end;
$$;
revoke all on function public.finance_delete_account(uuid) from public;
grant execute on function public.finance_delete_account(uuid) to authenticated;

-- --- Carga do plano em uso (só em tabela vazia) -----------------------------------
do $$
declare
  org uuid;
begin
  select id into org from public.organizations limit 1;
  if org is null or exists (select 1 from public.finance_chart_accounts where organization_id = org) then
    return;
  end if;

  create temp table plano_carga (ord int, code text, name text, tipo text) on commit drop;
  insert into plano_carga (ord, code, name, tipo) values
  (1, '01', 'RECEITAS', 'receita'),
  (2, '01.01', 'RECEITAS OPERACIONAIS', 'receita'),
  (3, '01.01.001', 'VENDAS DE MOLDES', 'receita'),
  (4, '01.01.002', 'VENDAS DE FUNDIDOS', 'receita'),
  (5, '01.01.003', 'INDUSTRIALIZAÇÃO', 'receita'),
  (6, '01.01.004', 'PRESTAÇÃO DE SERVIÇOS / CONSERTOS', 'receita'),
  (7, '01.01.005', 'OUTRAS RECEITAS OPERACIONAIS', 'receita'),
  (8, '01.01.006', 'REVENDA', 'receita'),
  (9, '01.02', 'RECEITAS NÃO OPERACIONAIS', 'receita'),
  (10, '01.02.001', 'RENDIMENTO APLICAÇÕES / JUROS', 'receita'),
  (11, '01.02.002', 'DESCONTOS', 'receita'),
  (12, '01.02.003', 'EMPRÉSTIMOS', 'receita'),
  (13, '01.02.004', 'EMPRÉSTIMOS CAPITAL DE GIRO', 'receita'),
  (14, '01.02.005', 'ESTORNO BANCÁRIO', 'receita'),
  (15, '01.02.006', 'VENDAS DE SUCATA', 'receita'),
  (16, '01.02.007', 'VENDAS DE VEÍCULOS', 'receita'),
  (17, '01.02.008', 'VENDAS DE MÁQUINAS', 'receita'),
  (18, '01.02.009', 'APORTE SÓCIOS', 'receita'),
  (19, '01.02.010', 'OUTRAS RECEITAS NÃO OPERACIONAIS', 'receita'),
  (20, '01.02.011', 'ACC', 'receita'),
  (21, '01.02.012', 'VENDA DE IMOVEIS', 'receita'),
  (22, '01.03', 'ANULAÇÃO DE VALORES DE SERVIÇO DE TRANSPORTE', 'receita'),
  (23, '02', 'DESPESAS VARIÁVEIS', 'despesa_variavel'),
  (24, '02.006', 'COMISSÃO DE VENDAS', 'despesa_variavel'),
  (25, '02.01', 'DESPESAS BANCÁRIAS / ENCARGOS', 'despesa_variavel'),
  (26, '02.01.001', 'TF. TED / DOC', 'despesa_variavel'),
  (27, '02.01.002', 'TF. FORMULÁRIO CONTÍNUO / TL CHEQUE', 'despesa_variavel'),
  (28, '02.01.003', 'TF. CHEQUE SUPERIOR / INFERIOR', 'despesa_variavel'),
  (29, '02.01.004', 'TF. IOF', 'despesa_variavel'),
  (30, '02.01.005', 'TF. MANUTENÇÃO C/C', 'despesa_variavel'),
  (31, '02.01.006', 'TF. RENOVAÇÃO CONTRATO C/C GARANTIDA', 'despesa_variavel'),
  (32, '02.01.007', 'TF. CÂMBIO IMPORTAÇÃO / EXPORTAÇÃO', 'despesa_variavel'),
  (33, '02.01.008', 'TF. FOLHA DE PAGAMENTO', 'despesa_variavel'),
  (34, '02.01.009', 'TF. COBRANÇA / BOLETOS', 'despesa_variavel'),
  (35, '02.01.010', 'ENCARGOS C/C GARANTIDA', 'despesa_variavel'),
  (36, '02.01.011', 'ENCARGOS CONTRATO ACC', 'despesa_variavel'),
  (37, '02.01.012', 'EMPRÉSTIMOS', 'despesa_variavel'),
  (38, '02.01.013', 'EMPRÉSTIMOS CAPITAL DE GIRO', 'despesa_variavel'),
  (39, '02.01.014', 'OUTRAS TARIFAS', 'despesa_variavel'),
  (40, '02.01.015', 'TF. PIX', 'despesa_variavel'),
  (41, '02.02', 'IMPOSTOS FEDERAIS', 'despesa_variavel'),
  (42, '02.02.001', 'PIS', 'despesa_variavel'),
  (43, '02.02.002', 'COFINS', 'despesa_variavel'),
  (44, '02.02.003', 'CSLL', 'despesa_variavel'),
  (45, '02.02.004', 'I.R.P.J.', 'despesa_variavel'),
  (46, '02.02.005', 'IPI', 'despesa_variavel'),
  (47, '02.02.006', 'INSS DESONERAÇÃO (2,5%)', 'despesa_variavel'),
  (48, '02.02.007', 'I.R.R.F.', 'despesa_variavel'),
  (49, '02.02.008', 'OUTROS IMPOSTOS FEDERAIS', 'despesa_variavel'),
  (50, '02.02.009', 'AUTO DE INFRAÇÃO', 'despesa_variavel'),
  (51, '02.03', 'IMPOSTOS ESTADUAIS', 'despesa_variavel'),
  (52, '02.03.001', 'ICMS', 'despesa_variavel'),
  (53, '02.03.002', 'GARE', 'despesa_variavel'),
  (54, '02.03.003', 'OUTROS IMPOSTOS ESTADUAIS', 'despesa_variavel'),
  (55, '02.04', 'IMPOSTOS MUNICIPAIS / TAXAS', 'despesa_variavel'),
  (56, '02.04.001', 'ISS - DARM', 'despesa_variavel'),
  (57, '02.04.002', 'ISS - VARIÁVEL', 'despesa_variavel'),
  (58, '02.04.003', 'TAXA LICENÇA DE OPERAÇÃO', 'despesa_variavel'),
  (59, '02.04.004', 'OUTROS IMPOSTOS MUNICIPAIS', 'despesa_variavel'),
  (60, '02.05', 'FRETE DE VENDAS', 'despesa_variavel'),
  (61, '02.07', 'MULTAS', 'despesa_variavel'),
  (62, '02.08', 'JUROS ATRASO DE PAGAMENTO', 'despesa_variavel'),
  (63, '02.09', 'DESCONTOS', 'despesa_variavel'),
  (64, '02.10', 'JUROS DE DESCONTO DE DUPLICATAS', 'despesa_variavel'),
  (65, '02.11', 'JUROS FINANCIAMENTOS', 'despesa_variavel'),
  (66, '02.12', 'RETIRADA SÓCIOS', 'despesa_variavel'),
  (67, '02.13', 'REFEIÇÃO', 'despesa_variavel'),
  (68, '02.14', 'CARTÃO CRÉDITO EMPRESARIAL', 'despesa_variavel'),
  (69, '02.15', 'HOSPEDAGEM', 'despesa_variavel'),
  (70, '02.16', 'MERCADO ELETRÔNICO', 'despesa_variavel'),
  (71, '02.17', 'CERTIFICADO DIGITAL', 'despesa_variavel'),
  (72, '02.18', 'EVENTOS CORPORATIVOS', 'despesa_variavel'),
  (73, '02.19', 'ACESSÓRIO P/ REDE DE GÁS E AR COMPRIMIDO', 'despesa_variavel'),
  (74, '03', 'DESPESAS FIXAS', 'despesa_fixa'),
  (75, '03.002', 'PRÓ LABORE SÓCIOS', 'despesa_fixa'),
  (76, '03.003', 'ENERGIA ELÉTRICA (ADM)', 'despesa_fixa'),
  (77, '03.005', 'UNIFORME (ADM)', 'despesa_fixa'),
  (78, '03.01', 'GASTOS COM FUNCIONÁRIOS (ADM)', 'despesa_fixa'),
  (79, '03.01.001', 'SALÁRIOS', 'despesa_fixa'),
  (80, '03.01.002', 'ADIANTAMENTOS', 'despesa_fixa'),
  (81, '03.01.003', '13º SALÁRIO', 'despesa_fixa'),
  (82, '03.01.004', 'FÉRIAS', 'despesa_fixa'),
  (83, '03.01.005', 'RESCISÃO', 'despesa_fixa'),
  (84, '03.01.006', 'CONVÊNIO MÉDICO', 'despesa_fixa'),
  (85, '03.01.007', 'SEGURO DE VIDA', 'despesa_fixa'),
  (86, '03.01.008', 'PENSÃO ALIMENTÍCIA', 'custo_fixo'),
  (87, '03.01.009', 'MEDICAMENTOS', 'despesa_fixa'),
  (88, '03.01.010', 'VALE TRANSPORTE', 'despesa_fixa'),
  (89, '03.01.011', 'MENSALIDADE SINDICAL', 'despesa_fixa'),
  (90, '03.01.012', 'CONTRIBUIÇÃO CONFEDERATIVA', 'despesa_fixa'),
  (91, '03.01.013', 'EXAMES CLÍNICOS PERIÓDICOS / RECISÓRIOS', 'despesa_fixa'),
  (92, '03.01.014', 'CURSOS, TREINAMENTOS E FORMAÇÃO PROF.', 'despesa_fixa'),
  (93, '03.01.015', 'EMPRÉSTIMO CONSIGNADO', 'despesa_fixa'),
  (94, '03.01.016', 'INSS', 'despesa_fixa'),
  (95, '03.01.017', 'FGTS', 'despesa_fixa'),
  (96, '03.01.018', 'I.R. S/ SALÁRIO', 'despesa_fixa'),
  (97, '03.01.019', 'I.R. S/ FÉRIAS', 'despesa_fixa'),
  (98, '03.01.020', 'REFEIÇÃO', 'despesa_fixa'),
  (99, '03.01.021', 'I.R. S/ 13° SALÁRIO', 'despesa_fixa'),
  (100, '03.01.022', 'I.R. S/ ADIANTAMENTO', 'despesa_fixa'),
  (101, '03.01.023', 'I.R. S/ RESCISÃO', 'custo_fixo'),
  (102, '03.01.024', 'CONTRIBUIÇÃO SINDICAL', 'despesa_fixa'),
  (103, '03.01.025', 'PLR', 'custo_fixo'),
  (104, '03.01.026', 'PROCESSO TRABALHISTA', 'despesa_fixa'),
  (105, '03.01.027', 'CUSTAS PROCESSO TRABALHISTA', 'despesa_fixa'),
  (106, '03.01.028', 'ABONO SALARIAL', 'despesa_fixa'),
  (107, '03.01.029', 'CONTRIBUIÇÃO ASSISTENCIAL', 'despesa_fixa'),
  (108, '03.017', 'MANUTENÇÃO PREDIAL', 'despesa_fixa'),
  (109, '03.021', 'PRODUTOS DE LIMPEZA', 'despesa_fixa'),
  (110, '03.022', 'COPA / COZINHA', 'despesa_fixa'),
  (111, '03.04', 'ÁGUA (ADM)', 'despesa_fixa'),
  (112, '03.06', 'MARKETING', 'despesa_fixa'),
  (113, '03.07', 'TELEFONE FIXO', 'despesa_fixa'),
  (114, '03.08', 'INTERNET', 'despesa_fixa'),
  (115, '03.09', 'CELULAR', 'despesa_fixa'),
  (116, '03.10', 'SITE', 'despesa_fixa'),
  (117, '03.11', 'CORREIO', 'despesa_fixa'),
  (118, '03.12', 'CARTÓRIO', 'despesa_fixa'),
  (119, '03.13', 'CONTABILIDADE', 'despesa_fixa'),
  (120, '03.14', 'MANUTENÇÃO DE SISTEMAS (TI)', 'despesa_fixa'),
  (121, '03.15', 'SOFTWARE', 'despesa_fixa'),
  (122, '03.16', 'ACESSORIA JURÍDICA / ADVOGADOS', 'despesa_fixa'),
  (123, '03.18', 'SISTEMA DE SEGURANÇA PATRIMONIAL', 'despesa_fixa'),
  (124, '03.19', 'MATERIAIS DE INFORMÁTICA', 'despesa_fixa'),
  (125, '03.20', 'MATERIAL ESCRITÓRIO', 'despesa_fixa'),
  (126, '03.23', 'IPTU', 'despesa_fixa'),
  (127, '03.24', 'SEGURO EMPRESARIAL', 'despesa_fixa'),
  (128, '03.25', 'SEGURO MÁQUINAS', 'despesa_fixa'),
  (129, '03.26', 'CONSULTORIA', 'despesa_fixa'),
  (130, '03.27', 'ALUGUEL (ADM)', 'despesa_fixa'),
  (131, '03.28', 'ÁGUA MINERAL', 'despesa_fixa'),
  (132, '03.29', 'CETESB / IBAMA', 'despesa_fixa'),
  (133, '03.30', 'ISO/AUDITORIAS', 'despesa_fixa'),
  (134, '03.31', 'I.R. S/ PRO-LABORE', 'despesa_fixa'),
  (135, '03.32', 'AGUA GALPÃO 250', 'despesa_fixa'),
  (136, '04', 'CUSTOS VARIÁVEIS', 'custo_variavel'),
  (137, '04.01', 'MATÉRIA PRIMA USINAGEM', 'custo_variavel'),
  (138, '04.01.001', 'AÇO', 'custo_variavel'),
  (139, '04.01.002', 'FERRO FUNDIDO', 'custo_variavel'),
  (140, '04.01.003', 'BRONZE', 'custo_variavel'),
  (141, '04.01.004', 'PÓ PARA METALIZAÇÃO', 'custo_variavel'),
  (142, '04.01.005', 'OXIGÊNIO / ACETILENO', 'custo_variavel'),
  (143, '04.01.006', 'FIXADORES', 'custo_variavel'),
  (144, '04.01.007', 'AÇO INOX', 'custo_variavel'),
  (145, '04.01.008', 'COBRE', 'custo_variavel'),
  (146, '04.01.009', 'DAMERON', 'custo_variavel'),
  (147, '04.01.010', 'POLÍMEROS', 'custo_variavel'),
  (148, '04.01.011', 'FINIMP FINACIAMENTO MATERIA PRIMA IMPORTAÇÃO', 'custo_variavel'),
  (149, '04.02', 'MATÉRIA PRIMA FUNDIÇÃO', 'custo_variavel'),
  (150, '04.02.001', 'SUCATA DE FERRO', 'custo_variavel'),
  (151, '04.02.002', 'SUCATA DE BRONZE', 'custo_variavel'),
  (152, '04.02.003', 'SUCATA DE AÇO', 'custo_variavel'),
  (153, '04.02.004', 'FERRO GUSA', 'custo_variavel'),
  (154, '04.02.005', 'LIGAS', 'custo_variavel'),
  (155, '04.02.006', 'SUCATA DAMERON', 'custo_variavel'),
  (156, '04.02.007', 'SUCATA DE AÇO INOX', 'custo_variavel'),
  (157, '04.03', 'SERVIÇOS TERCEIRIZADOS', 'custo_variavel'),
  (158, '04.03.001', 'PROCESSOS JUDICIAIS', 'custo_variavel'),
  (159, '04.03.002', 'RENOVAÇÃO LICENÇA CETESB', 'custo_variavel'),
  (160, '04.03.003', 'RENOVAÇÃO LICENÇA CORPO BOMBEIROS', 'custo_variavel'),
  (161, '04.03.004', 'RECARGA EXTINTORES / EQUIP. PREV. INCÊNCIO', 'custo_variavel'),
  (162, '04.03.005', 'GRAVAÇÃO MOLDES', 'custo_variavel'),
  (163, '04.03.006', 'METALIZAÇÃO', 'custo_variavel'),
  (164, '04.03.007', 'POLIMENTO', 'custo_variavel'),
  (165, '04.03.009', 'TRATAMENTO TÉRMICO', 'custo_variavel'),
  (166, '04.03.010', 'REMOÇÃO DE AREIA', 'custo_variavel'),
  (167, '04.03.011', 'MANUTENÇÃO / CONSERTO MÁQUINAS USINAGEM', 'custo_variavel'),
  (168, '04.03.012', 'MANUTENÇÃO / CONSERTO MÁQUINAS FUNDIÇÃO', 'custo_variavel'),
  (169, '04.03.013', 'DESPESAS DE HOSPEDAGEM', 'custo_variavel'),
  (170, '04.03.014', 'ANÁLISE ÁGUA / AREIA FUNDIÇÃO', 'custo_variavel'),
  (171, '04.03.015', 'LOCAÇÃO DE MÁQUINAS  / EQUIPAMENTOS', 'custo_variavel'),
  (172, '04.03.016', 'DESPESAS IMPORTAÇÃO', 'custo_variavel'),
  (173, '04.03.017', 'DESPESAS EXPORTAÇÃO', 'custo_variavel'),
  (174, '04.03.018', 'MODELO MADEIRA FUNDIÇÃO', 'custo_variavel'),
  (175, '04.03.019', 'DESPESAS DE VIAGEM', 'custo_variavel'),
  (176, '04.03.020', 'DESPESAS COM REFEIÇÕES', 'custo_variavel'),
  (177, '04.03.021', 'DESPESAS CARTÃO DE CRÉDITO', 'custo_variavel'),
  (178, '04.03.022', 'LOCAÇÃO DIVERSAS', 'custo_variavel'),
  (179, '04.03.023', 'TRANSPORTE', 'custo_variavel'),
  (180, '04.03.024', 'ENSAIOS NÃO DESTRUTIVOS', 'custo_variavel'),
  (181, '04.03.025', 'GUINDASTE / MUNCK', 'custo_variavel'),
  (182, '04.03.026', 'AFIAÇÃO DE FERRAMENTAS', 'custo_variavel'),
  (183, '04.03.027', 'CALIBRAÇÃO DE INSTRUMENTOS', 'custo_variavel'),
  (184, '04.03.028', 'USINAGEM', 'custo_variavel'),
  (185, '04.03.029', 'RENOVAÇÃO PPRA/PCMSO', 'custo_variavel'),
  (186, '04.03.030', 'ARMAZENAGEM', 'custo_variavel'),
  (187, '04.03.031', 'CORTE A LASER', 'custo_variavel'),
  (188, '04.03.032', 'ASSESSORIA CADRI', 'custo_variavel'),
  (189, '04.03.033', 'PROCESSAMENTO DE PÓ', 'custo_variavel'),
  (190, '04.03.034', 'TRATAMENTO OLEO RESIDUO', 'custo_fixo'),
  (191, '04.03.035', 'FUMIGAÇÃO', 'custo_variavel'),
  (192, '04.03.036', 'DEDETIZAÇÃO', 'custo_fixo'),
  (193, '04.03.037', 'JATEAMENTO', 'despesa_variavel'),
  (194, '04.03.038', 'CORTE FENDA E ROSCA', 'custo_variavel'),
  (195, '04.03.039', 'REBARBAÇÃO', 'custo_variavel'),
  (196, '04.03.040', 'MANUTENÇÃO GERAL/UTENSILIOS', 'custo_variavel'),
  (197, '04.03.041', 'MANUTENÇÃO COMPRESSORES', 'custo_variavel'),
  (198, '04.03.042', 'SERVIÇOS DE FUNDIÇÃO', 'custo_variavel'),
  (199, '04.04', 'EMBALAGEM', 'custo_variavel'),
  (200, '04.05', 'BRINDES', 'custo_variavel'),
  (201, '05', 'CUSTOS FIXOS', 'custo_fixo'),
  (202, '05.003', 'ÁGUA PRODUÇÃO', 'custo_fixo'),
  (203, '05.004', 'ENERGIA ELÉTRICA PRODUÇÃO', 'custo_fixo'),
  (204, '05.006', 'EPI', 'custo_fixo'),
  (205, '05.008', 'INSUMOS PRODUÇÃO USINAGEM', 'custo_fixo'),
  (206, '05.009', 'INSUMOS PRODUÇÃO FUNDIÇÃO', 'custo_fixo'),
  (207, '05.01', 'GASTOS COM FUNCIONÁRIOS USINAGEM', 'custo_fixo'),
  (208, '05.01.001', 'SALÁRIOS', 'custo_fixo'),
  (209, '05.01.002', 'ADIANTAMENTOS', 'custo_fixo'),
  (210, '05.01.003', '13º SALÁRIO', 'custo_fixo'),
  (211, '05.01.004', 'FÉRIAS', 'custo_fixo'),
  (212, '05.01.005', 'RESCISÃO', 'custo_fixo'),
  (213, '05.01.006', 'CONVÊNIO MÉDICO', 'custo_fixo'),
  (214, '05.01.007', 'SEGURO VIDA', 'custo_fixo'),
  (215, '05.01.008', 'PENSÃO ALIMENTÍCIA', 'custo_fixo'),
  (216, '05.01.009', 'MEDICAMENTOS', 'custo_fixo'),
  (217, '05.01.010', 'VALE TRANSPORTE', 'custo_fixo'),
  (218, '05.01.011', 'MENSALIDADE SINDICAL', 'custo_fixo'),
  (219, '05.01.012', 'CONTRIBUIÇÃO SINDICAL', 'custo_fixo'),
  (220, '05.01.013', 'CONTRIBUIÇÃO CONFEDERATIVA', 'custo_fixo'),
  (221, '05.01.014', 'EXAMES CLÍNICOS PERIÓDICOS / RECISÓRIOS', 'custo_fixo'),
  (222, '05.01.015', 'CURSOS, TREINAMENTOS E FORMAÇÃO PROFISSIONAL', 'custo_fixo'),
  (223, '05.01.016', 'EMPRÉSTIMO CONSIGNADO', 'custo_fixo'),
  (224, '05.01.017', 'INSS', 'custo_fixo'),
  (225, '05.01.018', 'FGTS', 'custo_fixo'),
  (226, '05.01.019', 'I.R. S/ SALÁRIO', 'custo_fixo'),
  (227, '05.01.020', 'I.R. S/ FÉRIAS', 'custo_fixo'),
  (228, '05.01.021', 'REFEIÇÃO', 'custo_fixo'),
  (229, '05.01.022', 'I.R. S/ 13° SALÁRIO', 'custo_fixo'),
  (230, '05.01.023', 'I.R. S/ ADIANTAMENTO', 'custo_fixo'),
  (231, '05.01.024', 'PLR', 'custo_fixo'),
  (232, '05.01.025', 'I.R. S/ RESCISÃO', 'custo_fixo'),
  (233, '05.01.026', 'CONTRIBUIÇÃO ASSISTENCIAL', 'custo_fixo'),
  (234, '05.01.027', 'PROCESSO TRABALHISTA', 'custo_fixo'),
  (235, '05.01.028', 'CUSTAS PROCESSO TRABALHISTA', 'custo_fixo'),
  (236, '05.01.029', 'UNIFORME', 'custo_fixo'),
  (237, '05.01.030', 'ABONO SALARIAL', 'custo_fixo'),
  (238, '05.01.031', 'CONTRIBUIÇÃO ASSISTENCIAL', 'custo_fixo'),
  (239, '05.010', 'FERRAMENTAS DE CORTE', 'custo_fixo'),
  (240, '05.011', 'FERRAMENTAS MANUAIS', 'custo_fixo'),
  (241, '05.012', 'ÓLEOS E LUBRIFICANTES', 'custo_fixo'),
  (242, '05.02', 'GASTOS COM FUNCIONÁRIOS FUNDIÇÃO', 'custo_fixo'),
  (243, '05.02.001', 'SALÁRIOS', 'custo_fixo'),
  (244, '05.02.002', 'ADIANTAMENTOS', 'custo_fixo'),
  (245, '05.02.003', '13º SALÁRIO', 'custo_fixo'),
  (246, '05.02.004', 'FÉRIAS', 'custo_fixo'),
  (247, '05.02.005', 'RESCISÃO', 'custo_fixo'),
  (248, '05.02.006', 'CONVÊNIO MÉDICO', 'custo_fixo'),
  (249, '05.02.007', 'SEGURO VIDA', 'custo_fixo'),
  (250, '05.02.008', 'PENSÃO ALIMENTÍCIA', 'custo_fixo'),
  (251, '05.02.009', 'MEDICAMENTOS', 'custo_fixo'),
  (252, '05.02.010', 'VALE TRANSPORTE', 'custo_fixo'),
  (253, '05.02.011', 'MENSALIDADE SINDICAL', 'custo_fixo'),
  (254, '05.02.012', 'CONTRIBUIÇÃO SINDICAL', 'custo_fixo'),
  (255, '05.02.013', 'CONTRIBUIÇÃO CONFEDERATIVA', 'custo_fixo'),
  (256, '05.02.014', 'EXAMES CLÍNICOS PERIÓDICOS / RECISÓRIOS', 'custo_fixo'),
  (257, '05.02.015', 'CURSOS, TREINAMENTOS E FORMAÇÃO PROFISSIONAL', 'custo_fixo'),
  (258, '05.02.016', 'EMPRÉSTIMO CONSIGNADO', 'custo_fixo'),
  (259, '05.02.017', 'INSS', 'custo_fixo'),
  (260, '05.02.018', 'FGTS', 'custo_fixo'),
  (261, '05.02.019', 'I.R. S/ SALÁRIOS', 'custo_fixo'),
  (262, '05.02.020', 'I.R. S/S FÉRIAS', 'custo_fixo'),
  (263, '05.02.021', 'REFEIÇÃO', 'custo_fixo'),
  (264, '05.02.022', 'I.R. S/ 13° SALÁRIO', 'custo_fixo'),
  (265, '05.02.023', 'I.R. S/ ADIANTAMENTO', 'custo_fixo'),
  (266, '05.02.024', 'I.R. S/ RESCISÃO', 'custo_fixo'),
  (267, '05.02.025', 'PROCESSO TRABALHISTA', 'custo_fixo'),
  (268, '05.02.026', 'CUSTAS PROCESSO TRABALHISTA', 'custo_fixo'),
  (269, '05.02.027', 'ABONO SALARIAL', 'custo_fixo'),
  (270, '05.02.028', 'CONTRIBUIÇÃO ASSISTENCIAL', 'custo_fixo'),
  (271, '05.05', 'ALUGUEL PRODUÇÃO', 'custo_fixo'),
  (272, '05.07', 'UNIFORMES PRODUÇÃO', 'custo_fixo'),
  (273, '05.13', 'GASTOS COM VEÍCULOS PRODUÇÃO', 'custo_fixo'),
  (274, '05.13.001', 'COMBUSTÍVEL', 'custo_fixo'),
  (275, '05.13.002', 'MÃO DE OBRA MANUTENÇÃO / CONSERTO', 'custo_fixo'),
  (276, '05.13.003', 'PEÇAS MANUTENÇÃO / CONSERTO', 'custo_fixo'),
  (277, '05.13.004', 'SEGUROS', 'custo_fixo'),
  (278, '05.13.005', 'DPVAT', 'custo_fixo'),
  (279, '05.13.006', 'TAXA LICENCIAMENTO', 'custo_fixo'),
  (280, '05.13.007', 'IPVA', 'custo_fixo'),
  (281, '05.13.008', 'PEDÁGIO', 'custo_fixo'),
  (282, '05.13.009', 'MULTAS VEÍCULOS', 'custo_fixo'),
  (283, '05.13.010', 'ESTACIONAMENTO', 'custo_fixo'),
  (284, '05.13.011', 'ACESSORIOS VEÍCULOS', 'custo_fixo'),
  (285, '05.13.012', 'DESPESAS E TAXAS COM TAGOGRAFO', 'custo_fixo'),
  (286, '05.14', 'ENERGIA ELETRICA GALPÃO 250', 'custo_fixo'),
  (287, '06', 'INVESTIMENTOS', 'investimento'),
  (288, '06.001', 'FINAME MÁQUINAS', 'investimento'),
  (289, '06.002', 'PROGER MÁQUINAS', 'investimento'),
  (290, '06.003', 'FINANCIAMENTO VEÍCULOS', 'investimento'),
  (291, '06.007', 'MÓVEIS E UTENSÍLIOS', 'investimento'),
  (292, '06.04', 'FINANCIAMENTO IMÓVEIS', 'investimento'),
  (293, '06.05', 'CARTÃO BNDES', 'investimento'),
  (294, '06.06', 'MÁQUINAS E EQUIPAMENTOS', 'investimento'),
  (295, '06.08', 'LEASING MÁQUINAS', 'custo_fixo'),
  (296, '06.09', 'APLICAÇÕES', 'investimento'),
  (297, '06.10', 'TÍTULO CAPITALIZAÇÃO', 'investimento'),
  (298, '06.11', 'AMPLIAÇÃO OBRA', 'investimento'),
  (299, '06.12', 'FINIMP MAQUINAS', 'investimento'),
  (300, '06.13', 'CDC MAQUINAS / EQUIPAMENTOS', 'investimento'),
  (301, '06.14', 'CONSÓRCIO', 'investimento'),
  (302, '07', 'OUTROS MOVIMENTOS FINANCEIROS DESEMBOLSO', 'repasse'),
  (303, '07.001', 'RECEBIMENTO DE MATERIAL CLIENTE', 'repasse'),
  (304, '07.002', 'RETORNO DE MERCADORIAS', 'repasse'),
  (305, '08', 'OUTROS MOVIMENTOS FINANCEIROS RECEBIMENTO', 'repasse'),
  (306, '08.01', 'REMESSA DE MERCADORIAS PARA TESTES OU BENEFICIAMENTO', 'repasse'),
  (307, '08.02', 'DEVOLUÇÃO DE MERCADORIAS DE CLIENTES E COMPRAS', 'repasse'),
  (308, '08.03', 'CREDITO ATIVO IMOBILIZADO', 'receita'),
  (309, '08.04', 'COMPRAS P/INDUSTRIALIZAÇAO CREDITO ICMS', 'receita'),
  (310, '08.05', 'MATERIAL DEMONSTRAÇÃO', 'repasse'),
  (311, '08.07', 'UNIFORMES / OUTRAS', 'repasse'),
  (312, '08.08', 'COMPRAS DE PRODUÇÃO RURAL', 'repasse'),
  (313, '09', 'ALUMÍNIO', 'custo_variavel'),
  (314, null, 'ENCARGOS FIMINP', 'despesa_variavel'),
  (315, null, 'CONTRIBUIÇÃO ASSISTENCIAL', 'despesa_variavel'),
  (316, null, 'ACORDO PROCESSO', 'despesa_variavel'),
  (317, null, 'ACORDO PROCESSO', 'despesa_variavel'),
  (318, null, 'CUSTAS ACORDO', 'despesa_variavel');

  insert into public.finance_chart_accounts (organization_id, code, name, management_type, account_type, allows_posting, created_at)
  select org, code, name, tipo::public.finance_management_type, 'expense', true, now() + (ord || ' microseconds')::interval
  from plano_carga order by ord;

  -- O grupo de cada conta é o código sem o último trecho (02.01.001 → 02.01).
  update public.finance_chart_accounts c
  set parent_id = p.id
  from public.finance_chart_accounts p
  where c.organization_id = org and p.organization_id = org
    and c.code like '%.%'
    and p.code = regexp_replace(c.code, '\.[^.]+$', '');
end $$;

-- --- Trilha de eventos (criada depois da carga: a carga não vira 318 eventos) ------
create or replace function public.events_financeiro_conta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rotulo text;
begin
  if current_setting('pecsil.plano_em_lote', true) = '1' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.conta.criada', 'conta', new.id::text,
      format('Conta criada · %s %s', coalesce(new.code, '(sem código)'), new.name),
      jsonb_build_object('codigo', new.code, 'tipo', new.management_type));
  elsif tg_op = 'DELETE' then
    perform public.emit_module_event(old.organization_id, 'financeiro', 'financeiro.conta.excluida', 'conta', old.id::text,
      format('Conta excluída · %s %s', coalesce(old.code, '(sem código)'), old.name),
      jsonb_build_object('codigo', old.code));
  elsif new.parent_id is distinct from old.parent_id then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.conta.movida', 'conta', new.id::text,
      format('Conta movida · %s · de %s para %s', new.name, coalesce(old.code, '(sem código)'), coalesce(new.code, '(sem código)')),
      jsonb_build_object('de', old.code, 'para', new.code));
  elsif new.name is distinct from old.name or new.code is distinct from old.code
     or new.active is distinct from old.active or new.management_type is distinct from old.management_type then
    rotulo := case when new.active is distinct from old.active then case when new.active then 'reativada' else 'inativada' end else 'alterada' end;
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.conta.alterada', 'conta', new.id::text,
      format('Conta %s · %s %s', rotulo, coalesce(new.code, '(sem código)'), new.name),
      jsonb_build_object('codigo', new.code, 'antes', jsonb_build_object('codigo', old.code, 'nome', old.name, 'tipo', old.management_type, 'ativa', old.active)));
  end if;
  return null;
end;
$$;
revoke all on function public.events_financeiro_conta() from public;

drop trigger if exists finance_chart_accounts_events on public.finance_chart_accounts;
create trigger finance_chart_accounts_events
after insert or update or delete on public.finance_chart_accounts
for each row execute function public.events_financeiro_conta();
