import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { notaDoOrcamento, type ClienteFiscal, type LinhaAFaturar, type ProdutoFiscal } from "../../../../lib/fiscal/emissao/do-orcamento";
import { ambienteLiberado, auditar, autorDaSessao, definirOrigens, emitenteDaOrganizacao, resumoDaNota } from "../../../../lib/fiscal/emissao/servidor";
import { lerNumeroBr } from "../../../../lib/numero-br";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Linha = LinhaAFaturar & { quote_id: string; cliente_id: string; cliente: string; product_id: string; codigo: string; unidade: string; pedido: number; produzido: number; faturado: number; disponivel: number; falta: number };

/**
 * Fiscal › A faturar — o assistente de faturamento do GRV: itens dos orçamentos ganhos com o que
 * foi pedido, produzido e faturado. Por enquanto no TREINO: segue as mesmas regras, sem consumir
 * o saldo real.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "ver");
  if ("error" in guard) return guard.error;
  const ambiente = new URL(request.url).searchParams.get("ambiente") ?? "treino";
  if (!ambienteLiberado(ambiente)) return NextResponse.json({ error: "Ambiente ainda não liberado." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("fiscal_a_faturar", { p_ambiente: ambiente });
  if (error) return dbError(error);
  return NextResponse.json({ itens: data ?? [], ambiente, podeOperar: guard.access.can("fiscal.nfe", "operar") });
}

/** Gera o rascunho da nota com os itens escolhidos (um cliente por nota). */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { ambiente?: string; itens?: { item?: string; quantidade?: unknown }[] } | null;
  const ambiente = corpo?.ambiente ?? "treino";
  if (!ambienteLiberado(ambiente)) return NextResponse.json({ error: "Por enquanto só o ambiente de treino está liberado." }, { status: 400 });
  const pedidos = (corpo?.itens ?? []).map((x) => ({ item: String(x.item ?? ""), quantidade: lerNumeroBr(x.quantidade) })).filter((x) => x.item && x.quantidade > 0);
  if (!pedidos.length) return NextResponse.json({ error: "Escolha ao menos um item e a quantidade." }, { status: 400 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });

  const { data: linhasAll, error } = await guard.supabase.rpc("fiscal_a_faturar", { p_ambiente: ambiente });
  if (error) return dbError(error);
  const linhas = new Map(((linhasAll ?? []) as Linha[]).map((l) => [l.item_id, l]));
  const escolhidas = pedidos.map((p) => ({ ...p, linha: linhas.get(p.item) }));
  if (escolhidas.some((e) => !e.linha)) return NextResponse.json({ error: "Algum item não está mais disponível para faturar. Atualize a tela." }, { status: 409 });
  const clientes = new Set(escolhidas.map((e) => e.linha!.cliente_id));
  if (clientes.size > 1) return NextResponse.json({ error: "Uma nota é de um cliente só: escolha itens do mesmo cliente." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const clienteId = escolhidas[0].linha!.cliente_id;
  const [{ data: cliente }, { data: produtos }, emitente] = await Promise.all([
    admin.from("customers").select("name, tax_id, ie, ind_ie, email_nfe, cep, logradouro, numero, complemento, bairro, municipio, codigo_municipio, uf, telefone").eq("organization_id", autor.org).eq("id", clienteId).single(),
    admin.from("products").select("id, codigo, ncm, unidade, origem").eq("organization_id", autor.org).in("id", escolhidas.map((e) => e.linha!.product_id)),
    emitenteDaOrganizacao(admin, autor.org),
  ]);
  if (!cliente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  const porProduto = new Map((produtos ?? []).map((p) => [p.id, p as ProdutoFiscal & { id: string }]));
  const nota = notaDoOrcamento({
    cliente: cliente as ClienteFiscal,
    linhas: escolhidas.map((e) => ({ linha: e.linha!, quantidade: e.quantidade, produto: porProduto.get(e.linha!.product_id)! })),
    ufEmitente: emitente?.uf ?? "", crt: emitente?.crt ?? 3,
  });
  const { data: criada, error: e1 } = await admin.from("fiscal_nfe").insert({
    organization_id: autor.org, ambiente, situacao: "rascunho", nota, ...resumoDaNota(nota), customer_id: clienteId,
    montada_por: autor.profileId, montada_por_nome: autor.nome,
  }).select("id").single();
  if (e1) return NextResponse.json({ error: "Não foi possível criar a nota." }, { status: 400 });
  const recusa = await definirOrigens(admin, autor.org, criada.id, nota);
  if (recusa) {
    await admin.from("fiscal_nfe").delete().eq("id", criada.id);
    return NextResponse.json({ error: recusa }, { status: 409 });
  }
  await auditar(admin, { ...autor, evento: "criada_do_orcamento", nfeId: criada.id, dados: { ambiente, itens: pedidos } });
  return NextResponse.json({ id: criada.id });
}
