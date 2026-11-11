-- Tarefas (I-28): correção do "Comentar". A ação se chama 'comentar', mas o andamento grava o tipo 'comentario'
-- (é o que o CHECK de tarefa_andamentos aceita). Antes desta correção todo comentário dava erro.
-- Só a função muda; as permissões (grant/revoke) de create or replace continuam as mesmas.

create or replace function public.tarefa_atualizar(p_id uuid, p_acao text, p_texto text default null, p_prazo date default null, p_responsavel uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = me);
  t public.tarefas%rowtype;
  texto text := nullif(left(btrim(coalesce(p_texto, '')), 1000), '');
  sou_resp boolean;
  sou_gestor boolean;
  nome_novo text;
  aberta boolean;
begin
  select * into t from public.tarefas where id = p_id and organization_id = org for update;
  if t.id is null or not public.tarefa_pode_ver(t.organization_id, t.responsavel_id, t.criado_por, t.modulo) then raise exception 'Tarefa não encontrada.'; end if;
  sou_resp := t.responsavel_id = me;
  sou_gestor := t.criado_por = me or public.is_owner() or (t.modulo is not null and exists (select 1 from public.sara_responsaveis r where r.organization_id = org and r.modulo = t.modulo and r.profile_id = me));
  aberta := t.situacao in ('aberta', 'em_andamento');

  if p_acao = 'comentar' then
    if texto is null then raise exception 'Escreva o comentário.'; end if;
  elsif p_acao = 'andamento' then
    if not sou_resp or not aberta then raise exception 'Só o responsável marca o andamento de uma tarefa aberta.' using errcode = '42501'; end if;
    update public.tarefas set situacao = 'em_andamento', updated_at = now() where id = t.id;
  elsif p_acao = 'feita' then
    if not (sou_resp or sou_gestor) or not aberta then raise exception 'Só o responsável ou quem criou conclui uma tarefa aberta.' using errcode = '42501'; end if;
    update public.tarefas set situacao = 'feita', concluida_em = now(), updated_at = now() where id = t.id;
  elsif p_acao = 'devolver' then
    if not sou_resp or not aberta then raise exception 'Só o responsável devolve a tarefa.' using errcode = '42501'; end if;
    if texto is null then raise exception 'Diga o motivo da devolução.'; end if;
    update public.tarefas set situacao = 'devolvida', motivo = texto, updated_at = now() where id = t.id;
  elsif p_acao = 'reabrir' then
    if not sou_gestor or aberta then raise exception 'Só quem criou reabre a tarefa.' using errcode = '42501'; end if;
    update public.tarefas set situacao = 'aberta', concluida_em = null, motivo = null, cobrancas = 0, cobrado_em = null, lembrete_em = null, updated_at = now() where id = t.id;
  elsif p_acao = 'cancelar' then
    if not sou_gestor or not aberta then raise exception 'Só quem criou cancela a tarefa.' using errcode = '42501'; end if;
    if texto is null then raise exception 'Diga o motivo do cancelamento.'; end if;
    update public.tarefas set situacao = 'cancelada', motivo = texto, updated_at = now() where id = t.id;
  elsif p_acao = 'prazo' then
    if not sou_gestor then raise exception 'Só quem criou muda o prazo.' using errcode = '42501'; end if;
    update public.tarefas set prazo = p_prazo, lembrete_em = null, cobrancas = 0, cobrado_em = null, updated_at = now() where id = t.id;
    texto := coalesce('Novo prazo: ' || to_char(p_prazo, 'DD/MM/YYYY'), 'Sem prazo') || coalesce('. ' || texto, '');
  elsif p_acao = 'responsavel' then
    if not sou_gestor then raise exception 'Só quem criou troca o responsável.' using errcode = '42501'; end if;
    nome_novo := public.tarefa_pessoa_ativa(org, p_responsavel);
    if nome_novo is null then raise exception 'O responsável não está ativo na plataforma.'; end if;
    update public.tarefas set responsavel_id = p_responsavel, responsavel_nome = nome_novo, situacao = case when situacao = 'devolvida' then 'aberta' else situacao end,
      lembrete_em = null, cobrancas = 0, cobrado_em = null, updated_at = now() where id = t.id;
    texto := format('Responsável: %s', nome_novo) || coalesce('. ' || texto, '');
    if p_responsavel <> me then
      perform public.notify_profile(org, p_responsavel, coalesce(t.modulo, 'fundacao'), 'attention', left(format('Tarefa para você: %s', t.titulo), 200),
        format('%s passou para você%s.', coalesce(meu_nome, 'Alguém'), coalesce(', até ' || to_char(t.prazo, 'DD/MM/YYYY'), '')), '/?tarefas=' || t.id::text);
    end if;
  else
    raise exception 'Ação desconhecida.';
  end if;

  insert into public.tarefa_andamentos (organization_id, tarefa_id, tipo, texto, autor_id, autor_nome)
  values (org, t.id, case p_acao when 'devolver' then 'devolvida' when 'reabrir' then 'reaberta' when 'cancelar' then 'cancelada' when 'comentar' then 'comentario' else p_acao end, texto, me, meu_nome);
  -- Quem criou fica sabendo quando o responsável conclui ou devolve.
  if p_acao in ('feita', 'devolver') and t.criado_por is not null and t.criado_por <> me then
    perform public.notify_profile(org, t.criado_por, coalesce(t.modulo, 'fundacao'), case when p_acao = 'devolver' then 'attention' else 'info' end,
      left(format('%s %s: %s', coalesce(meu_nome, 'Alguém'), case when p_acao = 'devolver' then 'devolveu a tarefa' else 'concluiu a tarefa' end, t.titulo), 200),
      coalesce(texto, ''), '/?tarefas=' || t.id::text);
  end if;
  perform public.emit_module_event(org, 'fundacao', 'fundacao.tarefa.' || p_acao, 'tarefa', t.id::text,
    format('%s · %s: %s', coalesce(meu_nome, 'Alguém'), p_acao, left(t.titulo, 120)), jsonb_build_object('texto', texto));
  return jsonb_build_object('ok', true);
end $$;
