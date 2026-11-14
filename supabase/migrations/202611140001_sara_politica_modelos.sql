-- Roteador de modelo e esforço da SARA (I-32, docs/PLANO-SARA-ROTEADOR.md), etapa 2, 14/11/2026.
-- A POLÍTICA de modelos é da empresa (o "harness business" do ECOS): que modelo e que esforço cada nível usa, se o
-- roteador está desligado, em sombra (só registra) ou ligado, quem pode a análise profunda, o teto do mês em reais e o
-- nível de cada trabalho fixo. Uma linha por organização. O catálogo de modelos (preços e regras da API) fica no
-- código (lib/sara/modelos.ts): aqui só se confere o formato; quem grava é o servidor, que valida pelo catálogo.
--   * Ler: qualquer pessoa da empresa (a SARA de cada um precisa da política); gravar: só o servidor (admin), pela
--     tela do proprietário, com auditoria.
--   * Começa DESLIGADO, com os padrões medidos na etapa 0: nada muda até o proprietário ligar.
--   * custo_usd em sara_mensagens: preenchido sozinho a partir de ferramentas.custo_usd (o servidor já grava o
--     registro inteiro por sara_registrar; não muda a assinatura). Soma do mês em sara_custo_mes(), para o teto em reais.

create table if not exists public.sara_politica_modelos (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  modo text not null default 'desligado' check (modo in ('desligado', 'sombra', 'ligado')),
  rapido_modelo text not null default 'claude-haiku-5-5' check (rapido_modelo ~ '^claude-[a-z0-9-]{3,40}$'),
  rapido_esforco text not null default 'low' check (rapido_esforco in ('low', 'medium', 'high', 'xhigh', 'max')),
  padrao_modelo text not null default 'claude-sonnet-5-5' check (padrao_modelo ~ '^claude-[a-z0-9-]{3,40}$'),
  padrao_esforco text not null default 'medium' check (padrao_esforco in ('low', 'medium', 'high', 'xhigh', 'max')),
  criterio_modelo text not null default 'claude-opus-5-5' check (criterio_modelo ~ '^claude-[a-z0-9-]{3,40}$'),
  criterio_esforco text not null default 'medium' check (criterio_esforco in ('low', 'medium', 'high', 'xhigh', 'max')),
  profundo_modelo text not null default 'claude-opus-5-5' check (profundo_modelo ~ '^claude-[a-z0-9-]{3,40}$'),
  profundo_esforco text not null default 'high' check (profundo_esforco in ('low', 'medium', 'high', 'xhigh', 'max')),
  -- Quem pode a análise profunda: o proprietário; a diretoria (cargo Diretor em Pessoas e Acessos); ou todos.
  profundo_para text not null default 'diretoria' check (profundo_para in ('proprietario', 'diretoria', 'todos')),
  teto_mes_reais numeric(10, 2) check (teto_mes_reais is null or teto_mes_reais >= 0),
  -- Nível de cada trabalho fixo (bom_dia, vigia, crescimento…); o que faltar vale o padrão do código.
  trabalhos jsonb not null default '{}'::jsonb check (jsonb_typeof(trabalhos) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by_name text
);

alter table public.sara_politica_modelos enable row level security;
revoke all on public.sara_politica_modelos from anon, authenticated;
grant select on public.sara_politica_modelos to authenticated;
drop policy if exists sara_politica_modelos_ler on public.sara_politica_modelos;
create policy sara_politica_modelos_ler on public.sara_politica_modelos for select to authenticated
using (organization_id = (select public.current_organization_id()));

insert into public.sara_politica_modelos (organization_id) select id from public.organizations on conflict do nothing;

-- Custo de cada resposta em US$ (pelo catálogo, no servidor), tirado do registro que já é gravado.
alter table public.sara_mensagens add column if not exists custo_usd numeric
  generated always as (case when jsonb_typeof(ferramentas -> 'custo_usd') = 'number' then (ferramentas ->> 'custo_usd')::numeric end) stored;

create or replace function public.sara_custo_mes()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(m.custo_usd), 0)
    from public.sara_mensagens m
   where m.organization_id = (select public.current_organization_id())
     and m.created_at >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
$$;
revoke all on function public.sara_custo_mes() from public, anon;
grant execute on function public.sara_custo_mes() to authenticated;
