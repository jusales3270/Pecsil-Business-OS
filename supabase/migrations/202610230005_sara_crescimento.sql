-- Crescimento da SARA central (E7, J4 — docs/PLANO-MINDMASTER.md), 23/10/2026: toda segunda-feira, a SARA
-- central entrega ao proprietário e ao conselho (quem tem a SARA central) um relatório com ideias que saem dos
-- dados, novos recursos (fomento, crédito, editais), concorrência e mercado e investimentos pontuais com a conta
-- de retorno. A pesquisa na internet leva SÓ o assunto (setor e região); a síntese não tem internet.
--   * Um relatório da agenda por semana (índice único); o proprietário também pede na War Room.
--   * Gravação só pelo servidor. Leem o proprietário, a auditoria e quem tem a SARA central (warroom.sara).
--   * O custo entra no teto da SARA central (sara_uso_mes de 'warroom'), junto com a vigia.

create table if not exists public.sara_relatorios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  semana date not null,
  disparo text not null default 'agenda' check (disparo in ('agenda', 'manual')),
  situacao text not null default 'rodando' check (situacao in ('rodando', 'feito', 'falhou')),
  -- {resumo, ideias[], recursos[], concorrencia[], investimentos[] (com a avaliação da plataforma), premissas[], descartados[]}
  conteudo jsonb,
  -- O que a pesquisa achou (com o link de cada item) e os links que a busca devolveu.
  pesquisa jsonb not null default '[]'::jsonb,
  modelo text,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  buscas integer not null default 0,
  erro text check (erro is null or length(erro) <= 500),
  pedido_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  terminada_em timestamptz
);
create unique index if not exists uq_sara_relatorios_agenda on public.sara_relatorios (organization_id, semana) where disparo = 'agenda';
create index if not exists idx_sara_relatorios on public.sara_relatorios (organization_id, created_at desc);
comment on table public.sara_relatorios is 'Relatórios de crescimento da SARA central (J4). Gravação só pelo servidor.';

alter table public.sara_relatorios enable row level security;
drop policy if exists sara_relatorios_read on public.sara_relatorios;
create policy sara_relatorios_read on public.sara_relatorios for select to authenticated
using (organization_id = (select public.current_organization_id())
  and ((select public.is_owner()) or (select public.has_feature('fundacao.auditoria')) or (select public.has_feature('warroom.sara'))));
revoke insert, update, delete on public.sara_relatorios from anon, authenticated;
grant select on public.sara_relatorios to authenticated;

-- O custo da vigia e do crescimento entra no teto da SARA central.
create or replace function public.sara_uso_mes(p_modulo text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with inicio as (select date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as t)
  select coalesce((select sum(m.tokens_entrada + m.tokens_saida)
    from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
    where m.organization_id = public.current_organization_id() and c.modulo = p_modulo and m.created_at >= (select t from inicio)), 0)::bigint
  + case when p_modulo = 'warroom' then
      coalesce((select sum(r.tokens_entrada + r.tokens_saida) from public.sara_vigia_rodadas r
        where r.organization_id = public.current_organization_id() and r.created_at >= (select t from inicio)), 0)::bigint
    + coalesce((select sum(r.tokens_entrada + r.tokens_saida) from public.sara_relatorios r
        where r.organization_id = public.current_organization_id() and r.created_at >= (select t from inicio)), 0)::bigint
    else 0 end;
$$;
revoke all on function public.sara_uso_mes(text) from public, anon;
grant execute on function public.sara_uso_mes(text) to authenticated;
