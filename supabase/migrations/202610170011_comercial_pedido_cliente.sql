-- C-05 (roadmap) · Pedido do cliente → itens do orçamento.
-- A leitura do pedido e os candidatos são por REGRA (lib/comercial/pedido-cliente.ts): de-para do
-- código do cliente, depois artigo + tipo + material, depois descrição. Quem confirma cada linha é o
-- Comercial (comercial.orcamentos · operar). Ao confirmar, o código do cliente vira o de-para do
-- produto (products.nome_cliente), e a próxima vez casa exato.
-- O uso do Clef (desempatar entre candidatos) é REGISTRADO DESLIGADO (Plano do Jev, Etapa 10): só o
-- proprietário liga, depois de uma simulação conferida. Vai só a descrição da linha e as descrições
-- dos candidatos; nunca preço, cliente ou quantidade.

insert into public.ai_uses (organization_id, code, label, module_code, feature_code, limit_high, limit_low)
select o.id, 'comercial.pedido_produto', 'Pedido do cliente: qual produto do catálogo é cada linha', 'comercial', 'comercial.orcamentos', 0.85, 0.50
from public.organizations o
on conflict (organization_id, code) do nothing;

-- De-para: grava o código do cliente no produto escolhido, se ainda não tiver um. Nunca troca um
-- de-para existente (se o produto já tem outro código do cliente, avisa e não mexe).
create or replace function public.comercial_produto_de_para(p_product uuid, p_codigo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  v_codigo text := left(nullif(btrim(coalesce(p_codigo, '')), ''), 120);
  atual text;
begin
  if org is null or not public.has_feature('comercial.orcamentos', 'operar') then
    raise exception 'Ligar o código do cliente ao produto é de quem monta orçamentos.' using errcode = '42501';
  end if;
  if v_codigo is null then return 'sem_codigo'; end if;
  select nome_cliente into atual from public.products where id = p_product and organization_id = org for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if atual is not null and btrim(atual) <> '' then
    return case when upper(btrim(atual)) = upper(v_codigo) then 'ja_ligado' else 'outro_codigo' end;
  end if;
  update public.products set nome_cliente = v_codigo, updated_at = now() where id = p_product;
  perform public.emit_module_event(org, 'comercial', 'comercial.produto.de_para', 'produto', p_product::text,
    format('Código do cliente %s ligado ao produto', v_codigo), jsonb_build_object('codigo_cliente', v_codigo));
  return 'gravado';
end;
$$;
revoke all on function public.comercial_produto_de_para(uuid, text) from public, anon;
grant execute on function public.comercial_produto_de_para(uuid, text) to authenticated;
