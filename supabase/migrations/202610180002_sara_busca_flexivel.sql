-- SARA (I-12): busca de lançamentos mais tolerante (18/10/2026). Ignora acentos ("óleo" acha "OLEO")
-- e, quando nenhum lançamento tem todos os termos ("óleo máquinas"), traz os que têm mais termos —
-- e, entre esses, os do termo mais raro (óleo aparece em 8 lançamentos; máquinas, em 47) —, avisando
-- que a busca foi parcial. Continua com as permissões de quem pergunta (security invoker).

create or replace function public.sara_sem_acento(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
$$;
revoke all on function public.sara_sem_acento(text) from public, anon;
grant execute on function public.sara_sem_acento(text) to authenticated;

create or replace function public.sara_buscar_lancamentos(p_direcao text, p_termos text[], p_ordem text default 'ultimo_pago', p_limite integer default 5)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with termos as (
    select distinct public.sara_sem_acento(trim(x)) termo from unnest(coalesce(p_termos, '{}'::text[])) x where length(trim(x)) >= 2
  ), base as (
    select t.id, t.counterparty_name, t.description, t.document_number, t.status::text status, t.is_forecast, t.is_historical, t.created_at,
      public.sara_sem_acento(t.counterparty_name || ' ' || coalesce(t.description, '') || ' ' || coalesce(t.document_number, '')) texto
    from public.finance_titles t
    where t.direction::text = p_direcao and t.archived_at is null and exists (select 1 from termos)
  ), freq as (
    -- Em quantos lançamentos cada termo aparece: o termo mais raro é o que mais distingue.
    select termo, (select count(*) from base where texto like '%' || termo || '%') n from termos
  ), pontos as (
    select b.*,
      (select count(*) from freq where n > 0 and b.texto like '%' || termo || '%') acertos,
      (select coalesce(sum(1.0 / n), 0) from freq where n > 0 and b.texto like '%' || termo || '%') peso
    from base b
  ), melhor as (
    select max(acertos) acertos from pontos
  ), achados as (
    -- Todos os termos quando houver; senão, os que têm mais termos e, entre eles, os termos mais raros.
    select p.* from pontos p, melhor m
    where p.acertos > 0 and p.acertos = m.acertos
      and p.peso = (select max(peso) from pontos where acertos = m.acertos)
  ), linhas as (
    select a.*,
      p.data ultimo_pagamento, p.valor ultimo_pagamento_valor,
      (select min(i.due_date) from public.finance_installments i where i.title_id = a.id and i.status::text not in ('settled', 'cancelled') and i.settled_amount < i.amount and i.due_date >= current_date) proximo_vencimento,
      (select max(i.due_date) from public.finance_installments i where i.title_id = a.id) ultimo_vencimento,
      (select coalesce(sum(i.amount), 0) from public.finance_installments i where i.title_id = a.id and i.status::text <> 'cancelled') valor,
      (select coalesce(sum(i.amount - i.settled_amount), 0) from public.finance_installments i where i.title_id = a.id and i.status::text not in ('settled', 'cancelled')) em_aberto
    from achados a
    left join lateral (
      select s.settlement_date data, s.amount valor
      from public.finance_installments i join public.finance_settlements s on s.installment_id = i.id and s.reversed_at is null
      where i.title_id = a.id order by s.settlement_date desc, s.created_at desc limit 1
    ) p on true
  )
  select jsonb_build_object(
    'quantidade', (select count(*) from linhas),
    'termos', (select count(*) from termos),
    'termos_casados', coalesce((select acertos from melhor), 0),
    'lancamentos', coalesce((
      select jsonb_agg(to_jsonb(x) - 'n' order by x.n)
      from (
        select id, counterparty_name nome, description historico, document_number documento, status, is_forecast previsao, is_historical antigo,
          created_at::date lancado_em, ultimo_pagamento, ultimo_pagamento_valor, proximo_vencimento, ultimo_vencimento, valor, em_aberto,
          row_number() over (order by
            case when p_ordem = 'ultimo_pago' then ultimo_pagamento end desc nulls last,
            case when p_ordem = 'proximo_vencimento' then proximo_vencimento end asc nulls last,
            case when p_ordem = 'ultimo_vencimento' then ultimo_vencimento end desc nulls last,
            created_at desc) n
        from linhas
      ) x
      where x.n <= least(greatest(coalesce(p_limite, 5), 1), 15)
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.sara_buscar_lancamentos(text, text[], text, integer) from public, anon;
grant execute on function public.sara_buscar_lancamentos(text, text[], text, integer) to authenticated;
