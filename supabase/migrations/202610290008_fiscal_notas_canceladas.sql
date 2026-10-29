-- Fiscal: nota cancelada sai da receita e das apurações (29/10/2026).
--
--   * Até aqui, uma NF-e cancelada continuava somando: a leitura (fiscal_ibscbs_notas, fiscal_entradas) não sabia
--     do cancelamento. Agora há um lugar só para as notas canceladas, por chave, alimentado por três caminhos:
--       - o XML do evento de cancelamento (110111) guardado em Documentos (envio do mês, portal, coleta) — pelo servidor;
--       - o cancelamento que a SEFAZ distribui das notas recebidas (fiscal_dfe_eventos 110111) — gatilho;
--       - o cancelamento de nota emitida pela plataforma em produção (fiscal_nfe) — gatilho.
--   * A leitura da nota ganha `cancelada_em`: marcada quando o cancelamento chega depois, e já na leitura quando ele
--     chegou antes. Quem apura (receita do Presumido, IBS/CBS, conferência de entradas) ignora as canceladas.

create table if not exists public.fiscal_notas_canceladas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null check (chave ~ '^[0-9]{44}$'),
  cancelada_em timestamptz not null default now(),
  origem text not null check (origem in ('arquivo', 'sefaz', 'plataforma')),
  protocolo text,
  justificativa text,
  document_id uuid references public.company_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, chave)
);
comment on table public.fiscal_notas_canceladas is 'NF-e canceladas (por chave): pelo XML do evento, pela distribuição da SEFAZ ou pela emissão da plataforma. A leitura da nota sai das apurações.';
alter table public.fiscal_notas_canceladas enable row level security;
drop policy if exists fiscal_notas_canceladas_read on public.fiscal_notas_canceladas;
create policy fiscal_notas_canceladas_read on public.fiscal_notas_canceladas for select to authenticated
  using (organization_id = (select public.current_organization_id()));
revoke all on public.fiscal_notas_canceladas from anon;
revoke insert, update, delete on public.fiscal_notas_canceladas from authenticated;
grant select on public.fiscal_notas_canceladas to authenticated;

alter table public.fiscal_ibscbs_notas add column if not exists cancelada_em timestamptz;
alter table public.fiscal_entradas add column if not exists cancelada_em timestamptz;
comment on column public.fiscal_ibscbs_notas.cancelada_em is 'NF-e cancelada (fiscal_notas_canceladas): não conta em nenhuma apuração.';
comment on column public.fiscal_entradas.cancelada_em is 'NF-e cancelada (fiscal_notas_canceladas): sai da conferência.';

-- Cancelamento registrado → as leituras da mesma chave saem das apurações.
create or replace function public.fiscal_nota_cancelada_marcar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.fiscal_ibscbs_notas set cancelada_em = new.cancelada_em
   where organization_id = new.organization_id and chave = new.chave and cancelada_em is null;
  update public.fiscal_entradas set cancelada_em = new.cancelada_em
   where organization_id = new.organization_id and chave = new.chave and cancelada_em is null;
  return new;
end;
$$;
drop trigger if exists fiscal_notas_canceladas_marcar on public.fiscal_notas_canceladas;
create trigger fiscal_notas_canceladas_marcar after insert on public.fiscal_notas_canceladas
  for each row execute function public.fiscal_nota_cancelada_marcar();

-- Leitura nova de nota que já estava cancelada → já entra marcada.
create or replace function public.fiscal_leitura_ja_cancelada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.chave is not null and new.cancelada_em is null then
    select c.cancelada_em into new.cancelada_em from public.fiscal_notas_canceladas c
     where c.organization_id = new.organization_id and c.chave = new.chave;
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_ibscbs_notas_cancelada on public.fiscal_ibscbs_notas;
create trigger fiscal_ibscbs_notas_cancelada before insert on public.fiscal_ibscbs_notas
  for each row execute function public.fiscal_leitura_ja_cancelada();
drop trigger if exists fiscal_entradas_cancelada on public.fiscal_entradas;
create trigger fiscal_entradas_cancelada before insert on public.fiscal_entradas
  for each row execute function public.fiscal_leitura_ja_cancelada();

-- A SEFAZ distribuiu o cancelamento de uma nota recebida.
create or replace function public.fiscal_dfe_evento_cancelamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tp_evento = '110111' then
    insert into public.fiscal_notas_canceladas (organization_id, chave, cancelada_em, origem, protocolo)
    values (new.organization_id, new.chave, coalesce(new.data_evento, now()), 'sefaz', new.protocolo)
    on conflict (organization_id, chave) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_dfe_eventos_cancelamento on public.fiscal_dfe_eventos;
create trigger fiscal_dfe_eventos_cancelamento after insert on public.fiscal_dfe_eventos
  for each row execute function public.fiscal_dfe_evento_cancelamento();

-- Nota emitida pela plataforma cancelada (o treino não conta).
create or replace function public.fiscal_nfe_cancelamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.situacao = 'cancelada' and old.situacao is distinct from 'cancelada' and new.ambiente = 'producao' and new.chave is not null then
    insert into public.fiscal_notas_canceladas (organization_id, chave, cancelada_em, origem)
    values (new.organization_id, new.chave, coalesce(new.cancelada_em, now()), 'plataforma')
    on conflict (organization_id, chave) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_nfe_cancelada on public.fiscal_nfe;
create trigger fiscal_nfe_cancelada after update of situacao on public.fiscal_nfe
  for each row execute function public.fiscal_nfe_cancelamento();

-- O que já existe: cancelamentos distribuídos antes desta migração.
insert into public.fiscal_notas_canceladas (organization_id, chave, cancelada_em, origem, protocolo)
select e.organization_id, e.chave, coalesce(min(e.data_evento), now()), 'sefaz', min(e.protocolo)
  from public.fiscal_dfe_eventos e where e.tp_evento = '110111'
 group by e.organization_id, e.chave
on conflict (organization_id, chave) do nothing;

revoke all on function public.fiscal_nota_cancelada_marcar() from public, anon, authenticated;
revoke all on function public.fiscal_leitura_ja_cancelada() from public, anon, authenticated;
revoke all on function public.fiscal_dfe_evento_cancelamento() from public, anon, authenticated;
revoke all on function public.fiscal_nfe_cancelamento() from public, anon, authenticated;
