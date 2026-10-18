-- SARA (I-12): busca de lançamentos do Financeiro para a SARA achar e abrir um registro exato
-- ("me mostre o último lançamento do financiamento da Grob"). Roda com as permissões de quem
-- pergunta (security invoker: o RLS de finance_titles decide o que aparece).
--
-- Também desfaz a triagem pelo Clef (202610170013): medida em 17/10, não trouxe vantagem sobre o
-- Haiku sozinho (ele já escolhe a consulta certa) e foi retirada por decisão do proprietário. O Clef
-- volta à SARA só quando ela tiver de dar uma opinião com a confiança à vista.

drop function if exists public.sara_triagem_registrar(text, uuid, text, jsonb, jsonb, numeric, text, text, integer, integer, text, text);
drop function if exists public.sara_triagem_config(text);
drop function if exists public.sara_pode_usar(text);
delete from public.ai_judgments where use_code = 'financeiro.sara_triagem';
delete from public.ai_uses where code = 'financeiro.sara_triagem';

-- Lançamentos que contêm todos os termos (no nome, no histórico ou no documento), já com o último
-- pagamento, o próximo e o último vencimento, na ordem pedida. Devolve um jsonb só (sem o limite de
-- 1.000 linhas da API).
create or replace function public.sara_buscar_lancamentos(p_direcao text, p_termos text[], p_ordem text default 'ultimo_pago', p_limite integer default 5)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with termos as (
    select distinct lower(trim(x)) termo from unnest(coalesce(p_termos, '{}'::text[])) x where length(trim(x)) >= 2
  ), achados as (
    select t.id, t.counterparty_name, t.description, t.document_number, t.status::text status, t.is_forecast, t.is_historical, t.created_at
    from public.finance_titles t
    where t.direction::text = p_direcao and t.archived_at is null
      and exists (select 1 from termos)
      and not exists (
        select 1 from termos
        where not (t.counterparty_name ilike '%' || termo || '%' or coalesce(t.description, '') ilike '%' || termo || '%' or coalesce(t.document_number, '') ilike '%' || termo || '%')
      )
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
