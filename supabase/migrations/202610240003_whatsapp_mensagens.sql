-- WhatsApp W3: o registro de cada mensagem que entra e sai por um número da plataforma (PLANO-WHATSAPP §2 e §3).
--
-- Serve para: não processar duas vezes a mesma mensagem (a Evolution reenvia o aviso se a plataforma demorar);
-- guardar as tentativas de números fora da lista (só os 4 últimos dígitos, sem o conteúdo); e ligar a conversa
-- do WhatsApp à conversa da SARA (ela continua a mesma conversa nas mensagens seguintes).
-- O conteúdo das mensagens atendidas fica na conversa da SARA (sara_mensagens), não aqui.
-- Gravado só pelo servidor (service role); o proprietário lê (Fundação › WhatsApp).

create table if not exists public.whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  canal_id uuid references public.whatsapp_canais(id) on delete cascade,
  contato_id uuid references public.whatsapp_contatos(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  direcao text not null check (direcao in ('entrada', 'saida')),
  -- Id da mensagem no WhatsApp (o mesmo aviso repetido não entra duas vezes).
  wa_id text check (wa_id is null or length(wa_id) <= 120),
  -- Só os 4 últimos dígitos do número de quem mandou ou recebeu.
  numero_final text check (numero_final is null or numero_final ~ '^[0-9]{1,4}$'),
  tipo text not null default 'texto' check (tipo in ('texto', 'audio', 'imagem', 'documento', 'outro')),
  situacao text not null check (situacao in ('recebida', 'respondida', 'ignorada', 'falhou', 'enviada')),
  -- Por que foi ignorada: fora_da_lista, externa (W5), sem_sara, usuario_inativo, canal_inativo, tipo_nao_suportado.
  motivo text check (motivo is null or length(motivo) <= 40),
  conversa_id uuid references public.sara_conversas(id) on delete set null,
  erro text check (erro is null or length(erro) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_mensagens is 'Mensagens de WhatsApp que entram e saem pelos números da plataforma (sem o conteúdo; o atendido fica na conversa da SARA). Só o servidor grava; o proprietário lê. PLANO-WHATSAPP W3.';

create unique index if not exists whatsapp_mensagens_unica on public.whatsapp_mensagens (canal_id, direcao, wa_id) where wa_id is not null;
create index if not exists whatsapp_mensagens_contato on public.whatsapp_mensagens (contato_id, created_at desc) where contato_id is not null;
create index if not exists whatsapp_mensagens_canal_data on public.whatsapp_mensagens (canal_id, created_at desc);

drop trigger if exists whatsapp_mensagens_updated_at on public.whatsapp_mensagens;
create trigger whatsapp_mensagens_updated_at before update on public.whatsapp_mensagens
  for each row execute function public.set_updated_at();

alter table public.whatsapp_mensagens enable row level security;

-- Só leitura, e só do proprietário. Ninguém grava pela sessão: quem grava é o servidor (service role).
drop policy if exists whatsapp_mensagens_dono_le on public.whatsapp_mensagens;
create policy whatsapp_mensagens_dono_le on public.whatsapp_mensagens for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()));

revoke all on public.whatsapp_mensagens from anon;
revoke insert, update, delete on public.whatsapp_mensagens from authenticated;
grant select on public.whatsapp_mensagens to authenticated;
