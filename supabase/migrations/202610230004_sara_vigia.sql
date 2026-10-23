-- Vigia da SARA central (E7, J3 — docs/PLANO-MINDMASTER.md), 23/10/2026: todo dia, de segunda a sábado, a
-- SARA central varre os avisos de todos os módulos e os Parados, liga uma área à outra, ordena pelo impacto e
-- leva cada ACHADO a quem decide na área, como "Decisão para você" (Vou tratar / Não é problema / Preciso de
-- ajuda). Sem resposta, ela cobra; quando a situação sai dos avisos, ela registra o efeito.
--   * A visão da empresa inteira é a da War Room (W1: o proprietário). O achado só vai a quem também enxerga
--     os dados dele (conferido com a sessão de quem recebe, no servidor).
--   * Quem decide em cada área (ROADMAP §0) vira dado: sara_responsaveis. O proprietário muda; todos leem.
--   * Gravação dos achados e das rodadas só pelo servidor. Leem o proprietário, a auditoria e quem tem a
--     SARA central (warroom.sara). A pessoa que recebe vê o achado pelas Decisões dela.
--   * O custo da vigia entra no teto da SARA central (sara_uso_mes de 'warroom').

-- --- 1. Quem decide em cada área ----------------------------------------------------------------------------
create table if not exists public.sara_responsaveis (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null check (modulo ~ '^[a-z]{2,30}$'),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, modulo, profile_id)
);
comment on table public.sara_responsaveis is 'Quem decide em cada área (ROADMAP §0): para quem vão os achados da vigia (J3). Só o proprietário muda.';
alter table public.sara_responsaveis enable row level security;
drop policy if exists sara_responsaveis_read on public.sara_responsaveis;
create policy sara_responsaveis_read on public.sara_responsaveis for select to authenticated
using (organization_id = (select public.current_organization_id()));
drop policy if exists sara_responsaveis_dono on public.sara_responsaveis;
create policy sara_responsaveis_dono on public.sara_responsaveis for all to authenticated
using (organization_id = (select public.current_organization_id()) and (select public.is_owner()))
with check (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
grant select, insert, delete on public.sara_responsaveis to authenticated;

-- Carga inicial pelo "quem decide o quê" (ROADMAP §0), as mesmas pessoas que já recebem as decisões das áreas.
insert into public.sara_responsaveis (organization_id, modulo, profile_id)
select p.organization_id, r.modulo, p.id
from (values ('financeiro', 'Ana Claudia'), ('rh', 'Rosana'), ('almoxarifado', 'HENRIQUE FERNANDO DOS SANTOS SILVA'),
             ('compras', 'Domingo Duque'), ('compras', 'Ricardo Silva'), ('fiscal', 'JEFFERSON LUIS NEVES'),
             ('comercial', 'RAFAEL ARAUJO DOS SANTOS'), ('producao', 'RAFAEL ARAUJO DOS SANTOS'),
             ('fundicao', 'GUILHERME BARRETO DE FREITAS'), ('ti', 'Cesar Santos')) as r(modulo, nome)
join public.profiles p on p.full_name = r.nome and p.status = 'active'
on conflict do nothing;

-- --- 2. Rodadas da vigia ---------------------------------------------------------------------------------------
create table if not exists public.sara_vigia_rodadas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dia date not null,
  disparo text not null default 'agenda' check (disparo in ('agenda', 'manual')),
  situacao text not null default 'rodando' check (situacao in ('rodando', 'feita', 'falhou')),
  sinais integer not null default 0,
  achados_novos integer not null default 0,
  enviados integer not null default 0,
  modelo text,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  resumo text check (resumo is null or length(resumo) <= 2000),
  erro text check (erro is null or length(erro) <= 500),
  created_at timestamptz not null default now(),
  terminada_em timestamptz
);
-- A da agenda roda uma vez por dia; a manual (botão na War Room), quando o proprietário pedir.
create unique index if not exists uq_sara_vigia_agenda on public.sara_vigia_rodadas (organization_id, dia) where disparo = 'agenda';
create index if not exists idx_sara_vigia_rodadas on public.sara_vigia_rodadas (organization_id, created_at desc);
comment on table public.sara_vigia_rodadas is 'Rodadas da vigia da SARA central (J3). Gravação só pelo servidor.';

-- --- 3. Achados -------------------------------------------------------------------------------------------------
create table if not exists public.sara_achados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rodada_id uuid references public.sara_vigia_rodadas(id) on delete set null,
  -- Impressão da situação (as chaves dos avisos de origem): igual, não repete; mudou, é outro achado.
  chave text not null check (length(chave) between 3 and 200),
  tipo text not null check (length(tipo) between 2 and 120),
  modulo text not null check (modulo ~ '^[a-z]{2,30}$'),
  area text not null,
  titulo text not null check (length(btrim(titulo)) between 3 and 160),
  por_que text not null check (length(por_que) <= 1200),
  evidencias jsonb not null default '[]'::jsonb,
  sinais text[] not null default '{}',
  impacto text not null default 'medio' check (impacto in ('alto', 'medio', 'baixo')),
  ligacoes text[] not null default '{}',
  contencao text[] not null default '{}',
  confianca text not null default 'media' check (confianca in ('alta', 'media', 'baixa')),
  origem text not null default 'modelo' check (origem in ('modelo', 'plataforma')),
  situacao text not null default 'aberto' check (situacao in ('aberto', 'enviado', 'tratando', 'ajuda', 'nao_e_problema', 'resolvido', 'sem_responsavel', 'silenciado')),
  -- Para quem foi: [{profile_id, nome, decisao_id, resposta, cobrancas, cobrado_em}].
  envios jsonb not null default '[]'::jsonb,
  efeito text check (efeito is null or length(efeito) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolvido_em timestamptz,
  unique (organization_id, chave)
);
create index if not exists idx_sara_achados_abertos on public.sara_achados (organization_id, created_at desc) where situacao in ('aberto', 'enviado', 'tratando', 'ajuda');
comment on table public.sara_achados is 'Achados da vigia da SARA central (J3): gargalo, evidência, impacto, contenção, para quem foi e o efeito. Gravação só pelo servidor.';

alter table public.sara_vigia_rodadas enable row level security;
alter table public.sara_achados enable row level security;
drop policy if exists sara_vigia_rodadas_read on public.sara_vigia_rodadas;
create policy sara_vigia_rodadas_read on public.sara_vigia_rodadas for select to authenticated
using (organization_id = (select public.current_organization_id())
  and ((select public.is_owner()) or (select public.has_feature('fundacao.auditoria')) or (select public.has_feature('warroom.sara'))));
drop policy if exists sara_achados_read on public.sara_achados;
create policy sara_achados_read on public.sara_achados for select to authenticated
using (organization_id = (select public.current_organization_id())
  and ((select public.is_owner()) or (select public.has_feature('fundacao.auditoria')) or (select public.has_feature('warroom.sara'))));
revoke insert, update, delete on public.sara_vigia_rodadas, public.sara_achados from anon, authenticated;
grant select on public.sara_vigia_rodadas, public.sara_achados to authenticated;

-- --- 4. O custo da vigia entra no teto da SARA central ---------------------------------------------------------
create or replace function public.sara_uso_mes(p_modulo text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(m.tokens_entrada + m.tokens_saida)
    from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
    where m.organization_id = public.current_organization_id() and c.modulo = p_modulo
      and m.created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::bigint
  + case when p_modulo = 'warroom' then coalesce((select sum(r.tokens_entrada + r.tokens_saida) from public.sara_vigia_rodadas r
      where r.organization_id = public.current_organization_id()
        and r.created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::bigint else 0 end;
$$;
revoke all on function public.sara_uso_mes(text) from public, anon;
grant execute on function public.sara_uso_mes(text) to authenticated;
