-- WhatsApp W4 (segunda parte): confirmar pelo WhatsApp, por enquete (PLANO-WHATSAPP §5; decisão do proprietário
-- em 25/10/2026: botões e lista não chegam pelo chip, a enquete chega e o voto volta legível).
--
-- 1. sara_whatsapp_confirmar: o quadro de cada área. Para cada ação liberada, quantas vezes por dia uma pessoa pode
--    confirmá-la pela enquete. Quem decide é quem aprova a SARA da área DONA da ação (TI, Fundição, RH, Produção),
--    não a SARA que propôs. O padrão é nada liberado: sem linha, a ação segue pelo Permitir da plataforma.
-- 2. whatsapp_enquetes: cada enquete mandada por um número da plataforma. Só o PRIMEIRO voto vale (a linha sai de
--    'aberta' uma vez só); voto trocado, retirado ou repetido é ignorado. Vale 15 minutos. Sem o conteúdo da conversa.

create table if not exists public.sara_whatsapp_confirmar (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ferramenta text not null check (ferramenta ~ '^[a-z_]{3,60}$'),
  modulo text not null check (modulo ~ '^[a-z]{2,30}$'),
  ate_por_dia integer not null check (ate_por_dia between 1 and 20),
  liberado_por uuid references public.profiles(id) on delete set null,
  liberado_por_nome text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, ferramenta)
);

comment on table public.sara_whatsapp_confirmar is 'Ações que a área liberou para confirmar pela enquete do WhatsApp, com o limite por pessoa por dia. Grava só sara_whatsapp_confirmar_salvar (quem aprova a SARA da área dona da ação). PLANO-WHATSAPP §5.';

alter table public.sara_whatsapp_confirmar enable row level security;
drop policy if exists sara_whatsapp_confirmar_le on public.sara_whatsapp_confirmar;
create policy sara_whatsapp_confirmar_le on public.sara_whatsapp_confirmar for select to authenticated
  using (organization_id = (select public.current_organization_id()));
revoke all on public.sara_whatsapp_confirmar from anon;
revoke insert, update, delete on public.sara_whatsapp_confirmar from authenticated;
grant select on public.sara_whatsapp_confirmar to authenticated;

-- Liga (p_ate entre 1 e 20) ou desliga (null ou 0) uma ação. A lista de ações que PODEM ser confirmadas pelo
-- WhatsApp e a área dona de cada uma ficam aqui (as mesmas de lib/whatsapp/confirmar.ts): dinheiro, pedido de
-- material, convite a fornecedor e envio para fora nunca entram.
create or replace function public.sara_whatsapp_confirmar_salvar(p_ferramenta text, p_ate integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  dono text;
begin
  select m into dono from (values
    ('abrir_chamado_ti', 'ti'), ('registrar_incidente', 'ti'), ('atender_chamado_ti', 'ti'), ('cadastrar_equipamento', 'ti'),
    ('anotar_na_biblioteca', 'fundicao'), ('incluir_terceiro', 'rh'), ('entrada_de_producao', 'producao')) as x(f, m)
  where x.f = p_ferramenta;
  if dono is null then raise exception 'Esta ação não pode ser confirmada pelo WhatsApp.'; end if;
  if org is null or me is null or not public.has_feature(dono || '.sara', 'aprovar') then
    raise exception 'Só quem responde pela área decide o que pode ser confirmado pelo WhatsApp.' using errcode = '42501';
  end if;
  if coalesce(p_ate, 0) = 0 then
    delete from public.sara_whatsapp_confirmar where organization_id = org and ferramenta = p_ferramenta;
  else
    if p_ate < 1 or p_ate > 20 then raise exception 'O limite vai de 1 a 20 por dia.'; end if;
    insert into public.sara_whatsapp_confirmar (organization_id, ferramenta, modulo, ate_por_dia, liberado_por, liberado_por_nome, updated_at)
    values (org, p_ferramenta, dono, p_ate, me, (select full_name from public.profiles where id = me), now())
    on conflict (organization_id, ferramenta) do update
      set ate_por_dia = excluded.ate_por_dia, liberado_por = excluded.liberado_por, liberado_por_nome = excluded.liberado_por_nome, updated_at = now();
  end if;
  perform public.emit_module_event(org, dono, 'sara.whatsapp.confirmar', 'sara_whatsapp_confirmar', p_ferramenta,
    case when coalesce(p_ate, 0) = 0 then format('%s: deixa de ser confirmada pelo WhatsApp', p_ferramenta)
         else format('%s: pode ser confirmada pelo WhatsApp, até %s por dia por pessoa', p_ferramenta, p_ate) end,
    jsonb_build_object('ferramenta', p_ferramenta, 'ate_por_dia', nullif(coalesce(p_ate, 0), 0)));
end $$;
revoke all on function public.sara_whatsapp_confirmar_salvar(text, integer) from public, anon;
grant execute on function public.sara_whatsapp_confirmar_salvar(text, integer) to authenticated;

create table if not exists public.whatsapp_enquetes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  canal_id uuid not null references public.whatsapp_canais(id) on delete cascade,
  contato_id uuid references public.whatsapp_contatos(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  -- A ação que a enquete confirma; nula no teste de Fundação › WhatsApp.
  acao_id uuid references public.sara_acoes(id) on delete cascade,
  ferramenta text check (ferramenta is null or ferramenta ~ '^[a-z_]{3,60}$'),
  -- Id da enquete no WhatsApp (o voto chega com ele).
  wa_id text not null check (length(wa_id) between 1 and 120),
  opcoes jsonb not null default '[]'::jsonb,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'respondida', 'vencida')),
  resposta text check (resposta is null or length(resposta) <= 100),
  respondida_em timestamptz,
  expira_em timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  constraint whatsapp_enquetes_unica unique (canal_id, wa_id)
);

comment on table public.whatsapp_enquetes is 'Enquetes mandadas pelos números da plataforma (confirmar ação pelo WhatsApp e o teste). Só o primeiro voto vale; 15 minutos. Só o servidor grava; o proprietário lê. PLANO-WHATSAPP §5.';

create index if not exists whatsapp_enquetes_contato on public.whatsapp_enquetes (contato_id, situacao, expira_em) where contato_id is not null;
create index if not exists whatsapp_enquetes_limite on public.whatsapp_enquetes (profile_id, ferramenta, respondida_em) where situacao = 'respondida';

alter table public.whatsapp_enquetes enable row level security;
drop policy if exists whatsapp_enquetes_dono_le on public.whatsapp_enquetes;
create policy whatsapp_enquetes_dono_le on public.whatsapp_enquetes for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
revoke all on public.whatsapp_enquetes from anon;
revoke insert, update, delete on public.whatsapp_enquetes from authenticated;
grant select on public.whatsapp_enquetes to authenticated;
