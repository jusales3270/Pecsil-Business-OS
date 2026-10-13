-- Entrar com a digital no celular (passkey / WebAuthn) — 13/10/2026, pedido do proprietário.
--
-- Para todos com cadastro na plataforma, SÓ no celular. A digital (ou o rosto) nunca sai do
-- aparelho: o celular guarda uma chave privada e prova "é a pessoa certa" assinando um desafio.
-- A plataforma guarda só a chave PÚBLICA — não há dado biométrico aqui.
-- A senha continua valendo; a digital é um atalho. Cada aparelho pode ser removido pela própria
-- pessoa ou pelo proprietário. Cadastro, entrada e remoção vão para a auditoria (audit_logs).
-- Escrita só pelo servidor (chave de serviço), depois de conferir a assinatura.

create table if not exists public.access_passkeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null,
  credential_id text not null unique check (credential_id ~ '^[A-Za-z0-9_-]+$' and length(credential_id) between 16 and 1400),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]+$' and length(public_key) between 16 and 4000),
  counter bigint not null default 0 check (counter >= 0),
  transports text[],
  aparelho text check (aparelho is null or length(aparelho) <= 120),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_name text
);
create index if not exists idx_access_passkeys_user on public.access_passkeys (user_id) where revoked_at is null;
create index if not exists idx_access_passkeys_profile on public.access_passkeys (organization_id, profile_id);

-- Desafios de uso único (5 minutos). Só o servidor lê e grava.
create table if not exists public.access_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null check (length(challenge) between 16 and 200),
  kind text not null check (kind in ('registro', 'login')),
  user_id uuid,
  expires_at timestamptz not null default now() + interval '5 minutes',
  created_at timestamptz not null default now()
);
create index if not exists idx_access_passkey_challenges_exp on public.access_passkey_challenges (expires_at);

alter table public.access_passkeys enable row level security;
alter table public.access_passkey_challenges enable row level security;

-- Cada pessoa vê os próprios aparelhos; o proprietário vê os da organização (para remover).
drop policy if exists access_passkeys_read on public.access_passkeys;
create policy access_passkeys_read on public.access_passkeys for select using (
  user_id = (select auth.uid())
  or (organization_id = (select public.current_organization_id()) and (select public.is_owner()))
);
revoke insert, update, delete on public.access_passkeys from anon, authenticated;
revoke all on public.access_passkey_challenges from anon, authenticated;

-- Remover um aparelho: a própria pessoa ou o proprietário da organização. Vai para a auditoria.
create or replace function public.access_passkey_revogar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.access_passkeys%rowtype;
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  select * into p from public.access_passkeys where id = p_id for update;
  if p.id is null then raise exception 'Aparelho não encontrado.'; end if;
  if not (p.user_id = auth.uid() or (public.is_owner() and p.organization_id = public.current_organization_id())) then
    raise exception 'Sem permissão para remover este aparelho.' using errcode = '42501';
  end if;
  if p.revoked_at is not null then return; end if;
  update public.access_passkeys set revoked_at = now(), revoked_by_name = nome where id = p.id;
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (p.organization_id, auth.uid(), me, 'core', 'core.access.digital.removida', 'access_passkey', p.id, 'sensitive',
    jsonb_build_object('aparelho', p.aparelho, 'de', (select full_name from public.profiles where id = p.profile_id), 'por', nome,
      'proprio', p.user_id = auth.uid()));
end;
$$;
revoke all on function public.access_passkey_revogar(uuid) from public, anon;
grant execute on function public.access_passkey_revogar(uuid) to authenticated;
