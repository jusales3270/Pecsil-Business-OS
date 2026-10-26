-- ============================================================================
-- Checagem das notas de entrada (Contábil-Fiscal, N-09) (26/10/2026)
-- ============================================================================
-- Cada NF-e recebida guardada na plataforma é lida uma vez: itens, a classificação proposta de cada um (tipo do
-- item do SPED, CFOP de entrada e o crédito de ICMS que cabe, com o porquê) e o que não confere (CFOP × UF,
-- CST × regime, alíquota interestadual, NCM, grupo do IBS/CBS, devolução, totais). Só o servidor grava a leitura;
-- quem confirma a classificação é quem opera o ICMS (fiscal.icms operar), pela função abaixo, com auditoria.
-- ============================================================================

create table if not exists public.fiscal_entradas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.company_documents(id) on delete cascade,
  chave text check (chave is null or chave ~ '^[0-9]{44}$'),
  numero text,
  emissao timestamptz,
  competencia text check (competencia is null or competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  finalidade text,
  emitente_cnpj text,
  emitente_nome text,
  emitente_uf text,
  emitente_crt smallint,
  v_nf numeric(15,2) not null default 0,
  itens jsonb not null default '[]'::jsonb,
  achados jsonb not null default '[]'::jsonb,
  situacao text not null check (situacao in ('ok', 'atencao', 'erro', 'fora')),
  classificacao jsonb not null default '[]'::jsonb,
  conferida boolean not null default false,
  conferida_por uuid references public.profiles(id) on delete set null,
  conferida_por_nome text,
  conferida_em timestamptz,
  lido_em timestamptz not null default now(),
  unique (document_id)
);
create index if not exists fiscal_entradas_competencia on public.fiscal_entradas (organization_id, competencia);
comment on table public.fiscal_entradas is 'Notas de entrada lidas e checadas (N-09): itens, achados, classificação proposta (tipo do item do SPED, CFOP de entrada, crédito) e a confirmação do Fiscal. situacao fora = a nota não é para a empresa.';

alter table public.fiscal_entradas enable row level security;
drop policy if exists fiscal_entradas_leitura on public.fiscal_entradas;
create policy fiscal_entradas_leitura on public.fiscal_entradas for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.fiscal_ibscbs_pode_ver()));
revoke all on public.fiscal_entradas from anon;
revoke insert, update, delete on public.fiscal_entradas from authenticated;
grant select on public.fiscal_entradas to authenticated;

-- Confirmar a classificação da nota: [{nItem, tipo, cfopEntrada}] com os tipos do SPED (ou RI, DV, BO).
create or replace function public.fiscal_entrada_confirmar(p_id uuid, p_classificacao jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  e public.fiscal_entradas;
  autor_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  invalido integer;
begin
  if org is null or not public.has_feature('fiscal.icms', 'operar') then raise exception 'Quem confirma a classificação é quem opera o ICMS.' using errcode = '42501'; end if;
  select * into e from public.fiscal_entradas where id = p_id and organization_id = org;
  if e.id is null then raise exception 'Nota não encontrada.'; end if;
  if jsonb_typeof(p_classificacao) <> 'array' or jsonb_array_length(p_classificacao) <> jsonb_array_length(e.itens) then raise exception 'Classifique todos os itens da nota.'; end if;
  select count(*) into invalido from jsonb_array_elements(p_classificacao) c
    where c->>'tipo' not in ('00', '01', '02', '06', '07', '08', '09', '10', 'RI', 'DV', 'BO') or coalesce(c->>'cfopEntrada', '') !~ '^[123][0-9]{3}$';
  if invalido > 0 then raise exception 'Cada item precisa de um tipo e de um CFOP de entrada (1xxx, 2xxx ou 3xxx).'; end if;
  update public.fiscal_entradas set classificacao = p_classificacao, conferida = true, conferida_por = public.current_profile_id(), conferida_por_nome = autor_nome, conferida_em = now() where id = p_id;
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (org, auth.uid(), public.current_profile_id(), 'fiscal', 'fiscal_entradas.conferida', 'fiscal_entradas', p_id, 'medium', jsonb_build_object('chave', e.chave, 'itens', jsonb_array_length(p_classificacao)));
  perform public.emit_module_event(org, 'fiscal', 'fiscal.entrada.conferida', 'fiscal_entradas', p_id::text,
    format('%s conferiu a classificação da NF %s de %s', coalesce(autor_nome, 'Alguém'), coalesce(e.numero, '?'), coalesce(e.emitente_nome, 'emitente')), jsonb_build_object('chave', e.chave));
end;
$$;
revoke all on function public.fiscal_entrada_confirmar(uuid, jsonb) from public, anon;
grant execute on function public.fiscal_entrada_confirmar(uuid, jsonb) to authenticated;
