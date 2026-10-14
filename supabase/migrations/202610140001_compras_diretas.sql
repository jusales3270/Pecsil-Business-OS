-- Compras diretas e "Cotação nº / OC nº" pela fase (14/10/2026, pedido do proprietário).
--
-- 1. Nome pela fase: até a aprovação do Ricardo é "Cotação nº N"; aprovada, é "OC nº N" (o
--    número é o mesmo — o da cotação — do começo ao fim).
-- 2. Compra direta: compra sem cotação, que nasce aprovada (o Ricardo autorizou fora da
--    plataforma) e ganha o número da mesma sequência (OC nº N). Dois caminhos:
--    A. a nota chegou: o Henrique lança "Nota sem pedido" com "É compra direta" marcado e a OC
--       nasce já comprada e recebida, ligada à nota (conta a pagar e Painel do ICMS como hoje);
--    B. o Ricardo pediu ao Compras: a Kaylane registra a compra direta, a OC sai na hora para o
--       fornecedor, vira previsão a pagar e vai para "A caminho"; o Henrique recebe contra ela.

alter table public.cotacoes
  add column if not exists origem text not null default 'cotacao',
  add column if not exists autorizado_por text,
  add column if not exists receipt_id uuid references public.receipts(id) on delete set null;
alter table public.cotacoes drop constraint if exists cotacoes_origem_check;
alter table public.cotacoes add constraint cotacoes_origem_check check (origem in ('cotacao', 'direta'));
alter table public.cotacoes drop constraint if exists cotacoes_autorizado_por_tamanho;
alter table public.cotacoes add constraint cotacoes_autorizado_por_tamanho check (autorizado_por is null or char_length(autorizado_por) <= 120);
create index if not exists idx_cotacoes_diretas on public.cotacoes (organization_id, created_at desc) where origem = 'direta';

-- A origem "direta" só é marcada pelas funções abaixo (que conferem a permissão).
create or replace function public.cotacoes_protege_origem()
returns trigger
language plpgsql
as $$
begin
  if current_setting('pecsil.compra_direta', true) is distinct from 'on' then
    if tg_op = 'INSERT' and new.origem <> 'cotacao' then
      raise exception 'Compra direta se registra pelo Compras (Compras diretas) ou pelo recebimento da nota.' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.origem is distinct from old.origem or new.receipt_id is distinct from old.receipt_id) then
      raise exception 'A origem da compra não muda.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists cotacoes_origem on public.cotacoes;
create trigger cotacoes_origem before insert or update on public.cotacoes for each row execute function public.cotacoes_protege_origem();

-- --- Nome pela fase nos eventos ------------------------------------------------------------------
create or replace function public.events_compras_cotacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.origem = 'direta' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.direta.registrada', 'cotacao', new.id::text,
        format('OC nº %s · compra direta · %s', new.id, coalesce(new.fornecedor, 'fornecedor não informado')),
        jsonb_build_object('fornecedor', new.fornecedor, 'divisao', new.divisao, 'autorizado_por', new.autorizado_por, 'pela_nota', new.receipt_id is not null));
    else
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.criada', 'cotacao', new.id::text,
        format('Cotação nº %s lançada · %s', new.id, coalesce(new.fornecedor, 'fornecedor não informado')),
        jsonb_build_object('fornecedor', new.fornecedor, 'divisao', new.divisao));
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'APROVADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.aprovada', 'cotacao', new.id::text,
        format('Cotação nº %s aprovada: agora é a OC nº %s · %s', new.id, new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'aprovado_por', new.aprovado_por, 'de', old.status));
    elsif new.status = 'REJEITADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.rejeitada', 'cotacao', new.id::text,
        format('Cotação nº %s rejeitada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'motivo', new.motivo_rejeicao, 'de', old.status));
    elsif new.status = 'COMPRADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.comprada', 'cotacao', new.id::text,
        format('OC nº %s comprada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'de', old.status));
    elsif new.status = 'PENDENTE' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.reaberta', 'cotacao', new.id::text,
        format('Cotação nº %s voltou para aprovação · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'de', old.status));
    end if;
  end if;
  return new;
end;
$$;

-- --- Previsão a pagar: "OC nº N"; compra direta já recebida não ganha previsão --------------------
create or replace function public.trg_compra_previsao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cot public.cotacoes%rowtype;
  total numeric(18,2);
  primeira date;
  dias int;
  vence date;
  conta uuid;
  previsao uuid;
  parcela uuid;
begin
  -- Compra direta registrada junto com o recebimento da nota: a conta a pagar real nasce no mesmo
  -- recebimento, então não há previsão (seria duplicada).
  if current_setting('pecsil.compra_direta_recebida', true) = 'on' then return new; end if;
  select * into cot from public.cotacoes where id = new.cotacao_id;
  if cot.id is null then return new; end if;
  -- Itens gravados em paralelo: um de cada vez por cotação.
  perform pg_advisory_xact_lock(hashtextextended('compra-previsao:' || cot.ref_id::text, 0));

  select coalesce(sum(k.total), 0), min(k.data_compra) into total, primeira from public.compras k where k.cotacao_id = cot.id;
  if total <= 0 then return new; end if;

  select id into previsao from public.finance_titles
   where organization_id = cot.organization_id and source_module = 'compras' and source_entity_id = cot.ref_id and is_forecast
   order by created_at limit 1 for update;

  if previsao is null then
    -- Prazo do fornecedor ("30", "28 dias", "30/60/90"): o primeiro número; sem prazo, 30 dias.
    select nullif(substring(s.payment_terms from '\d+'), '')::int into dias from public.suppliers s where s.id = cot.supplier_id;
    vence := coalesce(primeira, current_date) + coalesce(dias, 30);
    conta := public.finance_suggest_account(cot.organization_id, cot.supplier_id, cot.fornecedor);
    insert into public.finance_titles (
      organization_id, direction, counterparty_name, supplier_id, description, notes, issue_date, competence_date,
      original_amount, chart_account_id, cost_center_id, status, approved_at, source_module, source_entity_id,
      is_forecast, needs_review, review_reason
    ) values (
      cot.organization_id, 'payable', cot.fornecedor, cot.supplier_id,
      format('%s · OC nº %s (previsão até a nota chegar)', case when cot.origem = 'direta' then 'Compra direta' else 'Compra' end, cot.id),
      'Gerada pelo aviso de compra. Vira conta a pagar quando o Almoxarifado lançar a nota.',
      coalesce(primeira, current_date), coalesce(primeira, current_date), total, conta, cot.cost_center_id,
      'approved', now(), 'compras', cot.ref_id, true, conta is null,
      case when conta is null then 'Conta do plano a definir: fornecedor sem histórico' end
    ) returning id into previsao;
    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (cot.organization_id, previsao, 1, vence, total, 0, 'pending');
    if conta is not null then
      insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
      values (cot.organization_id, previsao, conta, total);
    end if;
    perform public.notify_feature(cot.organization_id, 'financeiro.pagar', 'aprovar', 'financeiro', 'info',
      format('%s · %s', case when cot.origem = 'direta' then 'Compra direta' else 'Compra aprovada' end, cot.fornecedor),
      format('R$ %s previstos para %s (OC nº %s). Vira conta a pagar quando a nota chegar.', public.brl(total), to_char(vence, 'DD/MM/YYYY'), cot.id),
      '/?module=financeiro&secao=Contas%20a%20pagar');
    -- Compra sem pedido do almoxarifado: quem recebe material também precisa saber.
    if cot.material_request_id is null then
      perform public.notify_feature(cot.organization_id, 'almoxarifado.recebimento', 'operar', 'almoxarifado', 'info',
        format('Material comprado · %s', cot.fornecedor),
        format('OC nº %s comprada%s. Confira o material e lance a nota quando chegar.', cot.id, case when cot.origem = 'direta' then ' (compra direta)' else '' end),
        '/?module=almoxarifado&secao=A%20caminho');
    end if;
  else
    update public.finance_titles set original_amount = total, updated_at = now() where id = previsao and original_amount <> total;
    select id into parcela from public.finance_installments where title_id = previsao order by installment_number limit 1;
    update public.finance_installments set amount = total where id = parcela and settled_amount = 0 and amount <> total;
    update public.finance_title_allocations set amount = total where title_id = previsao and amount <> total
      and (select count(*) from public.finance_title_allocations where title_id = previsao) = 1;
  end if;

  perform public.almoxarifado_atualizar_solicitacao(cot.material_request_id);
  return new;
end;
$$;

-- --- Caminho B: o Compras registra a compra direta --------------------------------------------------
-- p: {fornecedor, divisao, autorizado_por, data_compra?, frete_tipo?, frete_valor?, seguro_valor?,
--     outras_despesas?, prazo_entrega?, observacao?, itens: [{produto, quantidade, unidade, valor_unit, icms?, ipi?, prazo?, obs?}]}
create or replace function public.compras_direta_registrar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  cot public.cotacoes%rowtype;
  item jsonb;
  fornecedor text := nullif(btrim(coalesce(p ->> 'fornecedor', '')), '');
  autorizado text := nullif(btrim(coalesce(p ->> 'autorizado_por', '')), '');
  quando date := coalesce(nullif(p ->> 'data_compra', '')::date, current_date);
  qtd numeric;
  vu numeric;
  n int := 0;
begin
  if org is null or not (public.has_feature('compras.cotacoes', 'operar') or public.has_feature('compras.realizadas', 'operar')) then
    raise exception 'Sem permissão para registrar compra direta.' using errcode = '42501';
  end if;
  if fornecedor is null then raise exception 'Informe o fornecedor.'; end if;
  if autorizado is null then raise exception 'Informe quem autorizou a compra direta.'; end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]'::jsonb)) = 0 then raise exception 'Inclua ao menos um item.'; end if;

  perform set_config('pecsil.compra_direta', 'on', true);
  insert into public.cotacoes (organization_id, fornecedor, divisao, status, user_id, aprovado_por, data_decisao, origem, autorizado_por,
    frete_tipo, frete_valor, seguro_valor, outras_despesas, prazo_entrega, observacao)
  values (org, left(fornecedor, 200), case when p ->> 'divisao' = 'FUNDICAO' then 'FUNDICAO' else 'USINAGEM' end, 'COMPRADO', '1',
    left(autorizado, 120), now(), 'direta', left(autorizado, 120),
    case when p ->> 'frete_tipo' in ('CIF', 'FOB', 'SEM') then p ->> 'frete_tipo' else 'CIF' end,
    greatest(coalesce((p ->> 'frete_valor')::numeric, 0), 0), greatest(coalesce((p ->> 'seguro_valor')::numeric, 0), 0),
    greatest(coalesce((p ->> 'outras_despesas')::numeric, 0), 0), nullif(p ->> 'prazo_entrega', '')::date,
    nullif(left(btrim(coalesce(p ->> 'observacao', '')), 2000), ''))
  returning * into cot;
  perform set_config('pecsil.compra_direta', 'off', true);

  for item in select * from jsonb_array_elements(p -> 'itens') loop
    n := n + 1;
    qtd := coalesce((item ->> 'quantidade')::numeric, 0);
    vu := coalesce((item ->> 'valor_unit')::numeric, 0);
    if nullif(btrim(coalesce(item ->> 'produto', '')), '') is null or qtd <= 0 or vu < 0 then
      raise exception 'Item %: informe o produto, a quantidade e o valor.', n;
    end if;
    insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status)
    values (cot.id, left(btrim(item ->> 'produto'), 300), vu, qtd, coalesce(nullif(upper(btrim(item ->> 'unidade')), ''), 'UN'),
      coalesce((item ->> 'icms')::numeric, 0), coalesce((item ->> 'ipi')::numeric, 0), coalesce(item ->> 'prazo', ''), nullif(item ->> 'obs', ''), 'APROVADO');
    -- A compra registrada gera a previsão a pagar e põe a OC em "A caminho" (gatilho atual).
    insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, data_compra, obs)
    values (org, cot.id, cot.fornecedor, left(btrim(item ->> 'produto'), 300), qtd, coalesce(nullif(upper(btrim(item ->> 'unidade')), ''), 'UN'),
      vu, round(qtd * vu, 2), quando, 'Compra direta');
  end loop;

  perform public.notify_feature(org, 'compras.aprovacoes', 'aprovar', 'compras', 'info',
    format('Compra direta · OC nº %s · %s', cot.id, cot.fornecedor),
    format('Registrada no Compras, autorizada por %s.', autorizado), '/?module=compras&secao=diretas', me);
  return jsonb_build_object('id', cot.id);
end;
$$;
revoke all on function public.compras_direta_registrar(jsonb) from public, anon;
grant execute on function public.compras_direta_registrar(jsonb) to authenticated;

-- --- Caminho A: o recebimento da nota sem pedido gera a compra direta -----------------------------
-- Novos campos em p: compra_direta (bool), autorizado_por (texto). O resto é a versão em vigor
-- (202610130002_notas_de_servico.sql), com o nome "OC nº" e a compra direta.
create or replace function public.almoxarifado_confirmar_recebimento(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  cot public.cotacoes%rowtype;
  req public.material_requests%rowtype;
  rec public.receipts%rowtype;
  valor numeric(18,2) := round(coalesce((p ->> 'valor_total')::numeric, 0), 2);
  nf text := nullif(trim(coalesce(p ->> 'nf_numero', '')), '');
  chave text := nullif(regexp_replace(coalesce(p ->> 'nf_chave', ''), '\D', '', 'g'), '');
  fornecedor text;
  emissao date := nullif(p ->> 'emissao', '')::date;
  recebido date := coalesce(nullif(p ->> 'recebido_em', '')::date, current_date);
  divergente boolean := coalesce((p ->> 'divergencia')::boolean, false);
  encerra boolean := coalesce((p ->> 'encerra_pedido')::boolean, true);
  direta boolean := coalesce((p ->> 'compra_direta')::boolean, false) and nullif(p ->> 'cotacao_id', '') is null;
  autorizado text := nullif(left(btrim(coalesce(p ->> 'autorizado_por', '')), 120), '');
  previsao public.finance_titles%rowtype;
  previsao_vence date;
  conta uuid;
  titulo uuid;
  entrada uuid;
  dup jsonb;
  item jsonb;
  n int := 0;
  soma_dups numeric(18,2);
  motivos text[] := '{}';
  divisao text;
  primeiro_venc date;
  qtd numeric;
  total_item numeric;
begin
  if org is null or not public.has_feature('almoxarifado.recebimento', 'operar') then
    raise exception 'Sem permissão para lançar recebimento.' using errcode = '42501';
  end if;
  if nf is null then raise exception 'Informe o número da nota fiscal.'; end if;
  if valor <= 0 then raise exception 'Informe o valor total da nota.'; end if;
  -- 44 dígitos (NF-e, produto) ou 50 (NFS-e nacional, serviço). NFS-e municipal vem sem chave.
  if chave is not null and chave !~ '^(\d{44}|\d{50})$' then raise exception 'A chave de acesso tem 44 dígitos (NF-e) ou 50 (NFS-e nacional).'; end if;
  if divergente and length(trim(coalesce(p ->> 'divergencia_motivo', ''))) < 3 then
    raise exception 'Descreva a divergência (o que veio diferente do pedido).';
  end if;
  if direta and autorizado is null then raise exception 'Informe quem autorizou a compra direta.'; end if;

  if nullif(p ->> 'cotacao_id', '') is not null then
    select * into cot from public.cotacoes where id = (p ->> 'cotacao_id')::bigint and organization_id = org for update;
    if cot.id is null then raise exception 'Compra não encontrada.'; end if;
    if exists (select 1 from public.receipts where cotacao_id = cot.id and encerra_pedido) then
      raise exception 'Esta compra já foi recebida por completo.';
    end if;
    select * into req from public.material_requests where id = cot.material_request_id;
  end if;
  fornecedor := coalesce(cot.fornecedor, nullif(trim(coalesce(p ->> 'fornecedor', '')), ''));
  if fornecedor is null then raise exception 'Informe o fornecedor.'; end if;
  divisao := coalesce(nullif(p ->> 'divisao', ''), cot.divisao, req.divisao);

  -- Nota repetida: pela chave, ou pelo mesmo fornecedor e número já em Contas a pagar.
  if chave is not null and exists (select 1 from public.receipts where organization_id = org and nf_chave = chave) then
    raise exception 'Esta nota já foi lançada (mesma chave de acesso).';
  end if;
  if exists (select 1 from public.finance_titles where organization_id = org and direction = 'payable'
             and lower(counterparty_name) = lower(fornecedor) and document_number = nf and coalesce(source_module, '') <> 'legado') then
    raise exception 'Já existe conta a pagar da NF % de %.', nf, fornecedor;
  end if;

  -- Compra direta pela nota: a OC nasce aprovada e comprada, com o número da sequência das cotações.
  if direta then
    perform set_config('pecsil.compra_direta', 'on', true);
    insert into public.cotacoes (organization_id, fornecedor, divisao, status, user_id, aprovado_por, data_decisao, origem, autorizado_por, observacao)
    values (org, left(fornecedor, 200),
      case when divisao = 'FUNDICAO' or (divisao is null and coalesce((p -> 'centro' ->> 'fundicao')::boolean, false)) then 'FUNDICAO' else 'USINAGEM' end,
      'COMPRADO', '1', autorizado, now(), 'direta', autorizado, format('Compra direta registrada pelo recebimento da NF %s.', nf))
    returning * into cot;
    perform set_config('pecsil.compra_direta', 'off', true);
  end if;

  insert into public.receipts (organization_id, cotacao_id, material_request_id, supplier_id, fornecedor, cnpj, nf_numero, nf_serie, nf_chave,
    emissao, recebido_em, valor_total, base_icms, icms, ipi, divisao, com_xml, nfe_xml, encerra_pedido, divergencia, divergencia_motivo,
    observacao, received_by, received_by_name)
  values (org, cot.id, req.id, cot.supplier_id, fornecedor, nullif(regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), ''), nf,
    nullif(trim(coalesce(p ->> 'nf_serie', '')), ''), chave, emissao, recebido, valor,
    coalesce((p ->> 'base_icms')::numeric, 0), coalesce((p ->> 'icms')::numeric, 0), coalesce((p ->> 'ipi')::numeric, 0),
    divisao, nullif(p ->> 'xml', '') is not null, nullif(p ->> 'xml', ''), case when direta then true else encerra end, divergente,
    nullif(trim(coalesce(p ->> 'divergencia_motivo', '')), ''), nullif(trim(coalesce(p ->> 'observacao', '')), ''), me, meu_nome)
  returning * into rec;

  for item in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    n := n + 1;
    insert into public.receipt_items (organization_id, receipt_id, ordem, descricao, quantidade, unidade, valor_total)
    values (org, rec.id, n, coalesce(nullif(trim(item ->> 'descricao'), ''), 'Item ' || n), coalesce((item ->> 'quantidade')::numeric, 0),
      nullif(upper(trim(coalesce(item ->> 'unidade', ''))), ''), coalesce((item ->> 'valor_total')::numeric, 0));
  end loop;

  -- Itens da OC da compra direta: os da nota (sem itens, um só, "conforme NF"). As linhas em
  -- `compras` não geram previsão (a conta real nasce aqui mesmo).
  if direta then
    perform set_config('pecsil.compra_direta', 'on', true);
    update public.cotacoes set receipt_id = rec.id where id = cot.id;
    perform set_config('pecsil.compra_direta', 'off', true);
    perform set_config('pecsil.compra_direta_recebida', 'on', true);
    for item in select to_jsonb(ri) from public.receipt_items ri where ri.receipt_id = rec.id order by ri.ordem loop
      qtd := case when coalesce((item ->> 'quantidade')::numeric, 0) > 0 then (item ->> 'quantidade')::numeric else 1 end;
      total_item := coalesce((item ->> 'valor_total')::numeric, 0);
      insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status)
      values (cot.id, left(item ->> 'descricao', 300), round(total_item / qtd, 4), qtd, coalesce(item ->> 'unidade', 'UN'), 0, 0, '', null, 'APROVADO');
      insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, nf, data_compra, obs)
      values (org, cot.id, fornecedor, left(item ->> 'descricao', 300), qtd, coalesce(item ->> 'unidade', 'UN'), round(total_item / qtd, 4),
        total_item, nf, coalesce(emissao, recebido), 'Compra direta (pela nota)');
    end loop;
    if not exists (select 1 from public.cotacao_produtos where cotacao_id = cot.id) then
      insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status)
      values (cot.id, format('Conforme NF %s', nf), valor, 1, 'UN', 0, 0, '', null, 'APROVADO');
      insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, nf, data_compra, obs)
      values (org, cot.id, fornecedor, format('Conforme NF %s', nf), 1, 'UN', valor, valor, nf, coalesce(emissao, recebido), 'Compra direta (pela nota)');
    end if;
    perform set_config('pecsil.compra_direta_recebida', 'off', true);
  end if;

  -- Previsão da compra (se houver): dá a conta do plano e o vencimento de referência.
  if cot.id is not null and not direta then
    select * into previsao from public.finance_titles
     where organization_id = org and source_module = 'compras' and source_entity_id = cot.ref_id and is_forecast
     order by created_at limit 1 for update;
    select min(due_date) into previsao_vence from public.finance_installments where title_id = previsao.id;
  end if;
  conta := coalesce(previsao.chart_account_id, public.finance_suggest_account(org, cot.supplier_id, fornecedor));

  -- Duplicatas da nota; sem duplicata, uma parcela no vencimento previsto (ou 30 dias).
  for dup in select * from jsonb_array_elements(coalesce(p -> 'duplicatas', '[]'::jsonb)) loop
    if nullif(dup ->> 'vencimento', '') is not null and coalesce((dup ->> 'valor')::numeric, 0) > 0 then
      insert into public.receipt_installments (organization_id, receipt_id, numero, vencimento, valor)
      values (org, rec.id, nullif(dup ->> 'numero', ''), (dup ->> 'vencimento')::date, round((dup ->> 'valor')::numeric, 2));
    end if;
  end loop;
  select coalesce(sum(ri.valor), 0) into soma_dups from public.receipt_installments ri where ri.receipt_id = rec.id;
  if soma_dups = 0 then
    insert into public.receipt_installments (organization_id, receipt_id, numero, vencimento, valor)
    values (org, rec.id, '1', coalesce(previsao_vence, coalesce(emissao, recebido) + 30), valor);
  elsif abs(soma_dups - valor) > 0.05 then
    motivos := motivos || format('Duplicatas somam R$ %s e a nota R$ %s', public.brl(soma_dups), public.brl(valor));
  end if;

  if cot.id is null then motivos := motivos || 'Recebimento sem pedido de compra: conferir com o Compras'::text; end if;
  if divergente then motivos := motivos || ('Divergência no recebimento: ' || trim(p ->> 'divergencia_motivo')); end if;
  if conta is null then motivos := motivos || 'Conta do plano a definir'::text; end if;

  -- Conta a pagar real.
  insert into public.finance_titles (
    organization_id, direction, counterparty_name, supplier_id, document_number, document_type, description, notes,
    issue_date, competence_date, original_amount, chart_account_id, cost_center_id, status, approved_at,
    source_module, source_entity_id, needs_review, review_reason
  ) values (
    org, 'payable', fornecedor, cot.supplier_id, nf, 'NF',
    case when direta or cot.origem = 'direta' then format('Compra direta · OC nº %s · NF %s', cot.id, nf)
         when cot.id is not null then format('Compra · OC nº %s · NF %s', cot.id, nf)
         else format('NF %s · recebimento avulso', nf) end,
    nullif(trim(coalesce(p ->> 'observacao', '')), ''),
    coalesce(emissao, recebido), coalesce(emissao, recebido), valor, conta, cot.cost_center_id, 'approved', now(),
    'almoxarifado', rec.id, cardinality(motivos) > 0, nullif(array_to_string(motivos, '; '), '')
  ) returning id into titulo;

  n := 0;
  for dup in select to_jsonb(d) from public.receipt_installments d where d.receipt_id = rec.id order by d.vencimento, d.numero loop
    n := n + 1;
    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (org, titulo, n, (dup ->> 'vencimento')::date, (dup ->> 'valor')::numeric, 0,
      case when (dup ->> 'vencimento')::date < current_date then 'overdue' else 'pending' end::public.finance_installment_status);
  end loop;
  select min(ri.vencimento) into primeiro_venc from public.receipt_installments ri where ri.receipt_id = rec.id;
  -- Parcelas que não fecham com a nota: o título vale a soma delas.
  if soma_dups > 0 and abs(soma_dups - valor) > 0.05 then
    update public.finance_titles set original_amount = soma_dups where id = titulo;
  end if;
  if conta is not null then
    insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
    select org, titulo, conta, original_amount from public.finance_titles where id = titulo;
  end if;

  -- A previsão sai (pedido fechado ou nota cobre tudo) ou é abatida.
  if previsao.id is not null then
    if encerra or previsao.original_amount - valor <= 0 then
      delete from public.finance_titles where id = previsao.id;
    else
      update public.finance_titles set original_amount = original_amount - valor where id = previsao.id;
      update public.finance_installments set amount = amount - valor where title_id = previsao.id and installment_number = 1;
      update public.finance_title_allocations set amount = amount - valor where title_id = previsao.id
        and (select count(*) from public.finance_title_allocations where title_id = previsao.id) = 1;
    end if;
  end if;

  -- Painel do ICMS (centro e tipo vêm do formulário do recebimento).
  insert into public.fiscal_icms_entries (organization_id, competencia, emitida, recebida, fornecedor, fantasia, supplier_id, cnpj, nfe, serie, chave,
    valor, vlr_cobrado, base_icms, icms, ipi, tipo, fundicao, usinagem, administrativo, xml_ok, lancado, autorizado, obs, origem, receipt_id,
    created_by, created_by_name)
  values (org, date_trunc('month', recebido)::date, emissao, recebido, fornecedor, nullif(trim(coalesce(p ->> 'fantasia', '')), ''), cot.supplier_id,
    rec.cnpj, nf, rec.nf_serie, chave, valor, valor, rec.base_icms, rec.icms, rec.ipi, coalesce(nullif(p ->> 'tipo', ''), 'Material'),
    coalesce((p -> 'centro' ->> 'fundicao')::boolean, coalesce(divisao, '') = 'FUNDICAO'),
    coalesce((p -> 'centro' ->> 'usinagem')::boolean, coalesce(divisao, '') = 'USINAGEM'),
    coalesce((p -> 'centro' ->> 'administrativo')::boolean, false),
    rec.com_xml, true, false,
    coalesce(rec.divergencia_motivo, case when direta then format('Compra direta · OC nº %s', cot.id) end),
    'almoxarifado', rec.id, me, meu_nome)
  on conflict do nothing
  returning id into entrada;

  update public.receipts set finance_title_id = titulo, icms_entry_id = entrada where id = rec.id;

  if req.id is not null then
    update public.material_requests set status = case when encerra then 'recebida' else 'parcial' end, updated_at = now() where id = req.id;
  end if;

  perform public.notify_feature(org, 'financeiro.pagar', 'aprovar', 'financeiro',
    case when cardinality(motivos) > 0 then 'attention' else 'approval' end,
    format('Nota lançada · %s', fornecedor),
    format('NF %s · R$ %s · vence %s%s', nf, public.brl(valor), to_char(primeiro_venc, 'DD/MM/YYYY'),
      case when cardinality(motivos) > 0 then ' · ' || array_to_string(motivos, '; ') else '' end),
    '/?module=financeiro&secao=Contas%20a%20pagar', me);
  if direta then
    -- A OC da compra direta nasce pronta: o Compras (Kaylane) e quem aprova (Ricardo) ficam sabendo.
    perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras', 'info',
      format('Compra direta · OC nº %s · NF %s de %s', cot.id, nf, fornecedor),
      format('O Almoxarifado recebeu a nota e a OC nº %s foi gerada com os dados dela (autorizada por %s).', cot.id, autorizado),
      '/?module=compras&secao=diretas', me);
    perform public.notify_feature(org, 'compras.aprovacoes', 'aprovar', 'compras', 'info',
      format('Compra direta · OC nº %s · %s', cot.id, fornecedor),
      format('NF %s · R$ %s, autorizada por %s.', nf, public.brl(valor), autorizado), '/?module=compras&secao=diretas', me);
  elsif divergente or cot.id is null then
    perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras', 'attention',
      format('%s · NF %s de %s', case when divergente then 'Divergência no recebimento' else 'Nota sem pedido' end, nf, fornecedor),
      coalesce(rec.divergencia_motivo, 'O Almoxarifado recebeu material sem cotação no sistema.'),
      '/?module=compras&secao=compras', me);
  end if;

  perform public.emit_module_event(org, 'almoxarifado', 'almoxarifado.recebimento.confirmado', 'recebimento', rec.id::text,
    format('Recebido · NF %s de %s · R$ %s%s', nf, fornecedor, public.brl(valor), case when direta then format(' · OC nº %s (compra direta)', cot.id) else '' end),
    jsonb_build_object('numero', rec.numero, 'cotacao_id', cot.id, 'nf', nf, 'valor', valor, 'divergencia', divergente, 'titulo', titulo, 'compra_direta', direta));

  return jsonb_build_object('id', rec.id, 'numero', rec.numero, 'titulo', titulo, 'icms', entrada, 'revisar', array_to_string(motivos, '; '),
    'oc', case when direta then cot.id end);
end;
$$;

-- --- Lista das compras diretas: a mesma no Compras e no Almoxarifado -----------------------------
-- O Almoxarifado não lê cotacoes pelo RLS (é do módulo Compras); a lista sai por aqui, só com o
-- que as duas telas mostram.
create or replace function public.compras_diretas_listar(p_limite int default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if org is null or not (public.has_feature('compras.cotacoes', 'ver') or public.has_feature('compras.aprovacoes', 'ver')
      or public.has_feature('compras.realizadas', 'ver') or public.has_feature('almoxarifado.recebimento', 'ver')) then
    raise exception 'Sem permissão para ver as compras diretas.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(linha order by id desc) from (
      select c.id, jsonb_build_object(
        'id', c.id, 'fornecedor', c.fornecedor, 'divisao', c.divisao, 'autorizadoPor', c.autorizado_por,
        'criadaEm', c.created_at, 'observacao', c.observacao, 'prazoEntrega', c.prazo_entrega,
        'freteTipo', c.frete_tipo, 'despesas', coalesce(c.frete_valor, 0) + coalesce(c.seguro_valor, 0) + coalesce(c.outras_despesas, 0),
        'pelaNota', c.receipt_id is not null,
        'total', (select coalesce(sum(k.total), 0) from public.compras k where k.cotacao_id = c.id),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto', i.produto, 'quantidade', i.quantidade, 'unidade', i.unidade,
                    'valorUnit', i.valor_unit) order by i.id), '[]'::jsonb) from public.cotacao_produtos i where i.cotacao_id = c.id),
        'notas', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'numero', r.numero, 'nf', r.nf_numero, 'serie', r.nf_serie,
                    'valor', r.valor_total, 'recebidaEm', r.recebido_em, 'por', r.received_by_name) order by r.recebido_em, r.numero), '[]'::jsonb)
                  from public.receipts r where r.cotacao_id = c.id and r.organization_id = org)
      ) as linha
      from public.cotacoes c
      where c.organization_id = org and c.origem = 'direta' and c.deleted_at is null
      order by c.id desc
      limit greatest(1, least(coalesce(p_limite, 300), 1000))
    ) s), '[]'::jsonb);
end;
$$;
revoke all on function public.compras_diretas_listar(int) from public, anon;
grant execute on function public.compras_diretas_listar(int) to authenticated;

-- --- "A caminho" diz quando é compra direta (versão em vigor: 202610090002_fundicao_pedidos.sql) ---
create or replace function public.almoxarifado_a_caminho()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if not (public.has_feature('almoxarifado.recebimento') or public.has_feature('almoxarifado.solicitacoes')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'compradoEm' desc, (x ->> 'cotacaoId')::bigint desc)
    from (
      select jsonb_build_object(
        'cotacaoId', c.id,
        'fornecedor', c.fornecedor,
        'supplierId', c.supplier_id,
        'cnpj', (select regexp_replace(coalesce(s.tax_id, ''), '\D', '', 'g') from public.suppliers s where s.id = c.supplier_id),
        'divisao', c.divisao,
        'direta', c.origem = 'direta',
        'autorizadoPor', c.autorizado_por,
        'pedidoId', r.id,
        'pedidoNumero', r.numero,
        'origem', r.origem,
        'solicitante', r.requested_by_name,
        'compradoEm', (select min(k.data_compra) from public.compras k where k.cotacao_id = c.id),
        'totalComprado', (select coalesce(sum(k.total), 0) from public.compras k where k.cotacao_id = c.id),
        'jaRecebido', coalesce((select sum(rc.valor_total) from public.receipts rc where rc.cotacao_id = c.id), 0),
        'recebimentos', (select count(*) from public.receipts rc where rc.cotacao_id = c.id),
        'previsaoVencimento', (select min(i.due_date) from public.finance_titles t join public.finance_installments i on i.title_id = t.id
                                where t.source_module = 'compras' and t.source_entity_id = c.ref_id and t.is_forecast),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto', k.produto, 'quantidade', k.quantidade, 'unidade', k.unidade,
                    'valorUnit', k.valor_unit, 'total', k.total) order by k.id), '[]'::jsonb)
                  from public.compras k where k.cotacao_id = c.id)
      ) as x
      from public.cotacoes c
      left join public.material_requests r on r.id = c.material_request_id
      where c.organization_id = org and c.deleted_at is null
        and exists (select 1 from public.compras k where k.cotacao_id = c.id)
        and (
          exists (select 1 from public.finance_titles t where t.source_module = 'compras' and t.source_entity_id = c.ref_id and t.is_forecast)
          or exists (select 1 from public.receipts rc where rc.cotacao_id = c.id)
        )
        and not exists (select 1 from public.receipts rc where rc.cotacao_id = c.id and rc.encerra_pedido)
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.almoxarifado_a_caminho() from public, anon;
grant execute on function public.almoxarifado_a_caminho() to authenticated;
