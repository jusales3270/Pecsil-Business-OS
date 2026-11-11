-- Planilha Excel da SARA central (I-27, PLANO-SARA-FERRAMENTAS etapa 2, 10/11/2026): a planilha fica guardada
-- como um documento do tipo `planilha`, com o mesmo controle de quem pode abrir e o mesmo envio (plataforma e
-- WhatsApp) do relatório em PDF. O aviso no sino passa a dizer o que se abre (PDF, planilha ou áudio).
alter table public.sara_documentos drop constraint if exists sara_documentos_tipo_check;
alter table public.sara_documentos add constraint sara_documentos_tipo_check check (tipo in ('relatorio', 'carta', 'mensagem_voz', 'planilha'));

create or replace function public.sara_documento_enviar(p_documento uuid, p_para uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  d public.sara_documentos%rowtype;
  para record;
  v_id uuid;
begin
  select * into d from public.sara_documentos where id = p_documento and organization_id = org;
  if d.id is null or d.criado_por is distinct from me then raise exception 'Só quem criou o documento envia.' using errcode = '42501'; end if;
  if d.caminho is null then raise exception 'O arquivo deste documento não foi gerado.'; end if;
  select id, full_name into para from public.profiles where id = p_para and organization_id = org and status = 'active'
    and (access_expires_at is null or access_expires_at > now());
  if para.id is null then raise exception 'Esta pessoa não está ativa na plataforma.'; end if;
  insert into public.sara_documento_envios (organization_id, documento_id, para_profile_id, para_nome, canal, enviado_por, enviado_por_nome)
  values (org, d.id, para.id, para.full_name, 'plataforma', me, (select full_name from public.profiles where id = me))
  on conflict (documento_id, para_profile_id, canal) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ja_enviado', true, 'para', para.full_name); end if;
  perform public.notify_profile(org, para.id, 'sara', 'info', left(format('Documento para você: %s', d.titulo), 200),
    format('%s · %s, enviado pela SARA central. Toque para abrir %s.', d.numero, coalesce((select full_name from public.profiles where id = me), 'Plataforma'),
      case d.tipo when 'planilha' then 'a planilha' when 'mensagem_voz' then 'o áudio' else 'o PDF' end),
    '/?documentos=' || d.id::text);
  perform public.emit_module_event(org, 'sara', 'sara.documento.enviado', 'sara_documento', d.id::text,
    format('Documento %s enviado a %s', d.numero, para.full_name), jsonb_build_object('documento', d.id, 'para', para.id, 'canal', 'plataforma'));
  return jsonb_build_object('enviado', true, 'para', para.full_name, 'numero', d.numero);
end;
$$;
