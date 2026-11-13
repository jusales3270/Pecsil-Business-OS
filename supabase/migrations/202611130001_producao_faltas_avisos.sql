-- Produção › Falta de peças na chegada ao Desbaste (Forja), 13/11/2026.
--
-- Pedido do proprietário: quando o Desbaste conta menos peças do que a Fundição entregou, o chefe
-- (Domingo) fica sabendo pelo WhatsApp e vê na tela da Produção. A tela lê ao vivo o painel da Forja;
-- aqui fica só o controle de quais faltas já foram avisadas, para a sincronização de 10 em 10 minutos
-- não mandar a mesma mensagem duas vezes. Uma linha por falta e por tipo de aviso (abriu / resolveu).
-- Quem escreve é só a sincronização (chave de serviço).

create table if not exists public.producao_faltas_avisos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  forja_falta_id text not null,
  tipo text not null check (tipo in ('aberta', 'resolvida')),
  resumo text,
  avisado_em timestamptz not null default now(),
  primary key (organization_id, forja_falta_id, tipo)
);
comment on table public.producao_faltas_avisos is 'Faltas de peças na chegada ao Desbaste (Forja) já avisadas ao chefe: evita aviso repetido.';
alter table public.producao_faltas_avisos enable row level security;
revoke all on public.producao_faltas_avisos from anon, authenticated;

-- Quem recebe os avisos de falta: área "faltas" em quem decide o quê (o proprietário pode trocar).
insert into public.sara_responsaveis (organization_id, modulo, profile_id)
select p.organization_id, 'faltas', p.id
from public.profiles p
where p.full_name = 'Domingo Duque' and p.status = 'active'
on conflict do nothing;
