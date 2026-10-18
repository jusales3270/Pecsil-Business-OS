-- DESFEITA pela 202610170014 (17/10/2026): a triagem pelo Clef foi medida e retirada.
-- SARA + Clef (I-12, proprietário 17/10/2026): antes do Claude Haiku, o Clef faz a triagem da
-- pergunta — escolhe, numa lista fechada, a consulta que responde (e a situação, nas contas). A
-- plataforma roda essa consulta com a sessão de quem pergunta e o Haiku já recebe o resultado:
-- uma rodada a menos do Haiku (menos tempo e menos tokens). O Haiku continua com todas as
-- ferramentas da pessoa, então uma triagem errada só custa uma consulta a mais, nunca um dado errado.
--
-- Cada triagem fica em ai_judgments (uso <modulo>.sara_triagem), já conferida pela própria SARA:
--   aceita     a consulta escolhida bastou (o Haiku não precisou de outra);
--   corrigida  o Haiku precisou de outra consulta (a nota diz qual);
--   ignorada   o Clef não teve confiança e a triagem não foi usada.
-- Não entra na fila de conferência como pendente: não há decisão humana a tomar.

insert into public.ai_uses (organization_id, code, label, module_code, feature_code, enabled, limit_high, limit_low)
select o.id, 'financeiro.sara_triagem', 'SARA do Financeiro: escolher a consulta', 'financeiro', 'financeiro.homologacao', true, 0.80, 0.40
from public.organizations o
on conflict (organization_id, code) do nothing;

-- Quem pode usar a SARA de um módulo: o proprietário ou quem tem alguma funcionalidade do módulo.
create or replace function public.sara_pode_usar(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or exists (
    select 1 from public.user_feature_grants g
    where g.profile_id = public.current_profile_id()
      and g.organization_id = public.current_organization_id()
      and g.feature_code like p_modulo || '.%'
  );
$$;
revoke all on function public.sara_pode_usar(text) from public, anon;
grant execute on function public.sara_pode_usar(text) to authenticated;

-- Configuração da triagem do módulo (sem abrir ai_uses, que é só do proprietário).
create or replace function public.sara_triagem_config(p_modulo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.sara_pode_usar(p_modulo) then (
    select jsonb_build_object('code', u.code, 'enabled', u.enabled, 'model', u.model, 'limitHigh', u.limit_high, 'limitLow', u.limit_low)
    from public.ai_uses u
    where u.organization_id = public.current_organization_id() and u.code = p_modulo || '.sara_triagem'
  ) end;
$$;
revoke all on function public.sara_triagem_config(text) from public, anon;
grant execute on function public.sara_triagem_config(text) to authenticated;

-- Grava uma triagem já com o resultado da conferência automática.
create or replace function public.sara_triagem_registrar(
  p_modulo text, p_mensagem uuid, p_resumo text, p_perguntas jsonb, p_respostas jsonb, p_confianca numeric, p_faixa text,
  p_modelo text, p_ms integer, p_tokens integer, p_resultado text, p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  uso public.ai_uses%rowtype;
  novo uuid;
begin
  if not public.sara_pode_usar(p_modulo) then
    raise exception 'Sem acesso à SARA deste módulo.' using errcode = '42501';
  end if;
  select * into uso from public.ai_uses where organization_id = org and code = p_modulo || '.sara_triagem';
  if uso.id is null then raise exception 'Triagem da SARA não registrada para %.', p_modulo; end if;
  if p_resultado not in ('aceita', 'corrigida', 'ignorada', 'bloqueada', 'erro') then raise exception 'Resultado inválido.'; end if;
  insert into public.ai_judgments (organization_id, use_code, feature_code, entity_type, entity_id, state_summary, questions, answers,
    confidence, band, model, latency_ms, input_tokens, outcome, error_detail, decided_by_name, decided_at, decision_note, created_by)
  values (org, uso.code, uso.feature_code, 'sara_mensagem', p_mensagem::text, left(coalesce(p_resumo, ''), 2000),
    coalesce(p_perguntas, '{}'::jsonb), coalesce(p_respostas, '{}'::jsonb), p_confianca, p_faixa, coalesce(p_modelo, uso.model), p_ms, p_tokens,
    p_resultado, case when p_resultado in ('bloqueada', 'erro') then left(p_nota, 500) end,
    case when p_resultado in ('aceita', 'corrigida', 'ignorada') then 'Conferência automática da SARA' end,
    case when p_resultado in ('aceita', 'corrigida', 'ignorada') then now() end,
    case when p_resultado in ('aceita', 'corrigida', 'ignorada') then left(p_nota, 500) end,
    public.current_profile_id())
  returning id into novo;
  return novo;
end;
$$;
revoke all on function public.sara_triagem_registrar(text, uuid, text, jsonb, jsonb, numeric, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.sara_triagem_registrar(text, uuid, text, jsonb, jsonb, numeric, text, text, integer, integer, text, text) to authenticated;
