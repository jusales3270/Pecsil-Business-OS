-- ============================================================================
-- Produtos vindos da Forja (15/10/2026, pedido do proprietário)
-- ============================================================================
-- O cadastro de produtos estava vazio e o orçamento não salvava sem produto. A Forja já tem as peças
-- (artigos) com o código do GRV (5-01-00339…), a descrição, o tipo e o cliente. Esta migração:
--   1. cria comercial_produtos_do_forja(org, artigos): grava os grupos (5-01, 5-02…) e os produtos
--      que ainda não existem, liga o artigo da Forja e nunca sobrescreve o que alguém editou;
--   2. já cadastra as peças das OS espelhadas da Forja (production_orders).
-- A sincronização com a Forja (a cada 10 minutos) passa a mandar o cadastro de artigos inteiro para a
-- mesma função. O próximo número de cada grupo continua depois do maior código conhecido; o do GRV
-- pode ser maior (ajuste em Produtos › Grupos e códigos).
-- NCM: 8480.50.00 (moldes para vidro) nas peças de molde, como nas notas emitidas; cabeça de sopro e
-- outros ficam sem NCM (o orçamento avisa).
-- ============================================================================

create or replace function public.comercial_produtos_do_forja(p_org uuid, p_artigos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb;
  v_codigo text;
  v_tipo text;
  v_desc text;
  v_material text;
  v_grupo public.product_groups%rowtype;
  m text[];
  seq int;
  existente public.products%rowtype;
  novos int := 0;
  vinculados int := 0;
  grupos_novos int := 0;
  ignorados int := 0;
begin
  for a in select * from jsonb_array_elements(coalesce(p_artigos, '[]'::jsonb)) loop
    v_codigo := upper(regexp_replace(coalesce(a ->> 'codigo', ''), '\s+', '', 'g'));
    v_desc := left(upper(btrim(regexp_replace(coalesce(a ->> 'descricao', ''), '\s+', ' ', 'g'))), 120);
    if v_codigo !~ '^[0-9A-Z][0-9A-Z.\-/]{0,29}$' or v_desc = '' then ignorados := ignorados + 1; continue; end if;
    v_tipo := coalesce(nullif(a ->> 'tipo', ''), 'outro');
    if v_tipo not in ('forma', 'bloco', 'fundo_forma', 'fundo_bloco', 'molde', 'arruela', 'cabeca_sopro', 'forminha', 'puncao', 'funil', 'outro') then v_tipo := 'outro'; end if;
    -- Material: o que vem depois de "ART. xxxx" na descrição (FOFO Q3, BRONZE BZ-889, SAE 1020…), se a Forja não mandou.
    v_material := left(upper(nullif(btrim(coalesce(a ->> 'material', substring(v_desc from 'ART\.?\s*[^ ]+\s+(.+)$'), '')), '')), 60);

    -- Grupo pelo código no formato do GRV (prefixo-grupo-sequência).
    v_grupo := null;
    m := regexp_match(v_codigo, '^([0-9A-Z]{1,6})-([0-9A-Z]{1,6})-(\d{1,5})');
    if m is not null then
      seq := m[3]::int;
      select * into v_grupo from public.product_groups where organization_id = p_org and codigo = m[2];
      if v_grupo.id is null then
        insert into public.product_groups (organization_id, codigo, nome, prefixo, proximo)
        values (p_org, m[2], case v_tipo when 'forma' then 'FORMA' when 'fundo_forma' then 'FUNDO DE FORMA' when 'bloco' then 'BLOCO'
          when 'fundo_bloco' then 'FUNDO DE BLOCO' when 'funil' then 'FUNIL' when 'cabeca_sopro' then 'CABEÇA DE SOPRO' when 'molde' then 'MOLDE'
          else 'GRUPO ' || m[2] end, m[1], least(seq + 1, 99999))
        returning * into v_grupo;
        grupos_novos := grupos_novos + 1;
      elsif v_grupo.proximo <= seq then
        update public.product_groups set proximo = least(seq + 1, 99999), updated_at = now() where id = v_grupo.id;
      end if;
    end if;

    select * into existente from public.products where organization_id = p_org and codigo = v_codigo;
    if existente.id is null then
      insert into public.products (organization_id, codigo, descricao, group_id, customer_id, tipo_peca, unidade, ncm, origem, material,
        forja_artigo_id, observacoes, created_by_name)
      values (p_org, v_codigo, v_desc, v_grupo.id, nullif(a ->> 'cliente_id', '')::uuid, v_tipo, 'PC',
        case when v_tipo in ('forma', 'bloco', 'fundo_forma', 'fundo_bloco', 'molde', 'funil') then '84805000' end, 0, v_material,
        nullif(a ->> 'forja_id', ''),
        'Cadastrado a partir da Forja (código do GRV). Confira a unidade' || case when v_tipo in ('forma', 'bloco', 'fundo_forma', 'fundo_bloco', 'molde', 'funil') then ' e o NCM.' else '; falta o NCM.' end,
        'Forja');
      novos := novos + 1;
    elsif existente.forja_artigo_id is null and nullif(a ->> 'forja_id', '') is not null then
      update public.products set forja_artigo_id = a ->> 'forja_id', updated_at = now() where id = existente.id;
      vinculados := vinculados + 1;
    end if;
  end loop;
  return jsonb_build_object('novos', novos, 'vinculados', vinculados, 'grupos_novos', grupos_novos, 'ignorados', ignorados);
end;
$$;
revoke all on function public.comercial_produtos_do_forja(uuid, jsonb) from public, anon, authenticated;
-- Só a sincronização da Forja (chave de serviço) chama.
grant execute on function public.comercial_produtos_do_forja(uuid, jsonb) to service_role;

-- Peças das OS já espelhadas da Forja.
select public.comercial_produtos_do_forja(o.organization_id, jsonb_agg(jsonb_build_object(
    'codigo', o.article_code, 'descricao', o.article_description, 'tipo', o.product_type, 'cliente_id', o.customer_id)))
  from (select distinct on (organization_id, article_code) organization_id, article_code, article_description, product_type, customer_id
          from public.production_orders where article_code is not null order by organization_id, article_code, source_updated_at desc nulls last) o
 group by o.organization_id;
