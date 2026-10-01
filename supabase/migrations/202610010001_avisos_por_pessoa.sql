-- Avisos por pessoa: o sino do topo deixa de mostrar só eventos da sessão e passa
-- a ler public.notifications (uma linha por destinatário, RLS "só os meus").
--
-- Quem é avisado sai da PERMISSÃO, não do nome: "quem cota" (compras.cotacoes
-- operar), "quem paga" (financeiro.pagar aprovar), "quem recebe material"
-- (almoxarifado.recebimento operar). Trocar a pessoa do cargo é trocar a
-- permissão em Pessoas e Acessos; nenhum código muda.
--
-- O proprietário tem acesso a tudo, mas só recebe aviso se tiver a permissão
-- concedida explicitamente — senão receberia cada passo de cada fluxo.

create index if not exists idx_notifications_recipient
  on public.notifications (recipient_profile_id, created_at desc);

create index if not exists idx_notifications_unread
  on public.notifications (recipient_profile_id) where read_at is null;

create or replace function public.notify_feature(
  p_org uuid,
  p_feature text,
  p_level public.access_level,
  p_module text,
  p_severity text,
  p_title text,
  p_body text,
  p_action_url text default null,
  p_except_profile uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  sent int;
begin
  insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
  select distinct p_org, g.profile_id, p_module, p_severity, p_title, p_body, p_action_url
  from public.user_feature_grants g
  join public.profiles p on p.id = g.profile_id
  where g.organization_id = p_org
    and g.feature_code = p_feature
    and g.level >= p_level
    and p.status = 'active'
    and (p.access_expires_at is null or p.access_expires_at > now())
    and (p_except_profile is null or g.profile_id <> p_except_profile);
  get diagnostics sent = row_count;
  return sent;
end;
$$;

-- Só os gatilhos e funções do próprio banco avisam; o navegador nunca chama direto.
revoke all on function public.notify_feature(uuid, text, public.access_level, text, text, text, text, text, uuid) from public, anon, authenticated;
