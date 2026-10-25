-- WhatsApp: envios agendados (pedido do proprietário em 25/10/2026: o "bom dia" da SARA à equipe às 7h30 do dia 26).
--
-- Cada linha é um envio para UMA pessoa da allowlist de um número: texto e/ou documentos da SARA central (PDF ou
-- mensagem de voz), num horário. A tarefa de 10 em 10 minutos (scripts/sync-os-cron.mjs) envia o que venceu; quem
-- cria e cancela é só o proprietário (como o envio da central). Horário silencioso (20h–7h e domingo): o envio
-- espera o próximo horário permitido. Registro sem o conteúdo da conversa (o texto agendado fica aqui).

create table if not exists public.whatsapp_agendados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  canal_id uuid not null references public.whatsapp_canais(id) on delete cascade,
  contato_id uuid references public.whatsapp_contatos(id) on delete set null,
  para_nome text not null check (length(btrim(para_nome)) between 1 and 120),
  quando timestamptz not null,
  texto text check (texto is null or length(texto) between 1 and 4000),
  -- Documentos da SARA central (sara_documentos), na ordem: a mensagem de voz vai como áudio gravado, o resto como PDF.
  documentos uuid[] not null default '{}',
  situacao text not null default 'agendado' check (situacao in ('agendado', 'enviando', 'enviado', 'falhou', 'cancelado')),
  tentativas integer not null default 0,
  erro text check (erro is null or length(erro) <= 500),
  enviado_em timestamptz,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  constraint whatsapp_agendados_conteudo check (texto is not null or cardinality(documentos) > 0)
);

comment on table public.whatsapp_agendados is 'Envios agendados pelo WhatsApp (texto e documentos da SARA central) para uma pessoa da allowlist. Só o proprietário cria e cancela; a tarefa de 10 em 10 minutos envia. PLANO-WHATSAPP.';

create index if not exists whatsapp_agendados_fila on public.whatsapp_agendados (quando) where situacao = 'agendado';

alter table public.whatsapp_agendados enable row level security;
drop policy if exists whatsapp_agendados_dono_le on public.whatsapp_agendados;
create policy whatsapp_agendados_dono_le on public.whatsapp_agendados for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
revoke all on public.whatsapp_agendados from anon;
revoke insert, update, delete on public.whatsapp_agendados from authenticated;
grant select on public.whatsapp_agendados to authenticated;

-- Pega um envio vencido para mandar (só o servidor): sai de 'agendado' uma vez só e conta a tentativa.
create or replace function public.whatsapp_agendado_pegar(p_id uuid)
returns setof public.whatsapp_agendados language sql security definer set search_path = public as $$
  update public.whatsapp_agendados set situacao = 'enviando', tentativas = tentativas + 1
  where id = p_id and situacao = 'agendado' and quando <= now()
  returning *;
$$;
revoke all on function public.whatsapp_agendado_pegar(uuid) from public, anon, authenticated;
