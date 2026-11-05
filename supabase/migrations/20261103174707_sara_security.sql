-- Consumption is a server ledger: an authenticated browser must not forge tokens.
revoke all on function public.sara_registrar(uuid, text, text, text, jsonb, text, int, int) from public, anon, authenticated;

create or replace function public.sara_registrar_servidor(
  p_organizacao uuid, p_perfil uuid, p_conversa uuid, p_modulo text,
  p_pergunta text, p_resposta text, p_ferramentas jsonb, p_modelo text,
  p_tokens_entrada int, p_tokens_saida int
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pessoa public.profiles%rowtype;
  conv uuid := p_conversa;
  resp uuid;
begin
  select * into pessoa from public.profiles where id = p_perfil and organization_id = p_organizacao
    and status = 'active' and user_id is not null and (access_expires_at is null or access_expires_at > now());
  if pessoa.id is null or not (pessoa.is_owner or exists (
    select 1 from public.user_feature_grants where organization_id = p_organizacao and profile_id = p_perfil and feature_code = p_modulo || '.sara'
  )) then raise exception 'SARA não autorizada.' using errcode = '42501'; end if;
  if p_tokens_entrada is null or p_tokens_saida is null or p_tokens_entrada not between 0 and 10000000 or p_tokens_saida not between 0 and 10000000
    then raise exception 'Consumo inválido.' using errcode = '22023'; end if;
  if p_modulo is null or p_modulo !~ '^[a-z]{2,30}$' then raise exception 'Módulo inválido.' using errcode='22023'; end if;
  if conv is null then
    insert into public.sara_conversas (organization_id, modulo, profile_id, profile_name, titulo)
    values (p_organizacao, p_modulo, pessoa.id, pessoa.full_name, left(btrim(p_pergunta),120)) returning id into conv;
  elsif not exists (select 1 from public.sara_conversas where id = conv and organization_id = p_organizacao and profile_id = p_perfil and modulo = p_modulo) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  insert into public.sara_mensagens (organization_id, conversa_id, papel, texto, created_at)
    values (p_organizacao, conv, 'pessoa', left(p_pergunta,20000), clock_timestamp());
  insert into public.sara_mensagens (organization_id, conversa_id, papel, texto, ferramentas, modelo, tokens_entrada, tokens_saida, created_at)
    values (p_organizacao, conv, 'sara', left(p_resposta,20000), coalesce(p_ferramentas,'[]'::jsonb), left(p_modelo,100), p_tokens_entrada, p_tokens_saida, clock_timestamp()) returning id into resp;
  update public.sara_conversas set updated_at = now() where id = conv;
  return jsonb_build_object('conversa',conv,'mensagem',resp);
end $$;
revoke all on function public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,int,int) from public, anon, authenticated;
grant execute on function public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,int,int) to service_role;

-- Audio is prepaid conservatively, because transcription can be invoked without a later chat.
create table public.sara_audio_uso (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  modulo text not null,
  tokens integer not null check (tokens between 1 and 200000),
  created_at timestamptz not null default now()
);
alter table public.sara_audio_uso enable row level security;
revoke all on public.sara_audio_uso from public,anon,authenticated;
grant all on public.sara_audio_uso to service_role;
create index sara_audio_uso_mes on public.sara_audio_uso(organization_id,modulo,created_at);
create index sara_audio_uso_pessoa on public.sara_audio_uso(profile_id,created_at);

-- Cast each operand before addition, so a malicious legacy int value cannot overflow first.
create or replace function public.sara_uso_mes(p_modulo text) returns bigint language sql stable security definer set search_path = '' as $$
  with inicio as (select date_trunc('month',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as t),
  org as (select public.current_organization_id() as id)
  select coalesce((select sum(m.tokens_entrada::bigint + m.tokens_saida::bigint)
    from public.sara_mensagens m join public.sara_conversas c on c.id=m.conversa_id and c.organization_id=m.organization_id
    where m.organization_id=(select id from org) and c.modulo=p_modulo and m.created_at >= (select t from inicio)),0)::bigint
    + coalesce((select sum(a.tokens::bigint) from public.sara_audio_uso a where a.organization_id=(select id from org) and a.modulo=p_modulo and a.created_at >= (select t from inicio)),0)::bigint
    + case when p_modulo='warroom' then
      coalesce((select sum(r.tokens_entrada::bigint+r.tokens_saida::bigint) from public.sara_vigia_rodadas r where r.organization_id=(select id from org) and r.created_at >= (select t from inicio)),0)::bigint
      + coalesce((select sum(r.tokens_entrada::bigint+r.tokens_saida::bigint) from public.sara_relatorios r where r.organization_id=(select id from org) and r.created_at >= (select t from inicio)),0)::bigint
      else 0 end;
$$;
revoke all on function public.sara_uso_mes(text) from public,anon;
grant execute on function public.sara_uso_mes(text) to authenticated;

create function public.sara_audio_reservar(p_organizacao uuid,p_perfil uuid,p_modulo text,p_tokens integer)
returns void language plpgsql security definer set search_path = '' as $$
declare pessoa public.profiles%rowtype; teto bigint; consumo bigint; inicio timestamptz;
begin
  select * into pessoa from public.profiles where id=p_perfil and organization_id=p_organizacao and status='active'
    and user_id is not null and (access_expires_at is null or access_expires_at>now());
  if pessoa.id is null or not (pessoa.is_owner or exists(select 1 from public.user_feature_grants where profile_id=p_perfil and organization_id=p_organizacao and feature_code=p_modulo||'.sara')) then
    raise exception 'SARA não autorizada.' using errcode='42501'; end if;
  if p_tokens is null or p_tokens not between 1 and 200000 then raise exception 'Reserva inválida.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sara-audio-profile:'||p_perfil::text,0));
  perform pg_advisory_xact_lock(hashtextextended('sara-audio:'||p_organizacao::text||':'||p_modulo,0));
  if (select count(*) from public.sara_audio_uso where profile_id=p_perfil and created_at>now()-interval '1 minute')>=6 then
    raise exception 'Limite de transcrições por minuto atingido.' using errcode='54000'; end if;
  select teto_tokens_mes into teto from public.sara_modulos where organization_id=p_organizacao and modulo=p_modulo;
  teto := coalesce(teto,2000000);
  inicio := date_trunc('month',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select coalesce(sum(m.tokens_entrada::bigint+m.tokens_saida::bigint),0) into consumo
    from public.sara_mensagens m join public.sara_conversas c on c.id=m.conversa_id and c.organization_id=m.organization_id
    where m.organization_id=p_organizacao and c.modulo=p_modulo and m.created_at>=inicio;
  consumo:=consumo+coalesce((select sum(tokens::bigint) from public.sara_audio_uso where organization_id=p_organizacao and modulo=p_modulo and created_at>=inicio),0);
  if p_modulo='warroom' then
    consumo:=consumo+coalesce((select sum(tokens_entrada::bigint+tokens_saida::bigint) from public.sara_vigia_rodadas where organization_id=p_organizacao and created_at>=inicio),0)
      +coalesce((select sum(tokens_entrada::bigint+tokens_saida::bigint) from public.sara_relatorios where organization_id=p_organizacao and created_at>=inicio),0);
  end if;
  if teto is null or consumo+p_tokens>teto then raise exception 'Teto mensal atingido.' using errcode='54000'; end if;
  insert into public.sara_audio_uso(organization_id,profile_id,modulo,tokens) values(p_organizacao,p_perfil,p_modulo,p_tokens);
end $$;
revoke all on function public.sara_audio_reservar(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.sara_audio_reservar(uuid,uuid,text,integer) to service_role;

-- Only the server may attach an object. Existing caller credentials cannot register someone else's path.
revoke all on function public.sara_documento_arquivo(uuid,text,integer,integer) from public,anon,authenticated;
create function public.sara_documento_arquivo_servidor(p_organizacao uuid,p_perfil uuid,p_documento uuid,p_caminho text,p_paginas integer,p_bytes integer)
returns void language plpgsql security definer set search_path = '' as $$
declare doc public.sara_documentos%rowtype;
begin
  select * into doc from public.sara_documentos where id=p_documento and organization_id=p_organizacao and criado_por=p_perfil and caminho is null for update;
  if doc.id is null or not exists(select 1 from public.profiles where id=p_perfil and organization_id=p_organizacao and status='active' and (access_expires_at is null or access_expires_at>now())) then
    raise exception 'Documento não encontrado.' using errcode='42501'; end if;
  if p_bytes is null or p_bytes not between 1 and 26214400 or (p_paginas is not null and p_paginas not between 1 and 10000)
    or p_caminho is null or p_caminho not like p_organizacao::text||'/'||p_documento::text||'/%'
    or p_caminho ~ '(^|/)\.\.?(/|$)' or array_length(string_to_array(p_caminho,'/'),1)<>3
    or not exists(select 1 from storage.objects where bucket_id='sara-documentos' and name=p_caminho and (metadata->>'size')::bigint=p_bytes) then
    raise exception 'Arquivo do documento inválido.' using errcode='42501'; end if;
  update public.sara_documentos set caminho=p_caminho,paginas=p_paginas,bytes=p_bytes where id=doc.id;
end $$;
revoke all on function public.sara_documento_arquivo_servidor(uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.sara_documento_arquivo_servidor(uuid,uuid,uuid,text,integer,integer) to service_role;

-- Enforce tenant equality even for service-role writes (ordinary FK checks only check the id).
create function public.whatsapp_contato_tenant_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.whatsapp_canais where id=new.canal_id and organization_id=new.organization_id)
    or (new.profile_id is not null and not exists(select 1 from public.profiles where id=new.profile_id and organization_id=new.organization_id))
    or (new.supplier_id is not null and not exists(select 1 from public.suppliers where id=new.supplier_id and organization_id=new.organization_id))
    or (new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and organization_id=new.organization_id)) then
    raise exception 'O contato e seus vínculos devem pertencer à mesma empresa.' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.whatsapp_contato_tenant_guard() from public,anon,authenticated;
-- Quarantine malformed legacy links without losing the audit history.
update public.whatsapp_contatos c set ativo=false
where not exists(select 1 from public.whatsapp_canais k where k.id=c.canal_id and k.organization_id=c.organization_id)
  or (c.profile_id is not null and not exists(select 1 from public.profiles p where p.id=c.profile_id and p.organization_id=c.organization_id))
  or (c.supplier_id is not null and not exists(select 1 from public.suppliers p where p.id=c.supplier_id and p.organization_id=c.organization_id))
  or (c.customer_id is not null and not exists(select 1 from public.customers p where p.id=c.customer_id and p.organization_id=c.organization_id));
create trigger whatsapp_contato_tenant_guard before insert or update on public.whatsapp_contatos for each row execute function public.whatsapp_contato_tenant_guard();

create function public.whatsapp_relacao_tenant_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare j jsonb:=to_jsonb(new); org uuid:=new.organization_id; cid uuid; pid uuid; alvo uuid;
begin
  if not exists(select 1 from public.whatsapp_canais where id=new.canal_id and organization_id=org) then
    raise exception 'Canal de outra empresa.' using errcode='23514'; end if;
  cid:=nullif(j->>'contato_id','')::uuid;
  pid:=nullif(j->>'profile_id','')::uuid;
  if cid is not null and not exists(select 1 from public.whatsapp_contatos c where c.id=cid and c.organization_id=org and c.canal_id=new.canal_id
    and (pid is null or c.profile_id=pid)) then raise exception 'Contato de outro canal ou empresa.' using errcode='23514'; end if;
  if pid is not null and not exists(select 1 from public.profiles where id=pid and organization_id=org) then raise exception 'Perfil de outra empresa.' using errcode='23514'; end if;
  alvo:=nullif(j->>'acao_id','')::uuid;
  if alvo is not null and not exists(select 1 from public.sara_acoes where id=alvo and organization_id=org and profile_id=pid) then
    raise exception 'Ação de outra pessoa ou empresa.' using errcode='23514'; end if;
  if tg_table_name='whatsapp_agendados' then
    for alvo in select value::uuid from jsonb_array_elements_text(coalesce(j->'documentos','[]'::jsonb)) loop
      if not exists(select 1 from public.sara_documentos where id=alvo and organization_id=org) then raise exception 'Documento de outra empresa.' using errcode='23514'; end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.whatsapp_relacao_tenant_guard() from public,anon,authenticated;
create trigger whatsapp_mensagens_tenant_guard before insert or update on public.whatsapp_mensagens for each row execute function public.whatsapp_relacao_tenant_guard();
create trigger whatsapp_enquetes_tenant_guard before insert or update on public.whatsapp_enquetes for each row execute function public.whatsapp_relacao_tenant_guard();
create trigger whatsapp_agendados_tenant_guard before insert or update on public.whatsapp_agendados for each row execute function public.whatsapp_relacao_tenant_guard();

-- Upstream configurable Vigia: a broadcast membership must share the contact's company.
-- Remove malformed configuration links; conversation/audit history is left intact.
delete from public.sara_vigia_transmissao t where not exists (
  select 1 from public.whatsapp_contatos c
  join public.whatsapp_canais k on k.id=c.canal_id and k.organization_id=c.organization_id
  join public.profiles p on p.id=c.profile_id and p.organization_id=c.organization_id
  where c.id=t.contato_id and c.organization_id=t.organization_id and c.lista='interna'
);
create unique index whatsapp_contatos_id_org on public.whatsapp_contatos(id,organization_id);
alter table public.sara_vigia_transmissao add constraint sara_vigia_transmissao_contato_empresa
  foreign key (contato_id,organization_id) references public.whatsapp_contatos(id,organization_id) on delete cascade;
create function public.sara_vigia_transmissao_tenant_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.whatsapp_contatos c
    join public.whatsapp_canais k on k.id=c.canal_id and k.organization_id=c.organization_id
    join public.profiles p on p.id=c.profile_id and p.organization_id=c.organization_id
    where c.id=new.contato_id and c.organization_id=new.organization_id and c.lista='interna'
  ) then raise exception 'A transmissão aceita apenas contatos internos da mesma empresa.' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.sara_vigia_transmissao_tenant_guard() from public,anon,authenticated;
create trigger sara_vigia_transmissao_tenant_guard before insert or update on public.sara_vigia_transmissao
  for each row execute function public.sara_vigia_transmissao_tenant_guard();
