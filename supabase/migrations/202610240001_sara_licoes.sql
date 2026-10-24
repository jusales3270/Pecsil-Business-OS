-- J5 da SARA central (docs/PLANO-MINDMASTER.md §4e, 24/10/2026): a SARA aprende com as respostas e o efeito.
--   sara_licoes  o que a empresa ensinou à SARA. Duas origens:
--                * conversa: alguém corrige a SARA central ou explica uma regra do negócio; ela propõe a lição;
--                * vigia: a área disse "Não é problema" várias vezes ao mesmo tipo de achado; a vigia pergunta
--                  se pode parar de avisar.
--                Quem decide é a ÁREA (sara_responsaveis), pelas Decisões: a lição só vale aprovada. Se quem
--                ensinou já responde pela área, entra direto. A área ou o proprietário desativa quando quiser.
--                Lição é contexto, nunca dado: nenhum número sai dela (os números vêm das consultas).
-- Leitura: o proprietário, a auditoria, quem tem a SARA central e quem responde pela área da lição.
-- Gravação: só pelas funções.

create table if not exists public.sara_licoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null check (modulo ~ '^[a-z]{2,30}$'),
  origem text not null default 'conversa' check (origem in ('conversa', 'vigia')),
  -- contexto: entra no texto das SARAs; silenciar: a vigia não manda mais aquele tipo de achado.
  efeito text not null default 'contexto' check (efeito in ('contexto', 'silenciar')),
  texto text not null check (length(btrim(texto)) between 10 and 500),
  tipo_achado text check (tipo_achado is null or length(tipo_achado) between 2 and 120),
  evidencia jsonb not null default '{}'::jsonb,
  ensinada_por uuid references public.profiles(id) on delete set null,
  ensinada_por_nome text,
  conversa_id uuid references public.sara_conversas(id) on delete set null,
  situacao text not null default 'proposta' check (situacao in ('proposta', 'ativa', 'recusada', 'desativada')),
  -- Para quem a decisão foi pedida (nomes), e quem decidiu.
  pedida_a text[] not null default '{}',
  decidida_por_nome text,
  decidida_em timestamptz,
  nota text check (nota is null or length(nota) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (efeito = 'contexto' or tipo_achado is not null)
);
-- A mesma lição não é proposta duas vezes enquanto está em aberto ou valendo.
create unique index if not exists uq_sara_licoes_texto on public.sara_licoes (organization_id, modulo, md5(lower(btrim(texto)))) where situacao in ('proposta', 'ativa');
create unique index if not exists uq_sara_licoes_silenciar on public.sara_licoes (organization_id, tipo_achado) where efeito = 'silenciar' and situacao in ('proposta', 'ativa');
create index if not exists idx_sara_licoes_ativas on public.sara_licoes (organization_id, modulo) where situacao = 'ativa';
comment on table public.sara_licoes is 'O que a empresa ensinou à SARA (J5): lições propostas na conversa ou pela vigia, aprovadas pela área. Gravação só pelas funções.';

alter table public.sara_licoes enable row level security;
drop policy if exists sara_licoes_read on public.sara_licoes;
create policy sara_licoes_read on public.sara_licoes for select to authenticated
using (organization_id = (select public.current_organization_id())
  and ((select public.is_owner()) or (select public.has_feature('fundacao.auditoria')) or (select public.has_feature('warroom.sara'))
    or exists (select 1 from public.sara_responsaveis r where r.organization_id = sara_licoes.organization_id and r.modulo = sara_licoes.modulo
      and r.profile_id = (select public.current_profile_id()))));
revoke insert, update, delete on public.sara_licoes from anon, authenticated;
grant select on public.sara_licoes to authenticated;

-- --- Criar (núcleo): grava a lição e pede a decisão a quem responde pela área -----------------------------------
-- Só o servidor chama direto (a vigia, com a chave de serviço); a pessoa chama sara_licao_propor.
create or replace function public.sara_licao_criar(
  p_org uuid, p_modulo text, p_texto text, p_origem text default 'conversa', p_efeito text default 'contexto',
  p_tipo_achado text default null, p_ensinou uuid default null, p_conversa uuid default null, p_evidencia jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_nome text;
  v_id uuid;
  v_resp uuid[];
  v_nomes text[];
  v_rotulo text;
  r record;
begin
  if p_modulo is null or p_modulo !~ '^[a-z]{2,30}$' then raise exception 'Área inválida.'; end if;
  if length(v_texto) < 10 or length(v_texto) > 500 then raise exception 'A lição precisa ter de 10 a 500 caracteres.'; end if;
  -- Dado pessoal não entra numa lição (ela vai para o texto de várias SARAs).
  if v_texto ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}' or v_texto ~* '\m(cpf|pis|rg)\M\s*:?\s*\d' then raise exception 'A lição não pode ter CPF, PIS ou documento de pessoa.'; end if;
  select full_name into v_nome from public.profiles where id = p_ensinou;
  select array_agg(r2.profile_id), array_agg(p2.full_name) into v_resp, v_nomes
    from public.sara_responsaveis r2 join public.profiles p2 on p2.id = r2.profile_id and p2.status = 'active'
    where r2.organization_id = p_org and r2.modulo = p_modulo;

  insert into public.sara_licoes (organization_id, modulo, origem, efeito, texto, tipo_achado, evidencia, ensinada_por, ensinada_por_nome, conversa_id, pedida_a)
  values (p_org, p_modulo, coalesce(p_origem, 'conversa'), coalesce(p_efeito, 'contexto'), v_texto, p_tipo_achado, coalesce(p_evidencia, '{}'::jsonb),
    p_ensinou, coalesce(v_nome, case when p_origem = 'vigia' then 'Vigia da SARA' end), p_conversa, coalesce(v_nomes, '{}'))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('situacao', 'ja_existe');
  end if;

  -- Quem ensinou responde pela área: a lição entra direto.
  if p_ensinou is not null and p_ensinou = any (coalesce(v_resp, '{}')) then
    update public.sara_licoes set situacao = 'ativa', decidida_por_nome = v_nome, decidida_em = now(), pedida_a = '{}', updated_at = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'situacao', 'ativa', 'para', '[]'::jsonb);
  end if;
  if v_resp is null then
    return jsonb_build_object('id', v_id, 'situacao', 'proposta', 'para', '[]'::jsonb, 'aviso', 'Esta área ainda não tem quem decide cadastrado.');
  end if;

  v_rotulo := initcap(p_modulo);
  for r in select unnest(v_resp) as pid loop
    insert into public.decisoes (organization_id, chave, origem, modulo, assunto, pergunta, detalhes, opcoes, para_profile_id, para_nome, criada_por_nome)
    select p_org, 'licao.' || v_id::text, 'sara.licao', p_modulo,
      left(case when p_efeito = 'silenciar' then format('A vigia pode parar de avisar? (%s)', v_rotulo) else format('A SARA aprendeu certo? (%s)', v_rotulo) end, 160),
      case when p_efeito = 'silenciar'
        then format('A área respondeu "Não é problema" várias vezes a este aviso. A vigia pode parar de mandá-lo? %s', v_texto)
        else format('%s ensinou à SARA: "%s". A SARA pode usar isso nas respostas? Aprovando, vale para todas as SARAs que tratam desta área (é contexto, não muda nenhum número).', coalesce(v_nome, 'Alguém'), v_texto) end,
      case when p_efeito = 'silenciar' then array['Para a vigia voltar a avisar, mude a sua resposta aqui mesmo, quando quiser.'] else array['Para desfazer depois, mude a sua resposta aqui mesmo.', 'A lição é contexto para as respostas: os números continuam vindo das consultas.'] end,
      case when p_efeito = 'silenciar' then array['Parar de avisar', 'Continuar avisando'] else array['Aprovar', 'Não aprovar'] end,
      p.id, p.full_name, coalesce(v_nome, 'Vigia da SARA')
    from public.profiles p where p.id = r.pid
    on conflict do nothing;
  end loop;
  return jsonb_build_object('id', v_id, 'situacao', 'proposta', 'para', to_jsonb(v_nomes));
end;
$$;
revoke all on function public.sara_licao_criar(uuid, text, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sara_licao_criar(uuid, text, text, text, text, text, uuid, uuid, jsonb) to service_role;

-- --- Propor (a SARA central, na conversa, com a sessão de quem ensinou) -----------------------------------------
create or replace function public.sara_licao_propor(p_modulo text, p_texto text, p_conversa uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  eu uuid := public.current_profile_id();
begin
  if org is null or eu is null then raise exception 'Sessão inválida.'; end if;
  if not (public.is_owner() or public.has_feature('warroom.sara')) then raise exception 'Sem permissão para ensinar a SARA central.'; end if;
  if p_conversa is not null and not exists (select 1 from public.sara_conversas c where c.id = p_conversa and c.profile_id = eu) then p_conversa := null; end if;
  return public.sara_licao_criar(org, p_modulo, p_texto, 'conversa', 'contexto', null, eu, p_conversa, '{}'::jsonb);
end;
$$;
revoke all on function public.sara_licao_propor(text, text, uuid) from public, anon;
grant execute on function public.sara_licao_propor(text, text, uuid) to authenticated;

-- --- A resposta da área decide a lição (a última resposta vale; desativada só volta por nova lição) --------------
create or replace function public.sara_licao_pela_decisao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.origem <> 'sara.licao' or new.resposta is null or new.resposta is not distinct from old.resposta then return new; end if;
  begin v_id := substring(new.chave from 7)::uuid; exception when others then return new; end;
  update public.sara_licoes
     set situacao = case when new.resposta in ('Aprovar', 'Parar de avisar') then 'ativa' else 'recusada' end,
         decidida_por_nome = new.para_nome, decidida_em = now(), nota = new.nota, updated_at = now()
   where id = v_id and organization_id = new.organization_id and situacao in ('proposta', 'ativa', 'recusada');
  return new;
end;
$$;
drop trigger if exists trg_sara_licao_pela_decisao on public.decisoes;
create trigger trg_sara_licao_pela_decisao after update of resposta on public.decisoes
for each row execute function public.sara_licao_pela_decisao();

-- --- Desativar: o proprietário ou quem responde pela área -------------------------------------------------------
create or replace function public.sara_licao_desativar(p_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  eu uuid := public.current_profile_id();
  l public.sara_licoes;
  v_nome text;
begin
  select * into l from public.sara_licoes where id = p_id and organization_id = org;
  if l.id is null then raise exception 'Lição não encontrada.'; end if;
  if not (public.is_owner() or exists (select 1 from public.sara_responsaveis r where r.organization_id = org and r.modulo = l.modulo and r.profile_id = eu)) then
    raise exception 'Só quem responde pela área (ou o proprietário) desativa uma lição.';
  end if;
  if l.situacao not in ('ativa', 'proposta') then raise exception 'A lição já não está valendo.'; end if;
  select full_name into v_nome from public.profiles where id = eu;
  update public.sara_licoes set situacao = 'desativada', decidida_por_nome = v_nome, decidida_em = now(),
    nota = nullif(left(btrim(coalesce(p_nota, '')), 1000), ''), updated_at = now() where id = l.id;
end;
$$;
revoke all on function public.sara_licao_desativar(uuid, text) from public, anon;
grant execute on function public.sara_licao_desativar(uuid, text) to authenticated;
