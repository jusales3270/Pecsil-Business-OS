import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../../lib/auth/feature-guard";
import { normalizarOrcamento } from "../../../../../lib/comercial/vendas";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

/**
 * O orçamento inteiro: itens (com produção e faturamento de cada um), anotações, anexos, as notas
 * que entregaram cada item e o histórico de preço dos produtos em outros orçamentos.
 */
export async function GET(_request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  const { data: q, error } = await guard.supabase.from("sales_quotes").select("*, cliente:customers(name, tax_id, uf, ind_ie)").eq("id", id).maybeSingle();
  if (error) return dbError(error);
  if (!q) return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
  const [{ data: itens }, { data: notas }, { data: anexos }, { data: notasFiscais }] = await Promise.all([
    guard.supabase.from("sales_quote_items").select("*, produto:products(codigo, ncm, unidade, desenho_codigo, desenho_revisao, material)").eq("quote_id", id).order("ordem"),
    guard.supabase.from("sales_quote_notes").select("id, texto, autor_nome, created_at").eq("quote_id", id).order("created_at"),
    guard.supabase.from("sales_quote_attachments").select("id, tipo, created_by_name, created_at, documento:company_documents(id, title, original_name)").eq("quote_id", id).order("created_at"),
    guard.supabase.rpc("comercial_orcamento_notas", { p_quote: id }),
  ]);
  const idsItens = (itens ?? []).map((i) => i.id);
  const { data: entradas } = idsItens.length
    ? await guard.supabase.from("production_entries").select("id, quote_item_id, quantidade, data, observacao, created_by_name, created_at").in("quote_item_id", idsItens).order("created_at")
    : { data: [] };
  // Histórico de preço: o mesmo produto em outros orçamentos (os 5 mais recentes de cada).
  const produtos = [...new Set((itens ?? []).map((i) => i.product_id))];
  const { data: historico } = produtos.length
    ? await guard.supabase.from("sales_quote_items")
        .select("product_id, preco_unitario, quantidade, orcamento:sales_quotes!inner(id, numero, data_orcamento, situacao, cliente:customers(name))")
        .in("product_id", produtos).neq("quote_id", id).order("created_at", { ascending: false }).limit(200)
    : { data: [] };
  return NextResponse.json({
    orcamento: q, itens: itens ?? [], anotacoes: notas ?? [], anexos: anexos ?? [], notasFiscais: notasFiscais ?? [], entradas: entradas ?? [],
    historico: historico ?? [],
    podeOperar: guard.access.can("comercial.orcamentos", "operar"),
  });
}

/** Salvar cabeçalho e itens (só em aberto: rascunho ou enviado — o banco confere). */
export async function PUT(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const { data: atual } = await guard.supabase.from("sales_quotes").select("id, organization_id, situacao").eq("id", id).maybeSingle();
  if (!atual) return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
  const { orcamento, erros } = normalizarOrcamento(await request.json().catch(() => null));
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  const { itens, ...cabecalho } = orcamento;
  const aberto = atual.situacao === "rascunho" || atual.situacao === "enviado";
  // Fechado: só observações, contato, validade e prazo mudam (o banco recusa cliente e pedido).
  const mudancas = aberto ? cabecalho : { contato: cabecalho.contato, validade: cabecalho.validade, prazo_entrega: cabecalho.prazo_entrega, observacoes: cabecalho.observacoes, condicao_pagamento: cabecalho.condicao_pagamento };
  const { error } = await guard.supabase.from("sales_quotes").update({ ...mudancas, data_orcamento: cabecalho.data_orcamento ?? undefined }).eq("id", id);
  if (error) return dbError(error);
  if (aberto) {
    const { error: e1 } = await guard.supabase.from("sales_quote_items").delete().eq("quote_id", id);
    if (e1) return dbError(e1);
    if (itens.length) {
      const { error: e2 } = await guard.supabase.from("sales_quote_items").insert(itens.map(({ id: _id, ...i }, k) => { void _id; return { ...i, organization_id: atual.organization_id, quote_id: id, ordem: k + 1 }; }));
      if (e2) return dbError(e2);
    }
  }
  return NextResponse.json({ ok: true });
}

/** Excluir só rascunho (o banco confere). Os outros se cancelam. */
export async function DELETE(_request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("sales_quotes").delete().eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Só rascunho pode ser excluído; os outros se cancelam." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
