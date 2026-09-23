-- ============================================================================
-- Uso do cliente: agora conta também os cards do funil
-- ============================================================================
-- O cadastro de clientes passou a viver em dois lugares (Fundação › Cadastros e
-- Comercial › CRM › Clientes), e a tela precisa saber se dá para excluir.
--
-- A contagem é SECURITY DEFINER de propósito: quem cuida do CRM pode não ter
-- acesso ao Financeiro, e mesmo assim precisa saber que aquele cliente tem
-- título — senão a tela ofereceria excluir um cadastro com histórico, e o
-- vínculo do título viraria nulo em silêncio.
-- ============================================================================

drop function if exists public.customer_usage();

create function public.customer_usage()
returns table (customer_id uuid, titulos bigint, cards bigint, emails bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
    (select count(*) from public.finance_titles t where t.customer_id = c.id),
    (select count(*) from public.crm_cards k where k.customer_id = c.id),
    (select count(*) from public.party_emails e where e.customer_id = c.id)
  from public.customers c
  where c.organization_id = public.current_organization_id()
    and (public.has_feature('fundacao.cadastros') or public.has_feature('comercial.clientes'));
$$;

revoke all on function public.customer_usage() from public;
grant execute on function public.customer_usage() to authenticated;

/** O cliente tem histórico que impede a exclusão? */
create or replace function public.customer_in_use(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customers c
    where c.id = target
      and c.organization_id = public.current_organization_id()
      and (public.has_feature('fundacao.cadastros', 'operar') or public.has_feature('comercial.clientes', 'operar'))
      and (
        exists (select 1 from public.finance_titles t where t.customer_id = c.id)
        or exists (select 1 from public.crm_cards k where k.customer_id = c.id)
      )
  );
$$;

revoke all on function public.customer_in_use(uuid) from public;
grant execute on function public.customer_in_use(uuid) to authenticated;
