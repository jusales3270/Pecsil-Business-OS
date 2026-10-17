-- F-09 (roadmap) · Portal do escritório, Entrega B: as guias que o escritório envia (DARF,
-- DCTFWeb, DAS, GARE, FGTS, ISS) viram contas a pagar no Financeiro, EM APROVAÇÃO (decisão do
-- proprietário em 12/10/2026). A leitura do PDF é por regra (lib/fiscal/guia-parser.ts); quem envia
-- confere tipo, valor, vencimento e linha digitável antes de mandar.
--   * A guia entra na competência aberta na tela; o PDF vira anexo do portal (mesmo download e
--     mesma auditoria dos outros anexos).
--   * Guia repetida (mesma linha digitável) é recusada.
--   * Quem enviou (escritório ou empresa) cancela a guia errada enquanto a conta não tiver baixa; a
--     conta a pagar é cancelada junto.
--   * Quem aprova contas a pagar no Financeiro é avisado; as alçadas valem como para qualquer conta.
--   * O escritório vê a situação do pagamento de cada guia (em aprovação, aprovada, paga), nunca o
--     resto do Financeiro.

create table if not exists public.fiscal_guias (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia_id uuid not null references public.fiscal_competencias(id) on delete restrict,
  document_id uuid not null references public.company_documents(id) on delete restrict,
  tipo text not null check (tipo in ('DARF', 'DCTFWeb', 'DAS', 'GARE', 'FGTS', 'ISS', 'Outra')),
  valor numeric(18,2) not null check (valor > 0),
  vencimento date not null,
  linha_digitavel text check (linha_digitavel is null or linha_digitavel ~ '^\d{44}$|^\d{48}$'),
  observacao text check (observacao is null or length(observacao) <= 500),
  situacao text not null default 'enviada' check (situacao in ('enviada', 'cancelada')),
  cancelada_motivo text,
  cancelada_em timestamptz,
  cancelada_por_nome text,
  finance_title_id uuid references public.finance_titles(id) on delete set null,
  lado text not null check (lado in ('empresa', 'escritorio')),
  enviado_por uuid references public.profiles(id) on delete set null,
  enviado_por_nome text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_fiscal_guias_linha on public.fiscal_guias (organization_id, linha_digitavel)
  where linha_digitavel is not null and situacao <> 'cancelada';
create index if not exists idx_fiscal_guias_competencia on public.fiscal_guias (organization_id, competencia_id, vencimento);

-- Leitura só pelas funções abaixo (o escritório não lê a tabela de contas).
alter table public.fiscal_guias enable row level security;
revoke all on public.fiscal_guias from anon, authenticated;

create or replace function public.fiscal_guia_credor(p_tipo text)
returns text language sql immutable set search_path = public as $$
  select case p_tipo
    when 'DARF' then 'Receita Federal (DARF)'
    when 'DCTFWeb' then 'Receita Federal (DCTFWeb · INSS)'
    when 'DAS' then 'Simples Nacional (DAS)'
    when 'GARE' then 'Secretaria da Fazenda (GARE · ICMS)'
    when 'FGTS' then 'FGTS Digital (Caixa)'
    when 'ISS' then 'Prefeitura (ISS)'
    else 'Guia de recolhimento' end;
$$;

create or replace function public.fiscal_portal_guia_enviar(
  p_competencia uuid, p_tipo text, p_valor numeric, p_vencimento date, p_linha text, p_observacao text,
  p_original_name text, p_mime text, p_size bigint, p_sha256 text, p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = me);
  linha text := nullif(regexp_replace(coalesce(p_linha, ''), '\D', '', 'g'), '');
  obs text := nullif(left(trim(coalesce(p_observacao, '')), 500), '');
  comp public.fiscal_competencias%rowtype;
  guia uuid := gen_random_uuid();
  doc uuid;
  titulo uuid;
  credor text := public.fiscal_guia_credor(p_tipo);
  rotulo text;
begin
  if p_tipo is null or p_tipo not in ('DARF', 'DCTFWeb', 'DAS', 'GARE', 'FGTS', 'ISS', 'Outra') then raise exception 'Escolha o tipo da guia.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor da guia.'; end if;
  if p_vencimento is null then raise exception 'Informe o vencimento da guia.'; end if;
  if linha is not null and length(linha) not in (44, 48) then raise exception 'A linha digitável tem 48 dígitos (ou o código de barras, 44).'; end if;
  select * into comp from public.fiscal_competencias where id = p_competencia and organization_id = org;
  if comp.id is null then raise exception 'Competência não encontrada.'; end if;
  if p_storage_path is null or p_storage_path not like org::text || '/fiscal/%' then raise exception 'Caminho do arquivo inválido.'; end if;
  if linha is not null and exists (select 1 from public.fiscal_guias g where g.organization_id = org and g.linha_digitavel = linha and g.situacao <> 'cancelada') then
    raise exception 'Esta guia já foi enviada (mesma linha digitável).';
  end if;
  rotulo := p_tipo || ' · competência ' || to_char(comp.competencia, 'MM/YYYY');

  -- O PDF: documento do portal, ligado à competência (baixa e auditoria como os outros anexos).
  insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
    sha256, storage_path, version, source, entity_type, entity_id, uploaded_by, uploaded_by_name)
  values (org, 'fiscal', 'fiscal.portal', left('Guia ' || rotulo, 200), 'Guia de imposto', left(p_original_name, 255), p_mime, coalesce(p_size, 0),
    lower(p_sha256), p_storage_path, 1, 'envio', 'fiscal_guia', guia::text, me, nome)
  returning id into doc;
  insert into public.fiscal_portal_anexos (organization_id, document_id, competencia_id, pendencia_id, lado, nome, tamanho, enviado_por_nome)
  values (org, doc, comp.id, null, lado, left(p_original_name, 255), coalesce(p_size, 0), nome);

  -- Conta a pagar em aprovação: o Financeiro aprova e dá a baixa como em qualquer conta.
  insert into public.finance_titles (organization_id, direction, counterparty_name, document_number, document_type, description, notes,
    issue_date, competence_date, original_amount, status, source_module, source_entity_id, created_by_profile_id)
  values (org, 'payable', credor, linha, 'GUI',
    format('Guia %s · enviada pelo %s', rotulo, case when lado = 'escritorio' then 'escritório contábil' else 'Fiscal' end),
    obs, current_date, comp.competencia, round(p_valor, 2), 'pending_approval', 'fiscal', guia, me)
  returning id into titulo;
  insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
  values (org, titulo, 1, p_vencimento, round(p_valor, 2), 0,
    (case when p_vencimento < current_date then 'overdue' else 'pending' end)::public.finance_installment_status);

  insert into public.fiscal_guias (id, organization_id, competencia_id, document_id, tipo, valor, vencimento, linha_digitavel, observacao,
    finance_title_id, lado, enviado_por, enviado_por_nome)
  values (guia, org, comp.id, doc, p_tipo, round(p_valor, 2), p_vencimento, linha, obs, titulo, lado, me, nome);

  perform public.notify_feature(org, 'financeiro.pagar', 'aprovar', 'financeiro', 'approval',
    format('Guia para aprovar · %s', rotulo),
    format('%s · R$ %s · vence %s · enviada por %s', credor, public.brl(round(p_valor, 2)), to_char(p_vencimento, 'DD/MM/YYYY'), coalesce(nome, '—')),
    '/?module=financeiro&secao=Contas%20a%20pagar', me);
  perform public.fiscal_portal_avisar(org, case when lado = 'escritorio' then 'empresa' else 'escritorio' end, 'info',
    format('Guia enviada · %s', rotulo),
    format('R$ %s · vence %s · virou conta a pagar em aprovação no Financeiro', public.brl(round(p_valor, 2)), to_char(p_vencimento, 'DD/MM/YYYY')));
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.guia', 'fiscal_guia', guia,
    jsonb_build_object('tipo', p_tipo, 'valor', round(p_valor, 2), 'vencimento', p_vencimento, 'titulo', titulo), 'sensitive');
  return jsonb_build_object('guia', guia, 'titulo', titulo, 'documento', doc);
end;
$$;
revoke all on function public.fiscal_portal_guia_enviar(uuid, text, numeric, date, text, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.fiscal_portal_guia_enviar(uuid, text, numeric, date, text, text, text, text, bigint, text, text) to authenticated;

create or replace function public.fiscal_portal_guia_cancelar(p_guia uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  me uuid := public.current_profile_id();
  g public.fiscal_guias%rowtype;
  motivo text := left(trim(coalesce(p_motivo, '')), 500);
begin
  if motivo = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into g from public.fiscal_guias where id = p_guia and organization_id = org for update;
  if g.id is null then raise exception 'Guia não encontrada.'; end if;
  if g.situacao = 'cancelada' then raise exception 'Esta guia já foi cancelada.'; end if;
  if exists (select 1 from public.finance_installments i where i.title_id = g.finance_title_id and i.settled_amount > 0) then
    raise exception 'A guia já foi paga no Financeiro: o Financeiro precisa estornar a baixa antes.';
  end if;
  update public.fiscal_guias set situacao = 'cancelada', cancelada_motivo = motivo, cancelada_em = now(),
    cancelada_por_nome = (select full_name from public.profiles where id = me)
  where id = g.id;
  -- O número do documento ganha a marca de cancelada: a mesma guia pode ser reenviada corrigida sem
  -- bater no índice único das contas (contraparte + número), que vale também para as canceladas.
  update public.finance_titles set status = 'cancelled', cancelled_at = now(),
    document_number = document_number || ' · cancelada ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS'),
    notes = concat_ws(' · ', notes, 'Guia cancelada: ' || left(motivo, 300))
  where id = g.finance_title_id and status <> 'cancelled';
  update public.finance_installments set status = 'cancelled' where title_id = g.finance_title_id and status <> 'settled';
  perform public.notify_feature(org, 'financeiro.pagar', 'aprovar', 'financeiro', 'info',
    format('Guia cancelada · %s', g.tipo), format('R$ %s · %s · a conta a pagar foi cancelada junto', public.brl(g.valor), motivo),
    '/?module=financeiro&secao=Contas%20a%20pagar', me);
  perform public.fiscal_portal_avisar(org, case when lado = 'escritorio' then 'empresa' else 'escritorio' end, 'attention',
    format('Guia cancelada · %s', g.tipo), format('R$ %s · %s', public.brl(g.valor), motivo));
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.guia_cancelada', 'fiscal_guia', g.id, jsonb_build_object('motivo', motivo), 'sensitive');
end;
$$;
revoke all on function public.fiscal_portal_guia_cancelar(uuid, text) from public, anon;
grant execute on function public.fiscal_portal_guia_cancelar(uuid, text) to authenticated;

-- Guias da competência, com a situação do pagamento (só o rótulo, nunca o resto do Financeiro).
create or replace function public.fiscal_portal_guias(p_competencia uuid)
returns table (
  id uuid, tipo text, credor text, valor numeric, vencimento date, linha_digitavel text, observacao text, situacao text,
  pagamento text, pago_em date, cancelada_motivo text, cancelada_por_nome text, document_id uuid, nome_arquivo text,
  lado text, enviado_por_nome text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.fiscal_portal_lado() is null then raise exception 'Sem acesso ao portal do escritório.' using errcode = '42501'; end if;
  return query
  select g.id, g.tipo, public.fiscal_guia_credor(g.tipo), g.valor, g.vencimento, g.linha_digitavel, g.observacao, g.situacao,
    case
      when g.situacao = 'cancelada' then 'cancelada'
      when t.status = 'settled' then 'paga'
      when t.status = 'partially_settled' then 'paga_em_parte'
      when t.status = 'pending_approval' then 'em_aprovacao'
      when t.status = 'cancelled' then 'cancelada'
      when t.status = 'draft' then 'em_aprovacao'
      else 'aprovada'
    end,
    (select max(s.settlement_date) from public.finance_settlements s join public.finance_installments i on i.id = s.installment_id
      where i.title_id = g.finance_title_id and s.reversed_at is null),
    g.cancelada_motivo, g.cancelada_por_nome, g.document_id, d.original_name, g.lado, g.enviado_por_nome, g.created_at
  from public.fiscal_guias g
  left join public.finance_titles t on t.id = g.finance_title_id
  left join public.company_documents d on d.id = g.document_id
  where g.organization_id = org and g.competencia_id = p_competencia
  order by g.situacao = 'cancelada', g.vencimento, g.created_at;
end;
$$;
revoke all on function public.fiscal_portal_guias(uuid) from public, anon;
grant execute on function public.fiscal_portal_guias(uuid) to authenticated;
