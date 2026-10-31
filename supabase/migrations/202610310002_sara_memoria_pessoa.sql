-- I-21 (31/10/2026, ideia do vídeo da secretária de IA): a SARA lembra da pessoa entre conversas e canais.
-- Resumo curto por conversa, refeito a cada resposta, e a preferência de resposta no WhatsApp (texto ou áudio).
-- Quem grava é só o servidor; cada pessoa lê a própria memória e mais ninguém, nem o proprietário.
-- Apagar é pelo servidor e deixa a linha marcada (esquecida), com o texto zerado: sem isso, a próxima resposta da
-- mesma conversa refaria o resumo que a pessoa mandou apagar.

create table if not exists public.sara_memoria_pessoa (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('resumo', 'preferencia')),
  -- Resumo: a conversa de origem. Preferência: nulo.
  conversa_id uuid unique references public.sara_conversas(id) on delete cascade,
  modulo text not null,
  -- Preferência: qual é ('responder_em'). Resumo: nulo.
  chave text,
  texto text not null default '' check (length(texto) <= 400),
  esquecida boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sara_memoria_pessoa_preferencia_unica unique (profile_id, chave),
  constraint sara_memoria_pessoa_coerente check ((tipo = 'resumo' and conversa_id is not null) or (tipo = 'preferencia' and chave is not null))
);
create index if not exists idx_sara_memoria_pessoa_recentes on public.sara_memoria_pessoa (profile_id, updated_at desc);

drop trigger if exists sara_memoria_pessoa_updated_at on public.sara_memoria_pessoa;
create trigger sara_memoria_pessoa_updated_at before update on public.sara_memoria_pessoa
for each row execute function public.set_updated_at();

alter table public.sara_memoria_pessoa enable row level security;
revoke all on public.sara_memoria_pessoa from anon, authenticated;
grant select on public.sara_memoria_pessoa to authenticated;

drop policy if exists sara_memoria_pessoa_minha on public.sara_memoria_pessoa;
create policy sara_memoria_pessoa_minha on public.sara_memoria_pessoa for select to authenticated
using (profile_id = public.current_profile_id() and not esquecida);
