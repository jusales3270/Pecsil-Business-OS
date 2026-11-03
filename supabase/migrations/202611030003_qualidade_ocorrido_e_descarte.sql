-- Qualidade, 03/11/2026 (pedido do proprietário): a hora do ocorrido e o descarte da foto.
--
-- 1. Quando aconteceu: a pessoa diz a hora (ou "agora") e ela vai no resumo e no registro (ocorrido_em).
--    Registros antigos ficam sem; a tela mostra a hora do registro no lugar.
-- 2. Foto mandada à SARA sem dizer o que fazer: a SARA oferece Registrar ou Descartar. Descartar apaga na
--    hora as fotos pendentes daquela conversa (só as da própria pessoa); o servidor apaga o arquivo.

alter table public.qualidade_nao_conformidades add column if not exists ocorrido_em timestamptz;
comment on column public.qualidade_nao_conformidades.ocorrido_em is 'Quando aconteceu, como a pessoa disse ao registrar. Vazio nos registros anteriores a 03/11/2026.';

-- --- Registro: com a hora do ocorrido ---------------------------------------------------------------
-- p: { tipo, setor, local, maquina, os, descricao, analise_sara, confianca, gravidade, quando, fotos: [uuid] }
create or replace function public.qualidade_nc_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('operar');
  me uuid := public.current_profile_id();
  nome text := public.qualidade_meu_nome();
  r public.qualidade_regras%rowtype;
  n integer;
  c public.qualidade_nao_conformidades%rowtype;
  v_tipo text := trim(coalesce(p ->> 'tipo', ''));
  v_setor text;
  v_grav text := public.qualidade_texto(p ->> 'gravidade', 40);
  v_conf text := public.qualidade_texto(p ->> 'confianca', 10);
  v_desc text := public.qualidade_texto(p ->> 'descricao', 4000);
  v_quando timestamptz := coalesce(nullif(p ->> 'quando', '')::timestamptz, now());
  v_fotos uuid[];
  v_conversa uuid;
  ligadas integer;
begin
  select * into r from public.qualidade_regras where organization_id = org;
  if r.organization_id is null then raise exception 'As regras de não conformidade ainda não foram configuradas.'; end if;
  if not (v_tipo = any (r.tipos)) then raise exception 'Escolha um dos tipos da lista.'; end if;
  v_setor := public.qualidade_setor(org, p ->> 'setor');
  if length(coalesce(v_desc, '')) < 3 then raise exception 'Descreva o que aconteceu.'; end if;
  if v_quando > now() + interval '10 minutes' then raise exception 'A hora do ocorrido está no futuro.'; end if;
  if v_quando < now() - interval '400 days' then raise exception 'A hora do ocorrido é de mais de um ano atrás.'; end if;
  if v_conf is not null and v_conf not in ('alta', 'media', 'baixa') then v_conf := null; end if;
  if not r.usar_gravidade then v_grav := null;
  elsif v_grav is null or not (v_grav = any (r.gravidades)) then raise exception 'Escolha uma das gravidades da lista.'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_fotos from jsonb_array_elements_text(coalesce(p -> 'fotos', '[]'::jsonb)) x;
  select conversa_id into v_conversa from public.qualidade_nc_fotos where id = any (v_fotos) and autor_id = me and nc_id is null limit 1;

  perform pg_advisory_xact_lock(hashtext('qualidade_nc:' || org::text));
  select coalesce(max(numero), 0) + 1 into n from public.qualidade_nao_conformidades where organization_id = org;
  insert into public.qualidade_nao_conformidades (organization_id, numero, tipo, setor, local, maquina, os_codigo, descricao, analise_sara, confianca, gravidade, ocorrido_em, conversa_id, autor_id, autor_nome)
  values (org, n, v_tipo, v_setor, public.qualidade_texto(p ->> 'local', 160), public.qualidade_texto(p ->> 'maquina', 160), public.qualidade_texto(p ->> 'os', 40),
    v_desc, public.qualidade_texto(p ->> 'analise_sara', 2000), v_conf, v_grav, v_quando, v_conversa, me, nome)
  returning * into c;
  update public.qualidade_nc_fotos set nc_id = c.id where id = any (v_fotos) and organization_id = org and autor_id = me and nc_id is null;
  get diagnostics ligadas = row_count;
  insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto)
  values (org, c.id, me, nome, 'registro', format('Registrou a não conformidade pela SARA (%s).', case ligadas when 0 then 'sem foto' when 1 then '1 foto' else ligadas || ' fotos' end));

  perform public.notify_feature(org, 'qualidade.nao_conformidades', 'aprovar', 'qualidade', 'attention',
    format('Não conformidade NC-%s · %s', c.numero, c.tipo), left(format('%s (%s): %s', nome, c.setor, c.descricao), 400), '/?module=qualidade&secao=N%C3%A3o%20conformidades', me);
  perform public.emit_module_event(org, 'qualidade', 'qualidade.nc.registrada', 'qualidade_nc', c.id::text,
    format('Não conformidade NC-%s registrada: %s, %s', c.numero, c.tipo, c.setor),
    jsonb_build_object('numero', c.numero, 'tipo', c.tipo, 'setor', c.setor, 'fotos', ligadas));
  return jsonb_build_object('id', c.id, 'numero', c.numero, 'fotos', ligadas);
end $$;
revoke all on function public.qualidade_nc_registrar(jsonb) from public, anon;
grant execute on function public.qualidade_nc_registrar(jsonb) to authenticated;

-- --- Andamento: corrigir também a hora ------------------------------------------------------------------
create or replace function public.qualidade_nc_acao(p_nc uuid, p_acao text, p_texto text default null, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('operar');
  me uuid := public.current_profile_id();
  nome text := public.qualidade_meu_nome();
  c public.qualidade_nao_conformidades%rowtype;
  r public.qualidade_regras%rowtype;
  texto text := public.qualidade_texto(p_texto, 2000);
  v_tipo text; v_setor text; v_local text; v_maq text; v_os text; v_desc text; v_grav text; v_quando timestamptz;
  mudou text[] := '{}';
begin
  select * into c from public.qualidade_nao_conformidades where id = p_nc and organization_id = org for update;
  if c.id is null then raise exception 'Não conformidade não encontrada.'; end if;

  if p_acao = 'comentar' then
    if texto is null then raise exception 'Escreva o comentário.'; end if;
    insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto) values (org, c.id, me, nome, 'comentario', texto);

  elsif p_acao = 'corrigir' then
    if c.situacao <> 'aberta' then raise exception 'Reabra a não conformidade para corrigir.'; end if;
    select * into r from public.qualidade_regras where organization_id = org;
    v_tipo := coalesce(public.qualidade_texto(p_extra ->> 'tipo', 120), c.tipo);
    if v_tipo <> c.tipo and not (v_tipo = any (r.tipos)) then raise exception 'Escolha um dos tipos da lista.'; end if;
    v_setor := case when p_extra ? 'setor' then public.qualidade_setor(org, p_extra ->> 'setor') else c.setor end;
    v_local := case when p_extra ? 'local' then public.qualidade_texto(p_extra ->> 'local', 160) else c.local end;
    v_maq := case when p_extra ? 'maquina' then public.qualidade_texto(p_extra ->> 'maquina', 160) else c.maquina end;
    v_os := case when p_extra ? 'os' then public.qualidade_texto(p_extra ->> 'os', 40) else c.os_codigo end;
    v_desc := coalesce(public.qualidade_texto(p_extra ->> 'descricao', 4000), c.descricao);
    if length(v_desc) < 3 then raise exception 'Descreva o que aconteceu.'; end if;
    v_quando := case when nullif(p_extra ->> 'quando', '') is not null then (p_extra ->> 'quando')::timestamptz else c.ocorrido_em end;
    if v_quando > now() + interval '10 minutes' then raise exception 'A hora do ocorrido está no futuro.'; end if;
    v_grav := case when r.usar_gravidade and p_extra ? 'gravidade' then public.qualidade_texto(p_extra ->> 'gravidade', 40) else c.gravidade end;
    if v_grav is distinct from c.gravidade and v_grav is not null and not (v_grav = any (r.gravidades)) then raise exception 'Escolha uma das gravidades da lista.'; end if;
    if v_tipo is distinct from c.tipo then mudou := mudou || format('tipo: %s → %s', c.tipo, v_tipo); end if;
    if v_setor is distinct from c.setor then mudou := mudou || format('setor: %s → %s', c.setor, v_setor); end if;
    if v_local is distinct from c.local then mudou := mudou || format('local: %s → %s', coalesce(c.local, '—'), coalesce(v_local, '—')); end if;
    if v_maq is distinct from c.maquina then mudou := mudou || format('máquina: %s → %s', coalesce(c.maquina, '—'), coalesce(v_maq, '—')); end if;
    if v_os is distinct from c.os_codigo then mudou := mudou || format('OS: %s → %s', coalesce(c.os_codigo, '—'), coalesce(v_os, '—')); end if;
    if v_grav is distinct from c.gravidade then mudou := mudou || format('gravidade: %s → %s', coalesce(c.gravidade, '—'), coalesce(v_grav, '—')); end if;
    if v_quando is distinct from c.ocorrido_em then mudou := mudou || format('quando: %s → %s', coalesce(to_char(c.ocorrido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '—'), to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')); end if;
    if v_desc is distinct from c.descricao then mudou := mudou || 'descrição'::text; end if;
    if cardinality(mudou) = 0 then return; end if;
    update public.qualidade_nao_conformidades set tipo = v_tipo, setor = v_setor, local = v_local, maquina = v_maq, os_codigo = v_os, descricao = v_desc, gravidade = v_grav, ocorrido_em = v_quando, updated_at = now() where id = c.id;
    insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'correcao', left('Corrigiu ' || array_to_string(mudou, '; ') || coalesce('. ' || texto, ''), 2000));

  elsif p_acao in ('encerrar', 'reabrir', 'cancelar') then
    if p_acao = 'reabrir' and c.situacao = 'aberta' then raise exception 'Esta não conformidade já está aberta.'; end if;
    if p_acao <> 'reabrir' and c.situacao <> 'aberta' then raise exception 'Esta não conformidade não está aberta.'; end if;
    if p_acao = 'cancelar' and texto is null then raise exception 'Diga por que está cancelando.'; end if;
    update public.qualidade_nao_conformidades
    set situacao = case p_acao when 'encerrar' then 'encerrada' when 'cancelar' then 'cancelada' else 'aberta' end,
        encerrada_em = case when p_acao = 'reabrir' then null else now() end, updated_at = now()
    where id = c.id;
    insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'situacao', (case p_acao when 'encerrar' then 'Encerrou' when 'cancelar' then 'Cancelou' else 'Reabriu' end) || coalesce(': ' || texto, '.'));

  else
    raise exception 'Ação inválida.';
  end if;

  perform public.emit_module_event(org, 'qualidade',
    case p_acao when 'comentar' then 'qualidade.nc.comentada' when 'corrigir' then 'qualidade.nc.corrigida' when 'encerrar' then 'qualidade.nc.encerrada' when 'cancelar' then 'qualidade.nc.cancelada' else 'qualidade.nc.reaberta' end,
    'qualidade_nc', c.id::text, format('Não conformidade NC-%s: %s', c.numero, p_acao), jsonb_build_object('numero', c.numero));
end $$;
revoke all on function public.qualidade_nc_acao(uuid, text, text, jsonb) from public, anon;
grant execute on function public.qualidade_nc_acao(uuid, text, text, jsonb) to authenticated;

-- --- Descartar as fotos pendentes de uma conversa ----------------------------------------------------------
create or replace function public.qualidade_fotos_descartar(p_conversa uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('operar');
  caminhos text[];
begin
  with apagadas as (
    delete from public.qualidade_nc_fotos
    where organization_id = org and autor_id = public.current_profile_id() and nc_id is null and conversa_id = p_conversa
    returning storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into caminhos from apagadas;
  return caminhos;
end $$;
revoke all on function public.qualidade_fotos_descartar(uuid) from public, anon;
grant execute on function public.qualidade_fotos_descartar(uuid) to authenticated;

notify pgrst, 'reload schema';
