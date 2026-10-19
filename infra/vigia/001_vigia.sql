-- ============================================================
-- Vigia externo da PecSil (T-03, docs/PLANO-TI.md §3.1)
-- ============================================================
-- Roda num projeto Supabase NA NUVEM, separado do Supabase do servidor da
-- fábrica: o monitor não pode ficar no servidor que ele vigia.
--
-- Duas formas de vigiar:
--   * sinal   — o servidor da fábrica avisa a cada minuto que está de pé
--               (scripts/ti-sinal-cron.mjs, tarefa do Coolify). Se o aviso
--               para por mais que a tolerância, o alvo cai.
--   * http    — daqui de fora, a cada minuto, um GET num endereço público
--               (o link da fábrica, a plataforma pela 443).
-- O cruzamento das duas dá a causa provável, por regra (sem modelo):
--   - sinal parou e o link de fora também → sem contato com a fábrica
--     (energia, servidor ou internet);
--   - sinal parou e o link responde        → o servidor ou a plataforma travou;
--   - link responde e só o HTTPS falha     → problema na porta 443/proxy;
--   - na volta, se o servidor ligou de novo durante a queda (o tempo ligado
--     é menor que a duração da queda) → o servidor reiniciou: energia ou reinício.
-- Cada queda vira um incidente com início, fim e causa (o histórico que hoje
-- não existe) e um alerta de "caiu" e de "voltou" pela API oficial do WhatsApp
-- (Meta Cloud API) — enquanto o canal não estiver configurado, o alerta fica
-- registrado como "sem_canal".
--
-- Não vai nenhum dado de pessoa: só endereços, se respondem e números do servidor.
-- Os destinatários dos alertas (telefones) ficam em vigia_destinos.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.vigia_alvos (
  id               text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  nome             text not null,
  tipo             text not null check (tipo in ('sinal', 'http')),
  url              text,
  -- http: '2xx' = só resposta 200–299 vale; 'qualquer' = qualquer resposta HTTP vale
  -- (serve para o link: um 404 do proxy já prova que a internet da fábrica chega)
  aceita           text not null default '2xx' check (aceita in ('2xx', 'qualquer')),
  token_hash       text,
  tolerancia_s     integer not null default 180 check (tolerancia_s between 60 and 172800),
  -- Causa a usar quando este sinal para (ex.: o backup diário). Vazio = a regra do servidor.
  aviso_parada     text,
  falhas_para_cair integer not null default 2 check (falhas_para_cair between 1 and 10),
  ativo            boolean not null default true,
  estado           text not null default 'desconhecido' check (estado in ('desconhecido', 'ok', 'fora')),
  estado_desde     timestamptz not null default now(),
  falhas_seguidas  integer not null default 0,
  ultimo_sinal     timestamptz,
  ultimo_info      jsonb,
  check (tipo <> 'http' or url is not null)
);

alter table public.vigia_alvos add column if not exists aviso_parada text;
alter table public.vigia_alvos drop constraint if exists vigia_alvos_tolerancia_s_check;
alter table public.vigia_alvos add constraint vigia_alvos_tolerancia_s_check check (tolerancia_s between 60 and 172800);

create table if not exists public.vigia_checagens (
  id     bigserial primary key,
  alvo   text not null references public.vigia_alvos (id) on delete cascade,
  em     timestamptz not null default now(),
  ok     boolean not null,
  status integer,
  erro   text
);
create index if not exists vigia_checagens_alvo_em on public.vigia_checagens (alvo, em desc);

-- Pedidos HTTP em andamento (o pg_net responde de forma assíncrona).
create table if not exists public.vigia_pedidos (
  pedido     bigint primary key,
  alvo       text not null references public.vigia_alvos (id) on delete cascade,
  enviado_em timestamptz not null default now()
);

create table if not exists public.vigia_incidentes (
  id      uuid primary key default gen_random_uuid(),
  alvo    text not null references public.vigia_alvos (id) on delete cascade,
  inicio  timestamptz not null,
  fim     timestamptz,
  causa   text not null,
  detalhe jsonb not null default '{}'::jsonb
);
create unique index if not exists vigia_incidente_aberto on public.vigia_incidentes (alvo) where fim is null;
create index if not exists vigia_incidentes_inicio on public.vigia_incidentes (inicio desc);

create table if not exists public.vigia_destinos (
  numero text primary key check (numero ~ '^[0-9]{10,15}$'),
  nome   text not null,
  ativo  boolean not null default true
);

-- whatsapp_api (padrão https://graph.facebook.com/v21.0), whatsapp_phone_id,
-- whatsapp_template, whatsapp_idioma (padrão pt_BR). O token fica no Vault
-- (vault.create_secret('<token>', 'vigia_whatsapp_token')), nunca aqui.
create table if not exists public.vigia_config (
  chave text primary key,
  valor text not null
);

create table if not exists public.vigia_alertas (
  id         uuid primary key default gen_random_uuid(),
  incidente  uuid references public.vigia_incidentes (id) on delete cascade,
  tipo       text not null check (tipo in ('caiu', 'voltou')),
  texto      text not null,
  numero     text not null,
  criado_em  timestamptz not null default now(),
  situacao   text not null default 'pendente' check (situacao in ('pendente', 'enviando', 'enviado', 'erro', 'sem_canal')),
  pedido     bigint,
  tentativas integer not null default 0,
  enviado_em timestamptz,
  erro       text
);
create index if not exists vigia_alertas_situacao on public.vigia_alertas (situacao, criado_em);

-- Nada é lido pela API pública: RLS ligado e sem política. O servidor da
-- fábrica só executa vigia_sinal (com o token do alvo).
alter table public.vigia_alvos enable row level security;
alter table public.vigia_checagens enable row level security;
alter table public.vigia_pedidos enable row level security;
alter table public.vigia_incidentes enable row level security;
alter table public.vigia_destinos enable row level security;
alter table public.vigia_config enable row level security;
alter table public.vigia_alertas enable row level security;

-- ------------------------------------------------------------
-- Utilidades
-- ------------------------------------------------------------
create or replace function public.vigia_hash(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

create or replace function public.vigia_hora(p timestamptz) returns text
language sql stable as $$ select to_char(p at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') $$;

create or replace function public.vigia_duracao(p_seg numeric) returns text
language sql immutable as $$
  select case
    when p_seg < 60 then round(p_seg) || ' s'
    when p_seg < 3600 then round(p_seg / 60) || ' min'
    else floor(p_seg / 3600) || ' h ' || lpad((round(p_seg / 60)::int % 60)::text, 2, '0') || ' min'
  end
$$;

-- Gera o token de um alvo de sinal e guarda só o hash. Rodar no SQL Editor do
-- projeto e copiar o resultado para a variável VIGIA_TOKEN do Coolify.
create or replace function public.vigia_novo_token(p_alvo text) returns text
language plpgsql security definer set search_path = public as $$
declare
  t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  update public.vigia_alvos set token_hash = public.vigia_hash(t) where id = p_alvo and tipo = 'sinal';
  if not found then raise exception 'alvo de sinal % não existe', p_alvo; end if;
  return t;
end $$;

-- Enfileira o alerta para cada destinatário ativo.
create or replace function public.vigia_enfileirar(p_incidente uuid, p_tipo text, p_texto text) returns void
language sql security definer set search_path = public as $$
  insert into public.vigia_alertas (incidente, tipo, texto, numero)
  select p_incidente, p_tipo, left(p_texto, 900), d.numero from public.vigia_destinos d where d.ativo
$$;

-- ------------------------------------------------------------
-- Transições (caiu / voltou)
-- ------------------------------------------------------------
create or replace function public.vigia_cair(p_alvo text, p_causa text, p_detalhe jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.vigia_alvos;
  inc uuid;
begin
  update public.vigia_alvos set estado = 'fora', estado_desde = now()
   where id = p_alvo and estado <> 'fora' returning * into a;
  if a.id is null then return; end if;
  insert into public.vigia_incidentes (alvo, inicio, causa, detalhe)
  values (p_alvo, coalesce(case when a.tipo = 'sinal' then a.ultimo_sinal end, now()), p_causa, p_detalhe)
  on conflict do nothing returning id into inc;
  if inc is not null then
    perform public.vigia_enfileirar(inc, 'caiu',
      format('PecSil: %s fora do ar desde %s. Provável: %s.', a.nome,
             public.vigia_hora(coalesce(case when a.tipo = 'sinal' then a.ultimo_sinal end, now())), p_causa));
  end if;
end $$;

create or replace function public.vigia_voltar(p_alvo text, p_causa_fim text default null, p_detalhe jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.vigia_alvos;
  i public.vigia_incidentes;
begin
  update public.vigia_alvos set estado = 'ok', estado_desde = now(), falhas_seguidas = 0
   where id = p_alvo and estado <> 'ok' returning * into a;
  if a.id is null then return; end if;
  update public.vigia_incidentes
     set fim = now(), causa = coalesce(p_causa_fim, causa), detalhe = detalhe || p_detalhe
   where alvo = p_alvo and fim is null returning * into i;
  if i.id is not null then
    perform public.vigia_enfileirar(i.id, 'voltou',
      format('PecSil: %s voltou às %s, depois de %s fora. %s.', a.nome, public.vigia_hora(now()),
             public.vigia_duracao(extract(epoch from now() - i.inicio)), i.causa));
  end if;
end $$;

-- ------------------------------------------------------------
-- Sinal de vida do servidor da fábrica (chamado pela API pública)
-- ------------------------------------------------------------
create or replace function public.vigia_sinal(p_alvo text, p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.vigia_alvos;
  ligado numeric := nullif(p_info #>> '{host,uptime_s}', '')::numeric;
  fora_por numeric;
  causa text;
begin
  select * into a from public.vigia_alvos where id = p_alvo and tipo = 'sinal' and ativo;
  if a.id is null or a.token_hash is null or a.token_hash <> public.vigia_hash(p_token) then
    raise exception 'sinal recusado' using errcode = '42501';
  end if;
  if length(coalesce(p_info, '{}'::jsonb)::text) > 8000 then p_info := '{}'::jsonb; end if;

  if a.estado = 'fora' then
    fora_por := extract(epoch from now() - coalesce(a.ultimo_sinal, a.estado_desde));
    -- O servidor ligou de novo durante a queda: o tempo ligado é menor que o tempo sem sinal.
    causa := case
      when ligado is not null and ligado < fora_por + 120 then
        format('O servidor reiniciou durante a queda (ligado há %s): queda de energia ou reinício', public.vigia_duracao(ligado))
      when ligado is not null then
        'O servidor ficou ligado o tempo todo: faltou contato (internet ou rede da fábrica)'
      else null end;
  end if;

  update public.vigia_alvos set ultimo_sinal = now(), ultimo_info = p_info where id = p_alvo;
  if a.estado <> 'ok' then
    perform public.vigia_voltar(p_alvo, causa, jsonb_build_object('ligado_s', ligado));
  end if;
  return jsonb_build_object('ok', true, 'estado', 'ok');
end $$;

-- ------------------------------------------------------------
-- Rodada de cada minuto
-- ------------------------------------------------------------
create or replace function public.vigia_ler_respostas() returns void
language plpgsql security definer set search_path = public as $$
declare
  p record;
  r record;
  passou boolean;
begin
  for p in select pe.*, al.aceita from public.vigia_pedidos pe join public.vigia_alvos al on al.id = pe.alvo loop
    select status_code, timed_out, error_msg into r from net._http_response where id = p.pedido;
    if found then
      passou := not coalesce(r.timed_out, false) and r.status_code is not null
                and (case p.aceita when '2xx' then r.status_code between 200 and 299 else r.status_code > 0 end);
      insert into public.vigia_checagens (alvo, ok, status, erro)
      values (p.alvo, passou, r.status_code, case when passou then null else coalesce(r.error_msg, case when r.timed_out then 'sem resposta em 10 s' end, 'HTTP ' || r.status_code) end);
    elsif p.enviado_em < now() - interval '2 minutes' then
      passou := false;
      insert into public.vigia_checagens (alvo, ok, erro) values (p.alvo, false, 'sem resposta');
    else
      continue;
    end if;
    update public.vigia_alvos set falhas_seguidas = case when passou then 0 else falhas_seguidas + 1 end where id = p.alvo;
    delete from public.vigia_pedidos where pedido = p.pedido;
  end loop;
end $$;

create or replace function public.vigia_avaliar() returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.vigia_alvos;
  link_fora boolean := exists (select 1 from public.vigia_alvos where tipo = 'http' and aceita = 'qualquer' and ativo and estado = 'fora');
  sinal_ok boolean := exists (select 1 from public.vigia_alvos where tipo = 'sinal' and ativo and estado = 'ok');
begin
  -- Primeiro os endereços de fora: o resultado deles explica a queda do sinal.
  for a in select * from public.vigia_alvos where ativo and tipo = 'http' order by aceita desc loop
    if a.falhas_seguidas >= a.falhas_para_cair then
      perform public.vigia_cair(a.id,
        case
          when a.aceita = 'qualquer' then 'a internet da fábrica não chega de fora (link ou roteador)'
          when sinal_ok then 'o acesso de fora pela porta 443 falhou, mas o servidor da fábrica segue avisando (HTTPS, proxy ou porta)'
          else 'sem contato com a fábrica'
        end,
        jsonb_build_object('falhas_seguidas', a.falhas_seguidas));
    elsif a.falhas_seguidas = 0 and a.estado <> 'ok' and exists (select 1 from public.vigia_checagens c where c.alvo = a.id) then
      perform public.vigia_voltar(a.id);
    end if;
  end loop;
  link_fora := exists (select 1 from public.vigia_alvos where tipo = 'http' and aceita = 'qualquer' and ativo and estado = 'fora');

  for a in select * from public.vigia_alvos where ativo and tipo = 'sinal' and ultimo_sinal is not null loop
    if a.estado <> 'fora' and now() - a.ultimo_sinal > make_interval(secs => a.tolerancia_s) then
      -- O link pode ainda não ter somado as falhas para cair: vale a última checagem
      -- dele feita depois do último sinal.
      perform public.vigia_cair(a.id,
        coalesce(a.aviso_parada, case when link_fora or exists (
               select 1 from (select c.ok from public.vigia_checagens c join public.vigia_alvos l on l.id = c.alvo
                               where l.tipo = 'http' and l.aceita = 'qualquer' and c.em > a.ultimo_sinal
                               order by c.em desc limit 1) u where not u.ok)
             then 'sem contato com a fábrica: energia, servidor ou internet'
             else 'o servidor parou de avisar, mas a fábrica responde de fora: servidor ou plataforma travados' end),
        jsonb_build_object('ultimo_sinal', a.ultimo_sinal));
    elsif a.estado = 'fora' and link_fora and a.aviso_parada is null then
      -- O link caiu depois: a causa do incidente aberto passa a ser "sem contato" (sem novo alerta).
      update public.vigia_incidentes set causa = 'sem contato com a fábrica: energia, servidor ou internet'
       where alvo = a.id and fim is null and causa like 'o servidor parou de avisar%';
    elsif a.estado = 'desconhecido' then
      update public.vigia_alvos set estado = 'ok', estado_desde = now() where id = a.id;
    end if;
  end loop;
end $$;

create or replace function public.vigia_disparar() returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.vigia_alvos;
begin
  for a in select * from public.vigia_alvos al where al.ativo and al.tipo = 'http'
             and not exists (select 1 from public.vigia_pedidos p where p.alvo = al.id) loop
    insert into public.vigia_pedidos (pedido, alvo) values (net.http_get(url => a.url, timeout_milliseconds => 10000), a.id);
  end loop;
end $$;

-- Envio pela API oficial do WhatsApp (Meta Cloud API), com modelo de mensagem
-- aprovado de um parâmetro ({{1}} = o texto do alerta).
create or replace function public.vigia_enviar() returns void
language plpgsql security definer set search_path = public as $$
declare
  api text := coalesce((select valor from public.vigia_config where chave = 'whatsapp_api'), 'https://graph.facebook.com/v21.0');
  telefone text := (select valor from public.vigia_config where chave = 'whatsapp_phone_id');
  modelo text := (select valor from public.vigia_config where chave = 'whatsapp_template');
  idioma text := coalesce((select valor from public.vigia_config where chave = 'whatsapp_idioma'), 'pt_BR');
  token text;
  al record;
  r record;
begin
  -- Respostas dos envios da rodada anterior.
  for al in select * from public.vigia_alertas where situacao = 'enviando' loop
    select status_code, timed_out, error_msg, content into r from net._http_response where id = al.pedido;
    if found then
      if r.status_code between 200 and 299 then
        update public.vigia_alertas set situacao = 'enviado', enviado_em = now(), erro = null where id = al.id;
      else
        update public.vigia_alertas set situacao = case when tentativas >= 3 then 'erro' else 'pendente' end,
               erro = left(coalesce(r.error_msg, r.content::text, 'HTTP ' || r.status_code), 300) where id = al.id;
      end if;
    end if;
  end loop;

  begin
    select decrypted_secret into token from vault.decrypted_secrets where name = 'vigia_whatsapp_token' limit 1;
  exception when others then token := null;
  end;
  if telefone is null or modelo is null or token is null then
    update public.vigia_alertas set situacao = 'sem_canal', erro = 'WhatsApp ainda não configurado' where situacao = 'pendente';
    return;
  end if;

  for al in select * from public.vigia_alertas where situacao = 'pendente' and criado_em > now() - interval '6 hours' order by criado_em limit 20 loop
    update public.vigia_alertas set situacao = 'enviando', tentativas = tentativas + 1,
      pedido = net.http_post(
        url => format('%s/%s/messages', api, telefone),
        body => jsonb_build_object(
          'messaging_product', 'whatsapp', 'to', al.numero, 'type', 'template',
          'template', jsonb_build_object('name', modelo, 'language', jsonb_build_object('code', idioma),
            'components', jsonb_build_array(jsonb_build_object('type', 'body', 'parameters',
              jsonb_build_array(jsonb_build_object('type', 'text', 'text', regexp_replace(al.texto, '\s+', ' ', 'g'))))))),
        headers => jsonb_build_object('Authorization', 'Bearer ' || token, 'Content-Type', 'application/json'),
        timeout_milliseconds => 10000)
     where id = al.id;
  end loop;
end $$;

create or replace function public.vigia_minuto() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.vigia_ler_respostas();
  perform public.vigia_avaliar();
  perform public.vigia_disparar();
  perform public.vigia_enviar();
end $$;

create or replace function public.vigia_limpar() returns void
language sql security definer set search_path = public as $$
  delete from public.vigia_checagens where em < now() - interval '60 days';
  delete from public.vigia_alertas where criado_em < now() - interval '180 days';
$$;

-- Só o sinal é público; o resto roda pelo agendador (dono do banco).
revoke all on function public.vigia_sinal(text, text, jsonb) from public;
grant execute on function public.vigia_sinal(text, text, jsonb) to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['vigia_novo_token(text)', 'vigia_enfileirar(uuid,text,text)', 'vigia_cair(text,text,jsonb)', 'vigia_voltar(text,text,jsonb)',
                           'vigia_ler_respostas()', 'vigia_avaliar()', 'vigia_disparar()', 'vigia_enviar()', 'vigia_minuto()', 'vigia_limpar()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- Agendamento: a cada minuto e a limpeza diária às 3h (UTC).
select cron.unschedule(jobid) from cron.job where jobname in ('vigia-minuto', 'vigia-limpar');
select cron.schedule('vigia-minuto', '* * * * *', 'select public.vigia_minuto()');
select cron.schedule('vigia-limpar', '0 6 * * *', 'select public.vigia_limpar()');

-- Alvos da PecSil (o sinal do servidor e os dois testes de fora).
insert into public.vigia_alvos (id, nome, tipo, url, aceita, tolerancia_s, falhas_para_cair) values
  ('servidor-pecsil', 'Servidor da fábrica', 'sinal', null, '2xx', 180, 2),
  ('link-fabrica', 'Internet da fábrica', 'http', 'http://181.224.8.145/', 'qualquer', 180, 2),
  ('plataforma-externa', 'Business OS pela internet (HTTPS)', 'http', 'https://home.pecsil.com.br/api/version', '2xx', 180, 2)
on conflict (id) do nothing;
