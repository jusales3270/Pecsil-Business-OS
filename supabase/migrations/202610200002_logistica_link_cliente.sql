-- Logística: link de rastreio para o cliente (docs/PLANO-LOGISTICA.md §3), 20/10/2026.
-- Decisão do proprietário: o link do cliente é da PLATAFORMA (a consulta pública do Fleetbase fica fechada), sem
-- conta, como o portal do fornecedor (A-09). Mandar ou não o link ao cliente é decisão do Comercial.
--   * O link é guardado só pelo hash (sha256): quem lê o banco não monta o link.
--   * Ler pelo link é só da plataforma (chave do servidor), nunca do navegador direto.
--   * A página mostra a entrega, a previsão e o caminhão no mapa, sem nome, telefone ou placa do motorista.

create table if not exists public.logistica_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  entrega_id       uuid not null references public.logistica_entregas (id) on delete cascade,
  token_hash       text not null unique,
  expira_em        timestamptz not null,
  situacao         text not null default 'aberto' check (situacao in ('aberto', 'cancelado')),
  criado_por       uuid references public.profiles (id) on delete set null,
  criado_por_nome  text,
  aberto_em        timestamptz,
  ultima_abertura  timestamptz,
  aberturas        integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists logistica_links_entrega on public.logistica_links (organization_id, entrega_id, created_at desc);

alter table public.logistica_links enable row level security;
drop policy if exists logistica_links_read on public.logistica_links;
create policy logistica_links_read on public.logistica_links for select to authenticated using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('logistica.entregas')));
revoke all on public.logistica_links from anon, authenticated;
-- Leitura coluna a coluna: o hash do link não sai para a tela.
grant select (id, organization_id, entrega_id, expira_em, situacao, criado_por, criado_por_nome, aberto_em, ultima_abertura, aberturas, created_at)
  on public.logistica_links to authenticated;

-- Novo link (substitui o aberto da mesma entrega). Devolve o código UMA vez: depois, só o hash fica guardado.
create or replace function public.logistica_link_criar(p_entrega uuid, p_dias int default 3)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  org uuid := public.logistica_exigir_operar();
  e public.logistica_entregas%rowtype;
  codigo text;
  v_id uuid;
  dias int := least(greatest(coalesce(p_dias, 3), 1), 15);
begin
  select * into e from public.logistica_entregas where id = p_entrega and organization_id = org;
  if e.id is null then raise exception 'Entrega não encontrada.'; end if;
  if e.situacao in ('criada', 'cancelada') then raise exception 'O link só existe para entrega que já está com a frota.'; end if;
  update public.logistica_links set situacao = 'cancelado' where organization_id = org and entrega_id = e.id and situacao = 'aberto';
  codigo := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.logistica_links (organization_id, entrega_id, token_hash, expira_em, criado_por, criado_por_nome)
  values (org, e.id, encode(digest(codigo, 'sha256'), 'hex'), now() + make_interval(days => dias), public.current_profile_id(), public.logistica_meu_nome())
  returning id into v_id;
  perform public.emit_module_event(org, 'logistica', 'logistica.link.criado', 'logistica_entrega', e.id::text,
    format('Link de rastreio da entrega %s para %s', e.numero, e.cliente_nome), jsonb_build_object('link', v_id, 'dias', dias));
  return jsonb_build_object('id', v_id, 'codigo', codigo, 'expira_em', now() + make_interval(days => dias));
end $$;
revoke all on function public.logistica_link_criar(uuid, int) from public, anon;
grant execute on function public.logistica_link_criar(uuid, int) to authenticated;

create or replace function public.logistica_link_cancelar(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_operar();
  l public.logistica_links%rowtype;
begin
  update public.logistica_links set situacao = 'cancelado' where id = p_id and organization_id = org and situacao = 'aberto' returning * into l;
  if l.id is null then raise exception 'Link não encontrado ou já cancelado.'; end if;
  perform public.emit_module_event(org, 'logistica', 'logistica.link.cancelado', 'logistica_entrega', l.entrega_id::text,
    'Link de rastreio cancelado', jsonb_build_object('link', l.id));
end $$;
revoke all on function public.logistica_link_cancelar(uuid) from public, anon;
grant execute on function public.logistica_link_cancelar(uuid) to authenticated;

-- Leitura pelo link: SÓ o servidor (chave de serviço). Devolve a entrega para a página do cliente e, à parte, o
-- número da ordem no Fleetbase, que o servidor usa para achar o caminhão e NÃO repassa ao navegador.
create or replace function public.logistica_link_ler(p_codigo text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.logistica_links%rowtype;
  e public.logistica_entregas%rowtype;
  empresa text;
begin
  select * into l from public.logistica_links where token_hash = encode(digest(coalesce(p_codigo, ''), 'sha256'), 'hex');
  if l.id is null then return jsonb_build_object('situacao', 'inexistente'); end if;
  if l.situacao = 'cancelado' then return jsonb_build_object('situacao', 'cancelado'); end if;
  if l.expira_em < now() then return jsonb_build_object('situacao', 'expirado'); end if;
  select * into e from public.logistica_entregas where id = l.entrega_id;
  select coalesce(nullif(f.razao_social, ''), o.display_name, o.legal_name) into empresa
    from public.organizations o left join public.fiscal_config f on f.organization_id = o.id where o.id = l.organization_id;
  update public.logistica_links set aberto_em = coalesce(aberto_em, now()), ultima_abertura = now(), aberturas = aberturas + 1 where id = l.id;
  return jsonb_build_object(
    'situacao', 'aberto', 'expira_em', l.expira_em, 'empresa', empresa,
    'entrega', jsonb_build_object('numero', e.numero, 'cliente', e.cliente_nome, 'descricao', e.descricao, 'etapa', e.situacao,
      'saiu_em', e.saiu_em, 'entregue_em', e.entregue_em, 'previsao', e.previsao,
      'destino_lat', e.destino_lat, 'destino_lng', e.destino_lng, 'destino_endereco', e.destino_endereco),
    'servidor', jsonb_build_object('ordem', e.fleetbase_ordem, 'motorista', e.motorista));
end $$;
revoke all on function public.logistica_link_ler(text) from public, anon, authenticated;
grant execute on function public.logistica_link_ler(text) to service_role;
