-- F-06 (roadmap) · Blueprint Fase 3: alçadas de aprovação por faixa de valor, nível e papel, e baixa
-- integral, parcial e reversível preservando o valor original.
--
-- Alçadas: regras da organização (finance_approval_rules). SEM REGRA, NADA MUDA: o título que já
-- nascia aprovado continua aprovado e o "Aprovar" segue de uma etapa só, como antes. Com regra, o
-- título que cai na faixa nasce "em aprovação", passa por cada nível (pessoa ou papel definidos na
-- regra; a mesma pessoa não aprova dois níveis) e só recebe baixa depois de aprovado.
--
-- Estorno: a baixa nunca é apagada. Fica marcada como estornada (quem, quando, motivo) e o título
-- volta a ter saldo em aberto. O valor original do título não muda.

-- ---------------------------------------------------------------------------------------------
-- 1. Regras: aprovador por pessoa (além do papel) e quem aprovou o título
-- ---------------------------------------------------------------------------------------------
alter table public.finance_approval_rules
  add column if not exists approver_profile_id uuid references public.profiles(id) on delete restrict;

alter table public.finance_titles
  add column if not exists approved_by_profile_id uuid references public.profiles(id) on delete set null;

alter table public.finance_settlements
  add column if not exists reversal_reason text check (reversal_reason is null or length(reversal_reason) <= 500);

-- Um pedido recusado não impede aprovar o mesmo nível depois.
drop index if exists public.uq_finance_approval_title_level;
create unique index uq_finance_approval_title_level
  on public.finance_approval_requests(title_id, approval_level)
  where installment_id is null and status in ('pending', 'approved');

-- Escrita só pelas funções abaixo.
drop policy if exists finance_approval_rules_admin on public.finance_approval_rules;
drop policy if exists finance_approval_rules_read on public.finance_approval_rules;
create policy finance_approval_rules_read on public.finance_approval_rules for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('financeiro.pagar') or public.has_feature('financeiro.receber') or public.has_feature('financeiro.homologacao')
));
revoke insert, update, delete on public.finance_approval_rules from anon, authenticated;
revoke insert, update, delete on public.finance_approval_requests from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Que níveis um título precisa
-- ---------------------------------------------------------------------------------------------
create or replace function public.finance_regras_do_titulo(p_org uuid, p_direction public.finance_title_direction, p_amount numeric)
returns setof public.finance_approval_rules
language sql
stable
security definer
set search_path = public
as $$
  select r.* from public.finance_approval_rules r
  where r.organization_id = p_org and r.active
    and (r.direction is null or r.direction = p_direction)
    and p_amount >= r.min_amount and (r.max_amount is null or p_amount <= r.max_amount)
  order by r.approval_level, r.name;
$$;
revoke all on function public.finance_regras_do_titulo(uuid, public.finance_title_direction, numeric) from public, anon;

-- Quem pode decidir um nível: a pessoa da regra, alguém com o papel da regra, ou (regra sem pessoa
-- nem papel) quem aprova na direção. O proprietário sempre pode.
create or replace function public.finance_pode_decidir(p_rule public.finance_approval_rules, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner()
    or (p_rule.approver_profile_id is not null and p_rule.approver_profile_id = p_profile)
    or (p_rule.approver_role_id is not null and exists (
          select 1 from public.user_roles ur
          where ur.profile_id = p_profile and ur.role_id = p_rule.approver_role_id
            and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_until is null or ur.valid_until > now())))
    or (p_rule.approver_profile_id is null and p_rule.approver_role_id is null);
$$;
revoke all on function public.finance_pode_decidir(public.finance_approval_rules, uuid) from public, anon;

-- ---------------------------------------------------------------------------------------------
-- 3. Título que cai numa alçada nasce em aprovação (sem regra, nada muda)
-- ---------------------------------------------------------------------------------------------
create or replace function public.finance_titulo_alcada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  primeira public.finance_approval_rules%rowtype;
begin
  if coalesce(current_setting('pecsil.carga_em_lote', true), '') = '1' then return new; end if;
  if coalesce(new.is_forecast, false) or coalesce(new.is_historical, false) or new.status <> 'approved' then return new; end if;
  select * into primeira from public.finance_regras_do_titulo(new.organization_id, new.direction, new.original_amount) limit 1;
  if primeira.id is null then return new; end if;
  new.status := 'pending_approval';
  new.approved_at := null;
  new.approved_by_profile_id := null;
  return new;
end;
$$;
drop trigger if exists finance_titulo_alcada on public.finance_titles;
create trigger finance_titulo_alcada before insert on public.finance_titles
for each row execute function public.finance_titulo_alcada();

-- Mudou o valor de um título aprovado e a nova faixa pede alçada: volta para aprovação.
create or replace function public.finance_titulo_valor_alcada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.original_amount = old.original_amount or new.status <> 'approved' or coalesce(new.is_forecast, false) then return new; end if;
  if not exists (select 1 from public.finance_regras_do_titulo(new.organization_id, new.direction, new.original_amount)) then return new; end if;
  if exists (select 1 from public.finance_installments i where i.title_id = new.id and i.settled_amount > 0) then return new; end if;
  update public.finance_approval_requests set status = 'cancelled', decided_at = now(), reason = 'Valor do título alterado'
  where title_id = new.id and status in ('pending', 'approved');
  new.status := 'pending_approval';
  new.approved_at := null;
  new.approved_by_profile_id := null;
  return new;
end;
$$;
drop trigger if exists finance_titulo_valor_alcada on public.finance_titles;
create trigger finance_titulo_valor_alcada before update of original_amount on public.finance_titles
for each row execute function public.finance_titulo_valor_alcada();

-- Ninguém tira um título de "em aprovação" mexendo direto na linha: só pelo Aprovar.
create or replace function public.finance_titulo_protege_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending_approval' and new.status in ('approved', 'partially_settled', 'settled')
     and coalesce(current_setting('pecsil.financeiro_aprovacao', true), '') <> '1'
     and coalesce(current_setting('pecsil.carga_em_lote', true), '') <> '1' then
    raise exception 'Este título está em aprovação: use Aprovar.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists finance_titulo_protege_aprovacao on public.finance_titles;
create trigger finance_titulo_protege_aprovacao before update of status on public.finance_titles
for each row execute function public.finance_titulo_protege_aprovacao();

-- Baixa só em título aprovado (vale para a baixa manual e para a conciliação).
create or replace function public.finance_validate_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  installment_total numeric(18,2);
  already_applied numeric(18,2);
  installment_org uuid;
  title_status public.finance_title_status;
begin
  select i.amount, i.organization_id, t.status
    into installment_total, installment_org, title_status
  from public.finance_installments i
  join public.finance_titles t on t.id = i.title_id
  where i.id = new.installment_id
  for update of i;

  if installment_total is null then
    raise exception 'Parcela financeira não encontrada';
  end if;
  if new.organization_id <> installment_org then
    raise exception 'A baixa e a parcela devem pertencer à mesma organização';
  end if;
  if tg_op = 'INSERT' and title_status = 'pending_approval' then
    raise exception 'Título em aprovação: aprove antes de dar baixa.' using errcode = 'P0001';
  end if;
  if new.reversed_at is not null then
    return new;
  end if;

  select coalesce(sum(amount + discount), 0)
    into already_applied
  from public.finance_settlements
  where installment_id = new.installment_id
    and reversed_at is null
    and id <> new.id;

  if already_applied + new.amount + new.discount > installment_total then
    raise exception 'A baixa ultrapassa o saldo da parcela';
  end if;

  return new;
end;
$$;

-- Recontagem: com todas as baixas estornadas, o título volta a "aprovado" (antes ficava "quitado").
create or replace function public.finance_refresh_installment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_installment uuid;
  target_title uuid;
  applied numeric(18,2);
begin
  target_installment := case when tg_op = 'DELETE' then old.installment_id else new.installment_id end;

  select coalesce(sum(amount + discount), 0)
    into applied
  from public.finance_settlements
  where installment_id = target_installment
    and reversed_at is null;

  update public.finance_installments
  set settled_amount = least(amount, applied),
      status = case
        when status = 'cancelled' then 'cancelled'::public.finance_installment_status
        when applied >= amount then 'settled'::public.finance_installment_status
        when applied > 0 then 'partially_settled'::public.finance_installment_status
        when due_date < current_date then 'overdue'::public.finance_installment_status
        else 'pending'::public.finance_installment_status
      end
  where id = target_installment
  returning title_id into target_title;

  update public.finance_titles t
  set status = case
    when t.status = 'cancelled' then 'cancelled'::public.finance_title_status
    when not exists (
      select 1 from public.finance_installments i
      where i.title_id = t.id and i.status <> 'settled'
    ) then 'settled'::public.finance_title_status
    when exists (
      select 1 from public.finance_installments i
      where i.title_id = t.id and i.settled_amount > 0
    ) then 'partially_settled'::public.finance_title_status
    when exists (
      select 1 from public.finance_installments i
      where i.title_id = t.id and i.status = 'overdue'
    ) then 'overdue'::public.finance_title_status
    when t.status in ('settled', 'partially_settled') then 'approved'::public.finance_title_status
    else t.status
  end
  where t.id = target_title;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Aprovar ou recusar
-- ---------------------------------------------------------------------------------------------
create or replace function public.finance_aprovar_titulo(p_title uuid, p_decisao text default 'aprovar', p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  titulo public.finance_titles%rowtype;
  regra public.finance_approval_rules%rowtype;
  nivel int;
  niveis int[];
  feitos int[];
  candidata boolean := false;
  restantes int;
  rotulo text;
begin
  if p_decisao not in ('aprovar', 'recusar') then raise exception 'Decisão inválida.'; end if;
  select * into titulo from public.finance_titles where id = p_title and organization_id = org for update;
  if titulo.id is null then raise exception 'Título não encontrado.'; end if;
  if not public.has_feature(public.finance_direction_feature(titulo.direction), 'aprovar') then
    raise exception 'Sem permissão para aprovar.' using errcode = '42501';
  end if;
  if titulo.status <> 'pending_approval' then raise exception 'Este título não está em aprovação.'; end if;
  if p_decisao = 'recusar' and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  rotulo := case when titulo.direction = 'payable' then 'Conta a pagar' else 'Conta a receber' end;

  select array_agg(distinct r.approval_level order by r.approval_level) into niveis
  from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r;

  -- Sem alçada: uma etapa só, como sempre foi.
  if niveis is null then
    if p_decisao = 'recusar' then raise exception 'Sem alçada configurada: para recusar, cancele o título.'; end if;
    perform set_config('pecsil.financeiro_aprovacao', '1', true);
    update public.finance_titles set status = 'approved', approved_at = now(), approved_by_profile_id = me where id = titulo.id;
    perform set_config('pecsil.financeiro_aprovacao', '', true);
    return jsonb_build_object('aprovado', true, 'faltam', 0);
  end if;

  select coalesce(array_agg(approval_level), '{}') into feitos
  from public.finance_approval_requests where title_id = titulo.id and installment_id is null and status = 'approved';
  select min(n) into nivel from unnest(niveis) n where not (n = any(feitos));
  if nivel is null then nivel := niveis[array_length(niveis, 1)]; end if;

  -- A mesma pessoa não decide dois níveis do mesmo título (o proprietário pode).
  if not public.is_owner() and exists (
    select 1 from public.finance_approval_requests
    where title_id = titulo.id and status = 'approved' and decided_by_profile_id = me
  ) then
    raise exception 'Você já aprovou um nível deste título: o nível % é de outra pessoa.', nivel using errcode = '42501';
  end if;

  for regra in select * from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r where r.approval_level = nivel loop
    if public.finance_pode_decidir(regra, me) then candidata := true; exit; end if;
  end loop;
  if not candidata then
    select * into regra from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r where r.approval_level = nivel limit 1;
    raise exception 'O nível % desta alçada (%) é de %.', nivel, regra.name,
      coalesce((select full_name from public.profiles where id = regra.approver_profile_id),
               (select name from public.roles where id = regra.approver_role_id), 'outra pessoa')
      using errcode = '42501';
  end if;

  insert into public.finance_approval_requests (organization_id, title_id, rule_id, approval_level, status, requested_by_profile_id, decided_by_profile_id, decided_at, reason)
  values (org, titulo.id, regra.id, nivel, case when p_decisao = 'aprovar' then 'approved' else 'rejected' end::public.finance_approval_status,
          titulo.created_by_profile_id, me, now(), nullif(trim(coalesce(p_motivo, '')), ''));

  if p_decisao = 'recusar' then
    perform public.emit_module_event(org, 'financeiro', 'financeiro.titulo.recusado', 'finance_title', titulo.id::text,
      format('%s recusada no nível %s · %s', rotulo, nivel, titulo.counterparty_name), jsonb_build_object('nivel', nivel, 'motivo', p_motivo));
    if titulo.created_by_profile_id is not null and titulo.created_by_profile_id <> me then
      insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
      values (org, titulo.created_by_profile_id, 'financeiro', 'attention', format('%s recusada · %s', rotulo, titulo.counterparty_name),
              format('Nível %s · %s', nivel, p_motivo), '/?module=financeiro');
    end if;
    return jsonb_build_object('aprovado', false, 'recusado', true, 'nivel', nivel);
  end if;

  select count(*) into restantes from unnest(niveis) n where not (n = any(feitos || nivel));
  if restantes = 0 then
    perform set_config('pecsil.financeiro_aprovacao', '1', true);
    update public.finance_titles set status = 'approved', approved_at = now(), approved_by_profile_id = me where id = titulo.id;
    perform set_config('pecsil.financeiro_aprovacao', '', true);
    return jsonb_build_object('aprovado', true, 'faltam', 0, 'nivel', nivel);
  end if;

  -- Avisa quem decide o próximo nível.
  select min(n) into nivel from unnest(niveis) n where not (n = any(feitos || nivel));
  select * into regra from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r where r.approval_level = nivel limit 1;
  if regra.approver_profile_id is not null then
    insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
    values (org, regra.approver_profile_id, 'financeiro', 'approval', format('%s aguarda o seu nível · %s', rotulo, titulo.counterparty_name),
            format('Nível %s (%s) · R$ %s', nivel, regra.name, public.brl(titulo.original_amount)), '/?module=financeiro');
  else
    perform public.notify_feature(org, public.finance_direction_feature(titulo.direction), 'aprovar', 'financeiro', 'approval',
      format('%s aguarda o nível %s · %s', rotulo, nivel, titulo.counterparty_name),
      format('%s · R$ %s', regra.name, public.brl(titulo.original_amount)), '/?module=financeiro', me);
  end if;
  return jsonb_build_object('aprovado', false, 'faltam', restantes, 'proximoNivel', nivel);
end;
$$;
revoke all on function public.finance_aprovar_titulo(uuid, text, text) from public, anon;
grant execute on function public.finance_aprovar_titulo(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Estornar uma baixa
-- ---------------------------------------------------------------------------------------------
create or replace function public.finance_estornar_baixa(p_settlement uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  baixa public.finance_settlements%rowtype;
  titulo public.finance_titles%rowtype;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do estorno.'; end if;
  select * into baixa from public.finance_settlements where id = p_settlement and organization_id = org for update;
  if baixa.id is null then raise exception 'Baixa não encontrada.'; end if;
  select t.* into titulo from public.finance_titles t join public.finance_installments i on i.title_id = t.id where i.id = baixa.installment_id;
  if not public.has_feature(public.finance_direction_feature(titulo.direction), 'aprovar') then
    raise exception 'Sem permissão para estornar.' using errcode = '42501';
  end if;
  if baixa.reversed_at is not null then raise exception 'Esta baixa já foi estornada.'; end if;
  if titulo.status = 'cancelled' then raise exception 'Título cancelado: não há o que estornar.'; end if;
  if exists (select 1 from public.finance_reconciliations r where r.settlement_id = baixa.id) then
    raise exception 'Esta baixa está conciliada com o extrato: desfaça a conciliação antes de estornar.';
  end if;

  update public.finance_settlements
  set reversed_at = now(), reversed_by_profile_id = me, reversal_reason = left(trim(p_motivo), 500)
  where id = baixa.id;

  perform public.emit_module_event(org, 'financeiro', 'financeiro.baixa.estornada', 'finance_title', titulo.id::text,
    format('Baixa estornada · %s · R$ %s', titulo.counterparty_name, public.brl(baixa.amount)),
    jsonb_build_object('baixa', baixa.id, 'valor', baixa.amount, 'data', baixa.settlement_date, 'motivo', trim(p_motivo)));
end;
$$;
revoke all on function public.finance_estornar_baixa(uuid, text) from public, anon;
grant execute on function public.finance_estornar_baixa(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Cadastro das alçadas (Homologação do Financeiro, ou o proprietário)
-- ---------------------------------------------------------------------------------------------
create or replace function public.finance_alcada_salvar(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_min numeric := coalesce(nullif(p ->> 'min_amount', '')::numeric, 0);
  v_max numeric := nullif(p ->> 'max_amount', '')::numeric;
  v_dir public.finance_title_direction := nullif(p ->> 'direction', '')::public.finance_title_direction;
  v_pessoa uuid := nullif(p ->> 'approver_profile_id', '')::uuid;
  v_papel uuid := nullif(p ->> 'approver_role_id', '')::uuid;
begin
  if org is null or not (public.is_owner() or public.has_feature('financeiro.homologacao', 'operar')) then
    raise exception 'Sem permissão para alterar as alçadas.' using errcode = '42501';
  end if;
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Dê um nome à alçada.'; end if;
  if v_max is not null and v_max <= v_min then raise exception 'O valor até tem de ser maior que o valor a partir de.'; end if;
  if v_pessoa is not null and not exists (select 1 from public.profiles where id = v_pessoa and organization_id = org) then
    raise exception 'Pessoa não encontrada.';
  end if;
  if v_id is null then
    insert into public.finance_approval_rules (organization_id, name, direction, min_amount, max_amount, approval_level, approver_role_id, approver_profile_id, active)
    values (org, trim(p ->> 'name'), v_dir, v_min, v_max, coalesce(nullif(p ->> 'approval_level', '')::int, 1), v_papel, v_pessoa, coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update public.finance_approval_rules set
      name = trim(p ->> 'name'), direction = v_dir, min_amount = v_min, max_amount = v_max,
      approval_level = coalesce(nullif(p ->> 'approval_level', '')::int, approval_level),
      approver_role_id = v_papel, approver_profile_id = v_pessoa,
      active = coalesce((p ->> 'active')::boolean, active)
    where id = v_id and organization_id = org;
    if not found then raise exception 'Alçada não encontrada.'; end if;
  end if;
  perform public.emit_module_event(org, 'financeiro', 'financeiro.alcada.alterada', 'finance_approval_rule', v_id::text,
    format('Alçada %s gravada', trim(p ->> 'name')), p);
  return v_id;
end;
$$;
revoke all on function public.finance_alcada_salvar(jsonb) from public, anon;
grant execute on function public.finance_alcada_salvar(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Trilha: título que volta a "aprovado" porque a baixa foi estornada não é uma nova aprovação
--    (o estorno já tem o evento financeiro.baixa.estornada).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.events_financeiro_titulo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  kind text := case new.direction when 'payable' then 'a pagar' else 'a receber' end;
begin
  if current_setting('pecsil.carga_em_lote', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.criado', 'titulo', new.id::text,
      format('Título %s criado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount,
        'source_module', new.source_module, 'source_entity_id', new.source_entity_id));
  elsif new.status is distinct from old.status and new.status = 'settled' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.baixado', 'titulo', new.id::text,
      format('Título %s quitado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  elsif new.status is distinct from old.status and new.status = 'approved' and old.status not in ('settled', 'partially_settled') then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.aprovado', 'titulo', new.id::text,
      format('Título %s aprovado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  elsif new.status is distinct from old.status and new.status = 'cancelled' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.cancelado', 'titulo', new.id::text,
      format('Título %s cancelado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  elsif new.original_amount is distinct from old.original_amount
     or new.counterparty_name is distinct from old.counterparty_name
     or new.document_number is distinct from old.document_number
     or new.chart_account_id is distinct from old.chart_account_id
     or new.is_forecast is distinct from old.is_forecast then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.alterado', 'titulo', new.id::text,
      format('Título %s alterado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount, 'previous_amount', old.original_amount,
        'previous_counterparty', old.counterparty_name, 'forecast', new.is_forecast));
  end if;
  return new;
end;
$function$;
