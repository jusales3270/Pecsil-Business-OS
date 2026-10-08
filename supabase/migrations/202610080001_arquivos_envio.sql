-- Envio de arquivos pelos módulos: registro dos envios e gravação do extrato pela tela.
--
-- O arquivo em si NÃO é guardado (extrato tem folha e pagamentos a pessoas): fica só
-- o registro — quem enviou, quando, nome, tamanho, sha256 e o resumo do resultado —
-- para auditoria e para avisar "este arquivo já foi enviado". O XML da NF-e continua
-- guardado só onde já é (receipts.nfe_xml).

create table if not exists public.file_intakes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_code text not null,
  module_code text not null,
  kind text not null,
  file_name text not null,
  file_size bigint not null check (file_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  summary jsonb not null default '{}'::jsonb,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_file_intakes_hash on public.file_intakes (organization_id, sha256, created_at desc);
create index if not exists idx_file_intakes_module on public.file_intakes (organization_id, module_code, created_at desc);

alter table public.file_intakes enable row level security;
drop policy if exists file_intakes_read on public.file_intakes;
-- Vê os envios quem tem a funcionalidade de destino (o extrato, quem tem Bancos; a nota, quem tem ICMS…).
create policy file_intakes_read on public.file_intakes for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and public.has_feature(feature_code, 'ver')
);
grant select on public.file_intakes to authenticated;

-- Registro do envio (só pelo servidor do app, com a permissão de quem envia).
create or replace function public.file_intake_register(p_feature text, p_module text, p_kind text, p_name text, p_size bigint, p_sha256 text, p_summary jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  novo uuid;
begin
  if not public.has_feature(p_feature, 'operar') then
    raise exception 'Sem permissão para enviar este arquivo.' using errcode = '42501';
  end if;
  insert into public.file_intakes (organization_id, feature_code, module_code, kind, file_name, file_size, sha256, summary, uploaded_by_profile_id)
  values (public.current_organization_id(), p_feature, p_module, p_kind, left(p_name, 200), p_size, lower(p_sha256), coalesce(p_summary, '{}'::jsonb), public.current_profile_id())
  returning id into novo;
  return novo;
end;
$$;
revoke all on function public.file_intake_register(text, text, text, text, bigint, text, jsonb) from public;
grant execute on function public.file_intake_register(text, text, text, text, bigint, text, jsonb) to authenticated;

-- --- Extrato pela tela -----------------------------------------------------------
-- Mesma gravação da carga (finance_import_bank_entries), mas por quem opera Bancos e
-- conciliação: a organização vem da sessão, o autor fica registrado e, no último
-- lote (p_summary), os demais de Bancos e conciliação recebem aviso.
create or replace function public.finance_import_bank_statement(p_account jsonb, p_entries jsonb, p_links jsonb default '[]'::jsonb, p_summary jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  r jsonb;
begin
  if not public.has_feature('financeiro.bancos', 'operar') then
    raise exception 'Sem permissão para importar extrato.' using errcode = '42501';
  end if;
  if org is null then raise exception 'Organização não encontrada.'; end if;
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) > 1000 then
    raise exception 'Envie até 1.000 lançamentos por lote.';
  end if;
  r := public.finance_import_bank_entries(org, p_account, p_entries, coalesce(p_links, '[]'::jsonb), p_summary);
  if p_summary is not null then
    perform public.notify_feature(org, 'financeiro.bancos', 'operar', 'financeiro', 'info',
      format('Extrato importado · %s', coalesce(p_account ->> 'bank_name', 'banco')),
      format('%s lançamentos novos de %s a %s · %s conciliados automaticamente.',
        coalesce(p_summary ->> 'novos', '0'), to_char((p_summary ->> 'inicio')::date, 'DD/MM/YYYY'), to_char((p_summary ->> 'fim')::date, 'DD/MM/YYYY'),
        coalesce(p_summary ->> 'conciliados', '0')),
      '/?module=financeiro&secao=Bancos%20e%20concilia%C3%A7%C3%A3o', public.current_profile_id());
  end if;
  return r;
end;
$$;
revoke all on function public.finance_import_bank_statement(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.finance_import_bank_statement(jsonb, jsonb, jsonb, jsonb) to authenticated;
