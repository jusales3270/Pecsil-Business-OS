-- Fiscal — emissão de NF-e (Entrega 2), começando pelo ambiente de TREINO (13/10/2026, pedido do
-- proprietário: "simulação, que não gere obrigação fiscal", para o Jefferson treinar).
--
-- A nota segue sempre o mesmo caminho; muda só o ambiente:
--   treino      → só na plataforma: nada vai à SEFAZ, protocolo e DANFE simulados, sem valor fiscal;
--   homologacao → teste oficial da SEFAZ (depois do certificado A1);
--   producao    → para valer (só com o OK do proprietário).
-- Cada ambiente tem numeração própria: o treino nunca gasta a série real.
-- Portão humano: quem opera (fiscal.nfe operar) monta e valida; quem aprova (fiscal.nfe aprovar)
-- transmite, cancela, corrige e inutiliza. Escrita só pelo servidor, depois de conferir a permissão;
-- tudo vai para a auditoria.

create table if not exists public.fiscal_nfe (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ambiente text not null default 'treino' check (ambiente in ('treino', 'homologacao', 'producao')),
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'validada', 'aguardando_aprovacao', 'autorizada', 'rejeitada', 'cancelada')),
  serie int check (serie is null or serie between 0 and 999),
  numero bigint check (numero is null or numero between 1 and 999999999),
  chave text check (chave is null or chave ~ '^\d{44}$'),
  codigo_numerico text check (codigo_numerico is null or codigo_numerico ~ '^\d{8}$'),
  emissao timestamptz,
  natureza text not null default '' check (length(natureza) <= 60),
  -- A nota inteira (destinatário, itens, impostos, frete, pagamento) como foi montada.
  nota jsonb not null,
  totais jsonb,
  valor_total numeric(18,2) not null default 0,
  destinatario_nome text,
  destinatario_documento text,
  customer_id uuid references public.customers(id) on delete set null,
  -- Resultado da última validação: regras da plataforma e esquema oficial da SEFAZ.
  validacao jsonb,
  xml text,
  xml_autorizado text,
  protocolo text,
  autorizada_em timestamptz,
  motivo text,
  montada_por uuid references public.profiles(id) on delete set null,
  montada_por_nome text,
  aprovada_por uuid references public.profiles(id) on delete set null,
  aprovada_por_nome text,
  cancelada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ambiente, serie, numero)
);
create index if not exists idx_fiscal_nfe_org on public.fiscal_nfe (organization_id, ambiente, created_at desc);

create table if not exists public.fiscal_nfe_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nfe_id uuid references public.fiscal_nfe(id) on delete cascade,
  ambiente text not null check (ambiente in ('treino', 'homologacao', 'producao')),
  tipo text not null check (tipo in ('cancelamento', 'carta', 'inutilizacao')),
  sequencia int,
  texto text not null check (length(trim(texto)) between 15 and 1000),
  serie int,
  numero_inicio bigint,
  numero_fim bigint,
  protocolo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  check (tipo <> 'inutilizacao' or (serie is not null and numero_inicio is not null and numero_fim >= numero_inicio))
);
create index if not exists idx_fiscal_nfe_eventos on public.fiscal_nfe_eventos (organization_id, nfe_id, created_at);

-- Próximo número por ambiente e série.
create table if not exists public.fiscal_nfe_numeracao (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ambiente text not null check (ambiente in ('treino', 'homologacao', 'producao')),
  serie int not null check (serie between 0 and 999),
  proximo bigint not null default 1 check (proximo between 1 and 1000000000),
  updated_at timestamptz not null default now(),
  primary key (organization_id, ambiente, serie)
);

alter table public.fiscal_nfe enable row level security;
alter table public.fiscal_nfe_eventos enable row level security;
alter table public.fiscal_nfe_numeracao enable row level security;
drop policy if exists fiscal_nfe_read on public.fiscal_nfe;
create policy fiscal_nfe_read on public.fiscal_nfe for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.nfe'))
);
drop policy if exists fiscal_nfe_eventos_read on public.fiscal_nfe_eventos;
create policy fiscal_nfe_eventos_read on public.fiscal_nfe_eventos for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.nfe'))
);
drop policy if exists fiscal_nfe_numeracao_read on public.fiscal_nfe_numeracao;
create policy fiscal_nfe_numeracao_read on public.fiscal_nfe_numeracao for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.nfe'))
);
revoke insert, update, delete on public.fiscal_nfe, public.fiscal_nfe_eventos, public.fiscal_nfe_numeracao from anon, authenticated;

-- Reserva atômica do número (nunca repete nem pula). Na produção, começa do "próximo número" da
-- Configuração fiscal (para continuar a numeração do sistema anterior). Só o servidor chama.
create or replace function public.fiscal_nfe_reservar_numero(p_org uuid, p_ambiente text, p_serie int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  inicio bigint := 1;
  reservado bigint;
  fim_inutilizado bigint;
begin
  if p_ambiente = 'producao' then
    select proximo_numero into inicio from public.fiscal_series where organization_id = p_org and serie = p_serie;
    inicio := coalesce(inicio, 1);
  end if;
  insert into public.fiscal_nfe_numeracao (organization_id, ambiente, serie, proximo) values (p_org, p_ambiente, p_serie, inicio + 1)
  on conflict (organization_id, ambiente, serie) do update set proximo = public.fiscal_nfe_numeracao.proximo + 1, updated_at = now()
  returning proximo - 1 into reservado;
  -- Número dentro de uma faixa inutilizada não pode ser usado: pula para depois dela.
  select max(e.numero_fim) into fim_inutilizado from public.fiscal_nfe_eventos e
  where e.organization_id = p_org and e.ambiente = p_ambiente and e.tipo = 'inutilizacao' and e.serie = p_serie
    and reservado between e.numero_inicio and e.numero_fim;
  if fim_inutilizado is not null then
    update public.fiscal_nfe_numeracao set proximo = greatest(proximo, fim_inutilizado + 1), updated_at = now()
    where organization_id = p_org and ambiente = p_ambiente and serie = p_serie;
    return public.fiscal_nfe_reservar_numero(p_org, p_ambiente, p_serie);
  end if;
  return reservado;
end;
$$;
revoke all on function public.fiscal_nfe_reservar_numero(uuid, text, int) from public, anon, authenticated;
grant execute on function public.fiscal_nfe_reservar_numero(uuid, text, int) to service_role;
