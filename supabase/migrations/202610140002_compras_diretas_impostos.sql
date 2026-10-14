-- Compra direta pela nota (caminho A): a OC leva o ICMS e o IPI da nota, em % sobre os itens, para
-- fechar com o valor da nota (sem isso a OC de uma nota de R$ 233,63 com IPI saía R$ 222,50).
-- Versão em vigor: 202610140001_compras_diretas.sql; a única mudança é o update depois dos itens.

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
    -- ICMS e IPI da nota como % sobre os itens: a OC fecha com o valor da nota (pode diferir em centavos).
    update public.cotacao_produtos p
       set icms = round(rec.icms / t.soma * 100, 2), ipi = round(rec.ipi / t.soma * 100, 2)
      from (select sum(valor_total) as soma from public.receipt_items where receipt_id = rec.id) t
     where p.cotacao_id = cot.id and t.soma > 0;
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
