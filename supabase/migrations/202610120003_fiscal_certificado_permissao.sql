-- Fiscal — permissão própria para o certificado digital (12/10/2026, decisão do proprietário).
--
-- Renovar o A1 todo ano costuma ser trabalho do fiscal ou do escritório de contabilidade, não do
-- dono. Por isso enviar, trocar e remover o certificado passa a ser a funcionalidade
-- "fiscal.certificado", que o proprietário concede em Pessoas e Acessos (inclusive ao escritório).
-- Continua valendo:
--   - NINGUÉM lê o certificado (nem quem tem a permissão, nem o dono): só o servidor;
--   - ligar a produção é só do proprietário;
--   - certificado vencido ou de outro CNPJ é recusado.
-- Toda troca ou remoção vai para a auditoria (audit_logs, risco alto: quem, quando, titular, CNPJ,
-- validade; nunca o arquivo nem a senha) e avisa os proprietários e quem cuida do certificado.

insert into public.access_features (code, module_code, label, levels, sort) values
  ('fiscal.certificado', 'fiscal', 'Certificado digital', '{operar}', 40)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- Quem cuida do certificado vê a configuração (onde aparecem titular, CNPJ e validade).
drop policy if exists fiscal_config_read on public.fiscal_config;
create policy fiscal_config_read on public.fiscal_config for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('fiscal.config')) or (select public.has_feature('fiscal.nfe'))
    or (select public.has_feature('fiscal.icms')) or (select public.has_feature('fiscal.certificado', 'operar')))
);

-- Auditoria + aviso de uma ação no certificado. Interna (chamada pelas funções abaixo).
create or replace function public.fiscal_certificado_registrar(
  p_org uuid, p_acao text, p_antes public.fiscal_config, p_titular text, p_cnpj text, p_validade timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_profile_id();
  nome text := coalesce((select full_name from public.profiles where id = me), 'Alguém');
  titulo text;
  corpo text;
begin
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (p_org, auth.uid(), me, 'fiscal', 'fiscal.certificado.' || p_acao, 'fiscal_config', p_org, 'high',
    jsonb_build_object(
      'acao', p_acao, 'por', nome,
      'titular', p_titular, 'cnpj', p_cnpj, 'validade', p_validade,
      'anterior', case when p_antes.cert_validade is null then null else jsonb_build_object(
        'titular', p_antes.cert_titular, 'cnpj', p_antes.cert_cnpj, 'validade', p_antes.cert_validade,
        'enviado_por', p_antes.cert_enviado_por_nome, 'enviado_em', p_antes.cert_enviado_em) end));

  titulo := case p_acao when 'enviado' then 'Certificado digital enviado' when 'trocado' then 'Certificado digital trocado' else 'Certificado digital removido' end;
  corpo := case when p_acao = 'removido'
    then format('%s removeu o certificado do cofre. A busca na SEFAZ foi desligada e a emissão fica parada até um novo envio.', nome)
    else format('%s · %s · válido até %s.', nome, coalesce(p_titular, 'titular não informado'), to_char(p_validade at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')) end;

  -- Proprietários e quem cuida do certificado; quem fez não recebe o próprio aviso.
  insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
  select distinct p_org, p.id, 'fiscal', case when p_acao = 'removido' then 'attention' else 'info' end, titulo, corpo,
    '/?module=fiscal&secao=Configura%C3%A7%C3%A3o'
  from public.profiles p
  where p.organization_id = p_org and p.status = 'active'
    and (p.access_expires_at is null or p.access_expires_at > now())
    and (me is null or p.id <> me)
    and (p.is_owner or exists (select 1 from public.user_feature_grants g
      where g.profile_id = p.id and g.organization_id = p_org and g.feature_code = 'fiscal.certificado' and g.level >= 'operar'));
end;
$$;
revoke all on function public.fiscal_certificado_registrar(uuid, text, public.fiscal_config, text, text, timestamptz) from public, anon, authenticated;

create or replace function public.fiscal_certificado_salvar(p_pfx text, p_senha text, p_titular text, p_cnpj text, p_validade timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  seg public.fiscal_certificado_segredos%rowtype;
  antes public.fiscal_config%rowtype;
  emitente text;
  cnpj_cert text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  nome text := 'fiscal_cert_' || org::text;
begin
  if org is null or not (public.is_owner() or public.has_feature('fiscal.certificado', 'operar')) then
    raise exception 'Sem permissão para cuidar do certificado digital.' using errcode = '42501';
  end if;
  if coalesce(length(p_pfx), 0) < 100 or coalesce(length(p_senha), 0) < 1 then raise exception 'Certificado ou senha vazios.'; end if;
  if cnpj_cert !~ '^\d{14}$' then raise exception 'O certificado não traz um CNPJ.'; end if;
  if p_validade is null or p_validade < now() then raise exception 'O certificado está vencido.'; end if;
  insert into public.fiscal_config (organization_id) values (org) on conflict (organization_id) do nothing;
  select * into antes from public.fiscal_config where organization_id = org for update;
  emitente := coalesce(antes.cnpj, public.cnpj_da_empresa(org));
  if emitente ~ '^\d{14}$' and left(emitente, 8) <> left(cnpj_cert, 8) then
    raise exception 'O certificado é de outro CNPJ (%), não do emitente.', cnpj_cert;
  end if;

  select * into seg from public.fiscal_certificado_segredos where organization_id = org for update;
  if seg.organization_id is null then
    insert into public.fiscal_certificado_segredos (organization_id, pfx_secret_id, senha_secret_id)
    values (org, vault.create_secret(p_pfx, nome || '_pfx', 'Certificado A1 (pfx, base64)'),
                 vault.create_secret(p_senha, nome || '_senha', 'Senha do certificado A1'));
  else
    perform vault.update_secret(seg.pfx_secret_id, p_pfx);
    perform vault.update_secret(seg.senha_secret_id, p_senha);
    update public.fiscal_certificado_segredos set updated_at = now() where organization_id = org;
  end if;

  update public.fiscal_config set
    cert_titular = left(p_titular, 200), cert_cnpj = cnpj_cert, cert_validade = p_validade,
    cert_enviado_por = me, cert_enviado_por_nome = (select full_name from public.profiles where id = me), cert_enviado_em = now(),
    cnpj = coalesce(cnpj, cnpj_cert), updated_at = now()
  where organization_id = org;

  perform public.fiscal_certificado_registrar(org, case when antes.cert_validade is null then 'enviado' else 'trocado' end,
    antes, left(p_titular, 200), cnpj_cert, p_validade);
  perform public.emit_module_event(org, 'fiscal', 'fiscal.certificado.enviado', 'fiscal_config', org::text,
    format('Certificado digital %s (válido até %s)', case when antes.cert_validade is null then 'enviado' else 'trocado' end,
      to_char(p_validade at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
    jsonb_build_object('validade', p_validade, 'troca', antes.cert_validade is not null));
end;
$$;
revoke all on function public.fiscal_certificado_salvar(text, text, text, text, timestamptz) from public, anon;
grant execute on function public.fiscal_certificado_salvar(text, text, text, text, timestamptz) to authenticated;

create or replace function public.fiscal_certificado_remover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  seg public.fiscal_certificado_segredos%rowtype;
  antes public.fiscal_config%rowtype;
begin
  if org is null or not (public.is_owner() or public.has_feature('fiscal.certificado', 'operar')) then
    raise exception 'Sem permissão para cuidar do certificado digital.' using errcode = '42501';
  end if;
  select * into antes from public.fiscal_config where organization_id = org for update;
  select * into seg from public.fiscal_certificado_segredos where organization_id = org for update;
  if seg.organization_id is not null then
    delete from vault.secrets where id in (seg.pfx_secret_id, seg.senha_secret_id);
    delete from public.fiscal_certificado_segredos where organization_id = org;
  end if;
  update public.fiscal_config set cert_titular = null, cert_cnpj = null, cert_validade = null, cert_enviado_por = null,
    cert_enviado_por_nome = null, cert_enviado_em = null, dfe_ativo = false, updated_at = now()
  where organization_id = org;
  perform public.fiscal_certificado_registrar(org, 'removido', antes, null, null, null);
  perform public.emit_module_event(org, 'fiscal', 'fiscal.certificado.removido', 'fiscal_config', org::text,
    'Certificado digital removido', '{}'::jsonb);
end;
$$;
revoke all on function public.fiscal_certificado_remover() from public, anon;
grant execute on function public.fiscal_certificado_remover() to authenticated;
