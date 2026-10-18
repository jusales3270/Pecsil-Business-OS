-- SARA (I-12, proprietário 18/10/2026): quem usa a SARA de um módulo passa a ser decidido em
-- Pessoas e Acessos, na mesma lista de funcionalidades do módulo (`<modulo>.sara`). O proprietário
-- marca para quem ela fica disponível; o botão "Ligada" e o contador de tokens saem do painel.
-- O modelo e o teto mensal de uso continuam no servidor (sara_modulos), só como proteção de custo.

insert into public.access_features (code, module_code, label, levels, sort) values
  ('financeiro.sara', 'financeiro', 'SARA (assistente do módulo)', '{ver}', 95)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- A chave antiga de ligar/desligar não é mais usada: o acesso é por pessoa.
update public.sara_modulos set ligada = true where modulo = 'financeiro';
drop function if exists public.sara_configurar(text, boolean, text, integer);

-- Registro de uma troca: agora exige a funcionalidade da SARA do módulo. A pergunta e a resposta
-- ganham horários distintos (clock_timestamp), para o histórico nunca sair trocado.
create or replace function public.sara_registrar(
  p_conversa uuid, p_modulo text, p_pergunta text, p_resposta text, p_ferramentas jsonb, p_modelo text, p_tokens_entrada int, p_tokens_saida int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  conv uuid := p_conversa;
  resp uuid;
begin
  if org is null or me is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if not public.has_feature(p_modulo || '.sara') then
    raise exception 'A SARA deste módulo não está liberada para você.' using errcode = '42501';
  end if;
  if conv is null then
    insert into public.sara_conversas (organization_id, modulo, profile_id, profile_name, titulo)
    values (org, p_modulo, me, (select full_name from public.profiles where id = me), left(btrim(p_pergunta), 120))
    returning id into conv;
  elsif not exists (select 1 from public.sara_conversas where id = conv and organization_id = org and profile_id = me) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  insert into public.sara_mensagens (organization_id, conversa_id, papel, texto, created_at) values (org, conv, 'pessoa', left(p_pergunta, 20000), clock_timestamp());
  insert into public.sara_mensagens (organization_id, conversa_id, papel, texto, ferramentas, modelo, tokens_entrada, tokens_saida, created_at)
  values (org, conv, 'sara', left(p_resposta, 20000), coalesce(p_ferramentas, '[]'::jsonb), p_modelo, greatest(0, coalesce(p_tokens_entrada, 0)), greatest(0, coalesce(p_tokens_saida, 0)), clock_timestamp())
  returning id into resp;
  update public.sara_conversas set updated_at = now() where id = conv;
  return jsonb_build_object('conversa', conv, 'mensagem', resp);
end;
$$;
revoke all on function public.sara_registrar(uuid, text, text, text, jsonb, text, int, int) from public, anon;
grant execute on function public.sara_registrar(uuid, text, text, text, jsonb, text, int, int) to authenticated;
