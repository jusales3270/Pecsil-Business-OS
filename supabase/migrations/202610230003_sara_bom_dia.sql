-- Bom dia da SARA (E7, J2 — docs/PLANO-MINDMASTER.md), 23/10/2026: às 7h, de segunda a sábado, cada pessoa
-- com a SARA liberada recebe um resumo do que importa hoje (avisos dos módulos, decisões e ações esperando por
-- ela, o que as guias dela fizeram). Montado com a sessão DELA (só o que ela já vê), chega no sino e abre a SARA.
--   * Esta tabela é a fila e o registro: uma linha por pessoa por dia (não manda duas vezes).
--   * Quem grava é só o servidor (tarefa de 10 em 10 minutos, /api/sara/bom-dia/rodar). A pessoa lê as dela;
--     o proprietário e a auditoria leem todas (para acompanhar quem recebeu).
--   * O texto fica na conversa da SARA (sara_registrar, com a sessão da pessoa): o custo entra no módulo.

create table if not exists public.sara_bom_dia (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  dia date not null,
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'rodando', 'feita', 'vazia', 'sem_sara', 'falhou')),
  modulo text check (modulo is null or modulo ~ '^[a-z]{2,30}$'),
  conversa_id uuid references public.sara_conversas(id) on delete set null,
  mensagem_id uuid references public.sara_mensagens(id) on delete set null,
  itens integer not null default 0,
  urgentes integer not null default 0,
  resumo text check (resumo is null or length(resumo) <= 600),
  erro text check (erro is null or length(erro) <= 500),
  created_at timestamptz not null default now(),
  iniciada_em timestamptz,
  terminada_em timestamptz,
  unique (profile_id, dia)
);
create index if not exists idx_sara_bom_dia_fila on public.sara_bom_dia (created_at) where situacao = 'na_fila';
create index if not exists idx_sara_bom_dia_dia on public.sara_bom_dia (organization_id, dia desc);
comment on table public.sara_bom_dia is 'Bom dia da SARA (J2): fila e registro, uma linha por pessoa por dia. Gravação só pelo servidor.';

alter table public.sara_bom_dia enable row level security;
drop policy if exists sara_bom_dia_read on public.sara_bom_dia;
create policy sara_bom_dia_read on public.sara_bom_dia for select to authenticated
using (organization_id = (select public.current_organization_id())
  and (profile_id = (select public.current_profile_id()) or (select public.is_owner()) or (select public.has_feature('fundacao.auditoria'))));
revoke insert, update, delete on public.sara_bom_dia from anon, authenticated;
grant select on public.sara_bom_dia to authenticated;
