-- ============================================================================
-- Movimento do período sem o encerramento (Contábil-Fiscal, N-05 adiantado) (27/10/2026)
-- ============================================================================
-- A DRE de um período soma o movimento das contas de resultado SEM os lançamentos de encerramento (o escritório
-- zera o resultado a cada trimestre; com eles, a DRE daria zero). Só leitura, pela sessão: a RLS das partidas e
-- dos lançamentos vale (quem vê a Contabilidade).
-- ============================================================================

create or replace function public.contabil_movimento(p_plano uuid, p_de date, p_ate date, p_sem_encerramento boolean default true)
returns table (conta_id uuid, debitos numeric, creditos numeric)
language sql stable security invoker set search_path = public as $$
  select p.conta_id,
    coalesce(sum(p.valor) filter (where p.lado = 'D'), 0),
    coalesce(sum(p.valor) filter (where p.lado = 'C'), 0)
  from public.contabil_partidas p join public.contabil_lancamentos l on l.id = p.lancamento_id
  where l.plano_id = p_plano and l.data between p_de and p_ate and (not p_sem_encerramento or not l.encerramento)
  group by p.conta_id;
$$;
revoke all on function public.contabil_movimento(uuid, date, date, boolean) from public, anon;
grant execute on function public.contabil_movimento(uuid, date, date, boolean) to authenticated;
