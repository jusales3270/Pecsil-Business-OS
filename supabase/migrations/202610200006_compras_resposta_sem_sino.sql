-- Compras: a resposta do fornecedor pelo link não vai mais para o sino (pedido do proprietário, 20/10/2026).
-- Ela aparece direto no card do pedido, em Pedidos almoxarifado ("<fornecedor> respondeu pelo link ·
-- cotação nº N"), sem precisar abrir o aviso. O resto da resposta (cotação pendente ligada ao pedido e ao
-- ramo, anexo, registro no histórico) fica igual.

create or replace function public.compras_convite_responder(
  p_codigo text, p_itens jsonb, p_prazo_entrega date, p_condicao text, p_frete_tipo text, p_frete_valor numeric,
  p_observacao text, p_ip inet, p_navegador text,
  p_arquivo_nome text, p_arquivo_mime text, p_arquivo_tamanho bigint, p_arquivo_sha256 text, p_arquivo_caminho text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.compras_convites%rowtype;
  ped public.material_requests%rowtype;
  cot bigint;
  doc uuid;
  n int := 0;
  it record;
  condicao text := left(nullif(btrim(coalesce(p_condicao, '')), ''), 120);
  ramo uuid;
begin
  select * into c from public.compras_convites where token_hash = encode(digest(coalesce(p_codigo, ''), 'sha256'), 'hex') for update;
  if c.id is null then raise exception 'Link inválido.'; end if;
  if c.situacao = 'respondido' then raise exception 'Esta cotação já foi respondida por este link.'; end if;
  if c.situacao = 'cancelado' then raise exception 'Este link foi cancelado pela empresa.'; end if;
  if c.expira_em < now() then raise exception 'Este link venceu. Peça um novo à empresa.'; end if;
  if condicao is null then raise exception 'Informe a condição de pagamento.'; end if;
  if p_frete_tipo not in ('CIF', 'FOB') then raise exception 'Frete inválido.'; end if;
  if p_prazo_entrega is not null and p_prazo_entrega < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'O prazo de entrega já passou.'; end if;
  select * into ped from public.material_requests where id = c.material_request_id;
  ramo := (select r.id from public.compras_ramos r where r.id = c.ramo_id and r.situacao = 'aguardando');

  insert into public.cotacoes (organization_id, fornecedor, supplier_id, status, user_id, divisao, material_request_id, ramo_id, prazo_entrega,
    frete_tipo, frete_valor, observacao, produto, valor_unit, quantidade, unidade, prazo)
  values (c.organization_id, c.fornecedor, c.supplier_id, 'PENDENTE', coalesce(c.criado_por::text, 'convite'), ped.divisao, ped.id, ramo, p_prazo_entrega,
    p_frete_tipo, greatest(coalesce(p_frete_valor, 0), 0),
    left(concat_ws(' · ', 'Respondida pelo fornecedor pelo link do portal', nullif(btrim(coalesce(p_observacao, '')), '')), 1000),
    null, null, null, null, condicao)
  returning id into cot;

  for it in
    select i.*, (x ->> 'valor_unit')::numeric v, coalesce((x ->> 'ipi')::numeric, 0) ipi, coalesce((x ->> 'quantidade')::numeric, i.quantidade) q, left(x ->> 'obs', 300) obs
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x
    join public.material_request_items i on i.id = (x ->> 'id')::uuid and i.request_id = ped.id
    where (x ->> 'valor_unit') is not null and (x ->> 'valor_unit')::numeric > 0
      and (c.ramo_id is null or exists (select 1 from public.compras_ramo_itens ri where ri.ramo_id = c.ramo_id and ri.item_id = i.id))
  loop
    if it.q <= 0 then raise exception 'Quantidade inválida em %.', it.produto; end if;
    if it.ipi < 0 or it.ipi > 100 then raise exception 'IPI inválido em %.', it.produto; end if;
    insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status, material_id, material_request_item_id)
    values (cot, it.produto, round(it.v, 4), it.q, it.unidade, 0, it.ipi, condicao, coalesce(it.obs, ''), 'PENDENTE', it.material_id, it.id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Informe o preço de pelo menos um item.'; end if;

  if p_arquivo_caminho is not null then
    if p_arquivo_caminho not like c.organization_id::text || '/compras/%' then raise exception 'Caminho do arquivo inválido.'; end if;
    insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
      sha256, storage_path, version, source, entity_type, entity_id, uploaded_by_name)
    values (c.organization_id, 'compras', 'compras.cotacoes', left(format('Proposta · %s · cotação nº %s', c.fornecedor, cot), 200), 'Proposta de fornecedor',
      left(p_arquivo_nome, 255), p_arquivo_mime, coalesce(p_arquivo_tamanho, 0), lower(p_arquivo_sha256), p_arquivo_caminho, 1, 'envio',
      'cotacao', cot::text, left(c.fornecedor || ' (pelo link)', 200))
    returning id into doc;
  end if;

  update public.compras_convites set situacao = 'respondido', cotacao_id = cot, document_id = doc, respondido_em = now(),
    resposta_ip = p_ip, resposta_navegador = left(p_navegador, 300)
  where id = c.id;
  -- Sem aviso no sino: a resposta aparece direto no card do pedido (decisão do proprietário, 20/10).
  perform public.emit_module_event(c.organization_id, 'compras', 'compras.convite.respondido', 'cotacao', cot::text,
    format('Cotação nº %s respondida pelo fornecedor %s pelo link', cot, c.fornecedor), jsonb_build_object('convite', c.id, 'itens', n, 'pedido', ped.numero));
  return jsonb_build_object('cotacao', cot, 'itens', n, 'documento', doc, 'organizacao', c.organization_id);
end $$;
revoke all on function public.compras_convite_responder(text, jsonb, date, text, text, numeric, text, inet, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.compras_convite_responder(text, jsonb, date, text, text, numeric, text, inet, text, text, text, bigint, text, text) to service_role;
