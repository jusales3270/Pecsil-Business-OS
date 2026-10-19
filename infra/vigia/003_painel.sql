-- ============================================================
-- Painel do vigia para o módulo de TI (T-06, docs/PLANO-TI.md §5)
-- ============================================================
-- Roda no MESMO projeto Supabase da nuvem do vigia (001_vigia.sql).
--
-- O Business OS lê daqui o estado dos alvos (servidor, backup, link), as quedas
-- registradas e a situação dos alertas, para o painel de saúde e o histórico de
-- incidentes. A leitura usa o token de um alvo de sinal (o VIGIA_TOKEN que o
-- contêiner do Business OS já tem para avisar que está de pé): nenhuma chave nova,
-- e as tabelas continuam fechadas para a API pública.
--
-- Não sai daqui: telefone dos destinatários, token do WhatsApp, hash de token.
-- ============================================================

create or replace function public.vigia_painel(p_alvo text, p_token text, p_dias integer default 400)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.vigia_alvos;
begin
  select * into a from public.vigia_alvos where id = p_alvo and tipo = 'sinal' and ativo;
  if a.id is null or a.token_hash is null or a.token_hash <> public.vigia_hash(p_token) then
    raise exception 'leitura recusada' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'agora', now(),
    'alvos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'nome', v.nome, 'tipo', v.tipo, 'ativo', v.ativo, 'estado', v.estado,
               'estado_desde', v.estado_desde, 'ultimo_sinal', v.ultimo_sinal, 'tolerancia_s', v.tolerancia_s,
               'info', v.ultimo_info,
               'ultima_checagem', (select jsonb_build_object('em', c.em, 'ok', c.ok, 'status', c.status, 'erro', c.erro)
                                     from public.vigia_checagens c where c.alvo = v.id order by c.em desc limit 1))
             order by v.tipo desc, v.id)
      from public.vigia_alvos v), '[]'::jsonb),
    'incidentes', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'alvo', i.alvo, 'alvo_nome', v.nome, 'inicio', i.inicio, 'fim', i.fim, 'causa', i.causa)
             order by i.inicio desc)
      from (select * from public.vigia_incidentes
             where inicio > now() - make_interval(days => least(greatest(coalesce(p_dias, 400), 1), 800))
             order by inicio desc limit 1000) i
      join public.vigia_alvos v on v.id = i.alvo), '[]'::jsonb),
    'alertas', jsonb_build_object(
      'destinatarios', (select count(*) from public.vigia_destinos where ativo),
      'canal_configurado', exists (select 1 from public.vigia_config where chave = 'whatsapp_phone_id')
                           and exists (select 1 from public.vigia_config where chave = 'whatsapp_template'),
      'ultimos_30_dias', coalesce((select jsonb_object_agg(situacao, n)
                                     from (select situacao, count(*) n from public.vigia_alertas
                                            where criado_em > now() - interval '30 days' group by situacao) s), '{}'::jsonb))
  );
end $$;

revoke all on function public.vigia_painel(text, text, integer) from public;
grant execute on function public.vigia_painel(text, text, integer) to anon, authenticated;
