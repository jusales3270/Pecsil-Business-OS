-- ============================================================================
-- Orçamento ganho vira OS em rascunho na Forja (16/10/2026)
-- ============================================================================
-- docs/PLANO-ORCAMENTO.md (O1 ajustada, E3) e docs/PLANO-ALMOXARIFADO.md.
--
-- Ganho o orçamento (fora do treino), cada item entra na fila forja_os_envios. A sincronização com a
-- Forja (a cada 10 minutos, e logo depois do ganho) cria lá a OS em RASCUNHO: sem lotes nem OPs, fora
-- do Tótem. O Rafael completa na Forja o roteiro, os desenhos e a lista de materiais (do catálogo do
-- Almoxarifado) e libera. A situação da OS volta para o item do orçamento.
--
-- Reabrir ou cancelar o orçamento cancela o rascunho na Forja; se a OS já foi liberada, recusa
-- ("cancele na Forja primeiro"). A referência é o id do item no momento do envio: item apagado
-- depois não perde o pedido de cancelamento.
-- ============================================================================

create table if not exists public.forja_os_envios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid references public.sales_quotes(id) on delete set null,
  quote_item_id uuid references public.sales_quote_items(id) on delete set null,
  -- Referência enviada à Forja (refExterna): o id do item quando entrou na fila.
  ref text not null unique,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'erro', 'cancelar', 'cancelado')),
  tentativas int not null default 0,
  proxima_tentativa timestamptz not null default now(),
  ultimo_erro text,
  forja_os_id text,
  forja_codigo text,
  -- Situação da OS na Forja (rascunho, aberta, em_producao, finalizada, cancelada), lida na sincronização.
  forja_status text,
  materiais jsonb,
  enviado_em timestamptz,
  verificado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_forja_os_envios_fila on public.forja_os_envios (status, proxima_tentativa);
create index if not exists idx_forja_os_envios_quote on public.forja_os_envios (quote_id);

-- Marcadores das integrações (ex.: até quando o catálogo de materiais já foi enviado à Forja).
create table if not exists public.integration_cursors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null check (length(chave) between 1 and 60),
  valor timestamptz,
  -- Desempate do cursor (ex.: o último código enviado no mesmo instante de alteração).
  marca text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, chave)
);

alter table public.forja_os_envios enable row level security;
alter table public.integration_cursors enable row level security;
drop policy if exists forja_os_envios_read on public.forja_os_envios;
create policy forja_os_envios_read on public.forja_os_envios for select
  using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
-- A fila só muda pelo gatilho, pela função de reenviar e pela sincronização (chave de serviço).
revoke insert, update, delete on public.forja_os_envios, public.integration_cursors from anon, authenticated;

-- Ganho → fila; reabrir/cancelar → cancela o rascunho (ou recusa, se a OS já foi liberada).
create or replace function public.forja_os_envios_do_orcamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  liberada text;
begin
  if new.treino then return new; end if;

  if new.situacao = 'ganho' and old.situacao is distinct from 'ganho' then
    insert into public.forja_os_envios (organization_id, quote_id, quote_item_id, ref)
    select new.organization_id, new.id, i.id, i.id::text from public.sales_quote_items i where i.quote_id = new.id
    on conflict (ref) do update set status = 'pendente', tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
      where forja_os_envios.status in ('cancelar', 'cancelado');

  elsif old.situacao = 'ganho' and new.situacao in ('rascunho', 'cancelado') then
    -- A previsão a receber cancelada solta o nº do pedido: sem isso, ganhar de novo esbarrava no
    -- índice único do documento (uq_finance_title_document). A descrição continua citando o pedido.
    update public.finance_titles set document_number = null, updated_at = now()
     where organization_id = new.organization_id and source_module = 'comercial' and source_entity_id = new.id and is_forecast and status = 'cancelled';
    select coalesce(forja_codigo, 'a OS') into liberada from public.forja_os_envios
     where quote_id = new.id and status = 'enviado' and forja_status in ('aberta', 'em_producao', 'finalizada', 'atrasada') limit 1;
    if liberada is not null then
      raise exception 'A OS % já foi liberada para produção na Forja: cancele lá primeiro.', liberada;
    end if;
    -- Nunca chegou à Forja: só sai da fila. Já chegou: a sincronização cancela o rascunho lá.
    update public.forja_os_envios set status = 'cancelado', updated_at = now()
     where quote_id = new.id and status in ('pendente', 'erro') and forja_os_id is null;
    update public.forja_os_envios set status = 'cancelar', tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
     where quote_id = new.id and (status = 'enviado' or (status = 'erro' and forja_os_id is not null));
  end if;
  return new;
end;
$$;
revoke all on function public.forja_os_envios_do_orcamento() from public, anon, authenticated;
drop trigger if exists sales_quotes_forja_os on public.sales_quotes;
create trigger sales_quotes_forja_os after update of situacao on public.sales_quotes
  for each row execute function public.forja_os_envios_do_orcamento();

-- "Tentar de novo" no orçamento: o envio com erro volta para a fila agora.
create or replace function public.comercial_forja_reenviar(p_quote uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.has_feature('comercial.orcamentos', 'operar') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  update public.forja_os_envios e set status = case when q.situacao = 'ganho' then 'pendente' when e.forja_os_id is null then 'cancelado' else 'cancelar' end,
         tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
    from public.sales_quotes q
   where q.id = e.quote_id and e.quote_id = p_quote and q.organization_id = public.current_organization_id() and e.status = 'erro';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.comercial_forja_reenviar(uuid) from public, anon;
grant execute on function public.comercial_forja_reenviar(uuid) to authenticated;

-- Espelho das OS: o rascunho do orçamento ainda não é OS aberta. Chegou em rascunho: sem evento;
-- liberado (rascunho → aberta): aí sim "OS aberta".
create or replace function public.events_producao_os()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'rascunho' then return new; end if;
    if new.opened_at is not null and new.opened_at < now() - interval '7 days' then
      return new;
    end if;
    perform public.emit_module_event(new.organization_id, 'producao', 'producao.os.aberta', 'os', new.id::text,
      format('OS %s aberta · %s · %s', new.code, coalesce(new.customer_name, 'cliente'), coalesce(new.article_code, 'artigo')),
      jsonb_build_object('code', new.code, 'status', new.status, 'due_date', new.due_date));
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status = 'rascunho' and new.status = 'aberta' then
      perform public.emit_module_event(new.organization_id, 'producao', 'producao.os.aberta', 'os', new.id::text,
        format('OS %s aberta (liberada do orçamento) · %s · %s', new.code, coalesce(new.customer_name, 'cliente'), coalesce(new.article_code, 'artigo')),
        jsonb_build_object('code', new.code, 'status', new.status, 'due_date', new.due_date, 'liberada', true));
    elsif old.status = 'rascunho' and new.status = 'cancelada' then
      return new;
    else
      perform public.emit_module_event(new.organization_id, 'producao', 'producao.os.status', 'os', new.id::text,
        format('OS %s: %s → %s', new.code, old.status, new.status),
        jsonb_build_object('code', new.code, 'from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.events_producao_os() from public;
