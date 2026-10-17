-- A-09 (roadmap) · Portal do fornecedor por link (decisão do proprietário em 17/10/2026: link por
-- cotação, sem conta). O Compras gera, a partir de um pedido de material, um link só daquele pedido e
-- daquele fornecedor, com validade (7 dias por padrão). O fornecedor abre sem login, vê só os itens
-- pedidos, preenche preço, IPI, quantidade, prazo de entrega, frete e condição de pagamento, anexa o
-- PDF da proposta e envia UMA vez. A resposta vira uma cotação PENDENTE ligada ao pedido (com o
-- material do catálogo em cada item), e o Compras é avisado.
--   * O link é guardado só pelo hash (sha256): quem lê o banco não monta o link.
--   * Ler e responder pelo link é só da plataforma (chave do servidor), nunca do navegador direto.
--   * Cada envio fica registrado: quando, IP, navegador e o arquivo.
-- Sem IA: o fornecedor digita os valores; o PDF é a prova da proposta.

create table if not exists public.compras_convites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_request_id uuid not null references public.material_requests(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  fornecedor text not null check (length(btrim(fornecedor)) between 2 and 200),
  token_hash text not null unique,
  expira_em timestamptz not null,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'respondido', 'cancelado')),
  cotacao_id bigint references public.cotacoes(id) on delete set null,
  document_id uuid references public.company_documents(id) on delete set null,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  respondido_em timestamptz,
  resposta_ip inet,
  resposta_navegador text,
  aberto_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_compras_convites_pedido on public.compras_convites (organization_id, material_request_id, created_at desc);

alter table public.compras_convites enable row level security;
drop policy if exists compras_convites_read on public.compras_convites;
create policy compras_convites_read on public.compras_convites for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('compras.cotacoes'));
revoke all on public.compras_convites from anon, authenticated;
-- Leitura coluna a coluna: o hash do link não sai para a tela.
grant select (id, organization_id, material_request_id, supplier_id, fornecedor, expira_em, situacao, cotacao_id, document_id,
  criado_por, criado_por_nome, respondido_em, resposta_ip, resposta_navegador, aberto_em, created_at) on public.compras_convites to authenticated;

-- Compras gera o convite; devolve o código do link UMA vez (só o hash fica guardado).
create or replace function public.compras_convite_criar(p_pedido uuid, p_supplier uuid, p_fornecedor text, p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  ped public.material_requests%rowtype;
  nome text := nullif(btrim(coalesce(p_fornecedor, '')), '');
  codigo text;
  v_id uuid;
  dias int := least(greatest(coalesce(p_dias, 7), 1), 30);
begin
  if org is null or not public.has_feature('compras.cotacoes', 'operar') then
    raise exception 'Convidar fornecedor é de quem lança cotações no Compras.' using errcode = '42501';
  end if;
  select * into ped from public.material_requests where id = p_pedido and organization_id = org;
  if ped.id is null then raise exception 'Pedido de material não encontrado.'; end if;
  if ped.status in ('cancelada', 'recebida', 'comprada', 'parcial') then raise exception 'Este pedido já não está em cotação.'; end if;
  if p_supplier is not null then
    select coalesce(nullif(btrim(trade_name), ''), name) into nome from public.suppliers where id = p_supplier and organization_id = org;
    if nome is null then raise exception 'Fornecedor não encontrado no cadastro.'; end if;
  end if;
  if nome is null or length(nome) < 2 then raise exception 'Informe o fornecedor.'; end if;
  -- Um convite aberto por fornecedor e pedido: o novo substitui o anterior.
  update public.compras_convites set situacao = 'cancelado'
  where organization_id = org and material_request_id = ped.id and situacao = 'aberto'
    and (supplier_id = p_supplier or (p_supplier is null and supplier_id is null and lower(fornecedor) = lower(nome)));
  codigo := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.compras_convites (organization_id, material_request_id, supplier_id, fornecedor, token_hash, expira_em, criado_por, criado_por_nome)
  values (org, ped.id, p_supplier, nome, encode(digest(codigo, 'sha256'), 'hex'), now() + make_interval(days => dias), me,
    (select full_name from public.profiles where id = me))
  returning id into v_id;
  perform public.emit_module_event(org, 'compras', 'compras.convite.criado', 'pedido', ped.id::text,
    format('Convite de cotação · pedido nº %s · %s', ped.numero, nome), jsonb_build_object('convite', v_id, 'dias', dias));
  return jsonb_build_object('id', v_id, 'codigo', codigo, 'expira_em', now() + make_interval(days => dias), 'fornecedor', nome);
end;
$$;
revoke all on function public.compras_convite_criar(uuid, uuid, text, int) from public, anon;
grant execute on function public.compras_convite_criar(uuid, uuid, text, int) to authenticated;

create or replace function public.compras_convite_cancelar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not public.has_feature('compras.cotacoes', 'operar') then
    raise exception 'Cancelar convite é de quem lança cotações no Compras.' using errcode = '42501';
  end if;
  update public.compras_convites set situacao = 'cancelado' where id = p_id and organization_id = org and situacao = 'aberto';
  if not found then raise exception 'Convite não está aberto.'; end if;
end;
$$;
revoke all on function public.compras_convite_cancelar(uuid) from public, anon;
grant execute on function public.compras_convite_cancelar(uuid) to authenticated;

-- Página do fornecedor: o que ele vê pelo link (só a plataforma chama, com a chave do servidor).
create or replace function public.compras_convite_ler(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.compras_convites%rowtype;
  ped public.material_requests%rowtype;
  empresa text;
begin
  select * into c from public.compras_convites where token_hash = encode(digest(coalesce(p_codigo, ''), 'sha256'), 'hex');
  if c.id is null then return jsonb_build_object('situacao', 'inexistente'); end if;
  select * into ped from public.material_requests where id = c.material_request_id;
  select coalesce(nullif(f.razao_social, ''), o.legal_name, o.display_name) into empresa
  from public.organizations o left join public.fiscal_config f on f.organization_id = o.id where o.id = c.organization_id;
  if c.situacao = 'aberto' and c.aberto_em is null then update public.compras_convites set aberto_em = now() where id = c.id; end if;
  return jsonb_build_object(
    'situacao', case when c.situacao = 'aberto' and c.expira_em < now() then 'expirado' else c.situacao end,
    'empresa', empresa, 'fornecedor', c.fornecedor, 'expira_em', c.expira_em, 'respondido_em', c.respondido_em,
    'pedido', ped.numero, 'precisa_ate', ped.precisa_ate,
    'itens', case when c.situacao = 'aberto' and c.expira_em >= now() then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'produto', coalesce(m.descricao, i.produto), 'codigo', m.codigo, 'quantidade', i.quantidade,
        'unidade', i.unidade, 'observacao', i.observacao) order by i.ordem)
      from public.material_request_items i left join public.materials m on m.id = i.material_id
      where i.request_id = ped.id), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.compras_convite_ler(text) from public, anon, authenticated;
grant execute on function public.compras_convite_ler(text) to service_role;

-- Resposta do fornecedor: vira cotação PENDENTE ligada ao pedido. Uma vez só.
create or replace function public.compras_convite_responder(
  p_codigo text, p_itens jsonb, p_prazo_entrega date, p_condicao text, p_frete_tipo text, p_frete_valor numeric,
  p_observacao text, p_ip inet, p_navegador text,
  p_arquivo_nome text, p_arquivo_mime text, p_arquivo_tamanho bigint, p_arquivo_sha256 text, p_arquivo_caminho text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.compras_convites%rowtype;
  ped public.material_requests%rowtype;
  cot bigint;
  doc uuid;
  n int := 0;
  it record;
  condicao text := left(nullif(btrim(coalesce(p_condicao, '')), ''), 120);
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

  -- Pela regra do Compras, a cotação nasce do lado da empresa; o tipo e a divisão vêm do pedido.
  insert into public.cotacoes (organization_id, fornecedor, supplier_id, status, user_id, divisao, material_request_id, prazo_entrega,
    frete_tipo, frete_valor, observacao, produto, valor_unit, quantidade, unidade, prazo)
  values (c.organization_id, c.fornecedor, c.supplier_id, 'PENDENTE', coalesce(c.criado_por::text, 'convite'), ped.divisao, ped.id, p_prazo_entrega,
    p_frete_tipo, greatest(coalesce(p_frete_valor, 0), 0),
    left(concat_ws(' · ', 'Respondida pelo fornecedor pelo link do portal', nullif(btrim(coalesce(p_observacao, '')), '')), 1000),
    null, null, null, null, condicao)
  returning id into cot;

  for it in
    select i.*, (x ->> 'valor_unit')::numeric v, coalesce((x ->> 'ipi')::numeric, 0) ipi, coalesce((x ->> 'quantidade')::numeric, i.quantidade) q, left(x ->> 'obs', 300) obs
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x
    join public.material_request_items i on i.id = (x ->> 'id')::uuid and i.request_id = ped.id
    where (x ->> 'valor_unit') is not null and (x ->> 'valor_unit')::numeric > 0
  loop
    if it.q <= 0 then raise exception 'Quantidade inválida em %.', it.produto; end if;
    if it.ipi < 0 or it.ipi > 100 then raise exception 'IPI inválido em %.', it.produto; end if;
    insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status, material_id)
    values (cot, it.produto, round(it.v, 4), it.q, it.unidade, 0, it.ipi, condicao, coalesce(it.obs, ''), 'PENDENTE', it.material_id);
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
  perform public.notify_feature(c.organization_id, 'compras.cotacoes', 'operar', 'compras', 'info',
    format('Fornecedor respondeu · pedido nº %s', ped.numero),
    format('%s enviou a cotação nº %s (%s item(ns)) pelo link do portal.', c.fornecedor, cot, n),
    '/?module=compras', null);
  perform public.emit_module_event(c.organization_id, 'compras', 'compras.convite.respondido', 'cotacao', cot::text,
    format('Cotação nº %s respondida pelo fornecedor %s pelo link', cot, c.fornecedor), jsonb_build_object('convite', c.id, 'itens', n, 'pedido', ped.numero));
  return jsonb_build_object('cotacao', cot, 'itens', n, 'documento', doc, 'organizacao', c.organization_id);
end;
$$;
revoke all on function public.compras_convite_responder(text, jsonb, date, text, text, numeric, text, inet, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.compras_convite_responder(text, jsonb, date, text, text, numeric, text, inet, text, text, text, bigint, text, text) to service_role;
