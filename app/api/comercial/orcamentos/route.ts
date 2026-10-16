import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { normalizarOrcamento, totalOrcamento } from "../../../../lib/comercial/vendas";

export const dynamic = "force-dynamic";

const SITUACOES = new Set(["rascunho", "enviado", "ganho", "perdido", "cancelado"]);

/** Comercial › Orçamentos: a lista, com o total de cada um (?treino=1: a do treino, com a numeração T-). */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  const params = new URL(request.url).searchParams;
  const situacao = params.get("situacao");
  const treino = params.get("treino") === "1";
  let consulta = guard.supabase.from("sales_quotes")
    .select("id, numero, treino, customer_id, contato, data_orcamento, validade, situacao, pedido_cliente, prazo_entrega, ganho_em, motivo_perda, created_by_name, updated_at, cliente:customers(name)")
    .eq("treino", treino).order("numero", { ascending: false }).limit(300);
  if (situacao && SITUACOES.has(situacao)) consulta = consulta.eq("situacao", situacao);
  const [{ data: orcamentos, error }, { data: clientes }, { data: numeracao }] = await Promise.all([
    consulta,
    guard.supabase.from("customers").select("id, name").eq("active", true).is("merged_into", null).order("name").limit(1000),
    guard.supabase.from("sales_quote_numbering").select("proximo, proximo_treino").maybeSingle(),
  ]);
  if (error) return dbError(error);
  const ids = (orcamentos ?? []).map((o) => o.id);
  const { data: itens } = ids.length ? await guard.supabase.from("sales_quote_items").select("quote_id, quantidade, preco_unitario").in("quote_id", ids) : { data: [] };
  const porOrcamento = new Map<string, { quantidade: number; preco_unitario: number }[]>();
  for (const i of itens ?? []) porOrcamento.set(i.quote_id, [...(porOrcamento.get(i.quote_id) ?? []), i]);
  return NextResponse.json({
    orcamentos: (orcamentos ?? []).map((o) => ({ ...o, total: totalOrcamento(porOrcamento.get(o.id) ?? []), itens: (porOrcamento.get(o.id) ?? []).length })),
    clientes: clientes ?? [],
    proximoNumero: (treino ? numeracao?.proximo_treino : numeracao?.proximo) ?? 1,
    podeOperar: guard.access.can("comercial.orcamentos", "operar"),
    podeNumeracao: guard.access.can("comercial.orcamentos", "operar"),
  });
}

/** Novo orçamento (rascunho, número automático) ou clone de outro (`clonarDe`). */
export async function POST(request: Request) {
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const [{ data: org }, { data: perfil }] = await Promise.all([guard.supabase.rpc("current_organization_id"), guard.supabase.rpc("current_profile_id")]);
  const { data: autor } = await guard.supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
  const nome = autor?.full_name || autor?.email || null;

  let entrada = corpo;
  let origem: string | null = null;
  let numeroOrigem: number | null = null;
  if (typeof corpo?.clonarDe === "string") {
    // Clone: cabeçalho e itens do orçamento de origem; pedido do cliente, anexos e situação ficam de fora.
    const { data: q } = await guard.supabase.from("sales_quotes").select("*").eq("id", corpo.clonarDe).maybeSingle();
    if (!q) return NextResponse.json({ error: "Orçamento de origem não encontrado." }, { status: 404 });
    const { data: itensOrigem } = await guard.supabase.from("sales_quote_items").select("*").eq("quote_id", q.id).order("ordem");
    origem = q.id;
    numeroOrigem = q.numero;
    // Data de hoje em Brasília (o "hoje" do banco é o de Greenwich: depois das 21h já é amanhã).
    const hojeBrasilia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    entrada = { ...q, pedido_cliente: null, data_orcamento: hojeBrasilia, validade: null, itens: itensOrigem ?? [] };
  }
  const { orcamento, erros } = normalizarOrcamento(entrada);
  if (erros.length && !origem) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  const { itens, ...cabecalho } = orcamento;
  const { data, error } = await guard.supabase.from("sales_quotes").insert({
    ...cabecalho, data_orcamento: cabecalho.data_orcamento ?? undefined, organization_id: org, cloned_from: origem, created_by: perfil, created_by_name: nome,
  }).select("id, numero").single();
  if (error) return dbError(error);
  if (itens.length) {
    const { error: e2 } = await guard.supabase.from("sales_quote_items").insert(itens.map(({ id: _id, ...i }, k) => { void _id; return { ...i, organization_id: org, quote_id: data.id, ordem: k + 1 }; }));
    if (e2) {
      await guard.supabase.from("sales_quotes").delete().eq("id", data.id);
      return dbError(e2);
    }
  }
  if (origem) {
    await guard.supabase.from("sales_quote_notes").insert({ organization_id: org, quote_id: data.id, texto: numeroOrigem ? `Clonado do orçamento #${numeroOrigem}.` : "Clonado de outro orçamento.", autor_profile_id: perfil, autor_nome: nome });
  }
  return NextResponse.json(data);
}
