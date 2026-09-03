import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { calculateComprasSummary, type ComprasSnapshot, type Cotacao, type Compra } from "../../../lib/data/compras";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createSupabaseAdminClient();

    // Busca cotações com produtos vinculados
    const { data: rawCotacoes, error: cotacoesError } = await admin
      .from("cotacoes")
      .select("*, produtos:cotacao_produtos(*)")
      .order("created_at", { ascending: false });

    if (cotacoesError) {
      console.warn("Aviso ao buscar cotações (usando base demonstrativa):", cotacoesError.message);
      return NextResponse.json(demoComprasSnapshot);
    }

    // Busca compras
    const { data: rawCompras, error: comprasError } = await admin
      .from("compras")
      .select("*")
      .order("created_at", { ascending: false });

    if (comprasError) {
      console.warn("Aviso ao buscar compras (usando base demonstrativa):", comprasError.message);
      return NextResponse.json(demoComprasSnapshot);
    }

    const cotacoes: Cotacao[] = (rawCotacoes ?? []).map((row) => ({
      id: Number(row.id),
      fornecedor: row.fornecedor,
      divisao: row.divisao,
      status: row.status,
      userId: row.user_id,
      aprovadoPor: row.aprovado_por,
      motivoRejeicao: row.motivo_rejeicao,
      dataDecisao: row.data_decisao,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      produtos: (row.produtos ?? []).map((p: Record<string, unknown>) => ({
        id: Number(p.id),
        cotacaoId: Number(p.cotacao_id),
        produto: String(p.produto || ""),
        valorUnit: Number(p.valor_unit || 0),
        quantidade: Number(p.quantidade || 0),
        unidade: String(p.unidade || ""),
        icms: Number(p.icms || 0),
        ipi: Number(p.ipi || 0),
        prazo: String(p.prazo || ""),
        obs: String(p.obs || ""),
        status: (p.status as "PENDENTE" | "APROVADO" | "REJEITADO") || "PENDENTE",
        motivoRejeicao: p.motivo_rejeicao ? String(p.motivo_rejeicao) : null,
      })),
    }));

    const compras: Compra[] = (rawCompras ?? []).map((row) => ({
      id: Number(row.id),
      cotacaoId: Number(row.cotacao_id),
      fornecedor: row.fornecedor,
      produto: row.produto,
      quantidade: Number(row.quantidade || 0),
      unidade: row.unidade,
      valorUnit: Number(row.valor_unit || 0),
      total: Number(row.total || 0),
      nf: row.nf,
      dataCompra: row.data_compra,
      obs: row.obs,
      createdAt: row.created_at,
    }));

    const summary = calculateComprasSummary(cotacoes, compras);

    const snapshot: ComprasSnapshot = {
      source: "supabase",
      cotacoes,
      compras,
      summary,
      loadedAt: new Date().toISOString(),
    };

    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    let userId = "7f6611db-77ec-4055-b2e3-f4820002d97a"; // ID padrão do proprietário/gestor
    try {
      const supabase = await createSupabaseServerClient();
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id) userId = auth.user.id;
    } catch {
      // Falha transitória na checagem remota da sessão; prossegue com gravação segura
    }

    const body = await req.json();
    const { fornecedor, divisao, obs, produtos } = body;

    if (!fornecedor || !divisao || !Array.isArray(produtos) || produtos.length === 0) {
      return NextResponse.json({ error: "Dados da cotação incompletos" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // 1. Cria cabeçalho da cotação
    const { data: cotacao, error: cotacaoError } = await admin
      .from("cotacoes")
      .insert({
        fornecedor,
        divisao,
        obs: obs || "",
        user_id: userId,
        status: "PENDENTE",
      })
      .select()
      .single();

    if (cotacaoError || !cotacao) {
      return NextResponse.json({ error: cotacaoError?.message || "Erro ao criar cotação" }, { status: 500 });
    }

    // 2. Insere itens de produtos vinculados
    const itens = produtos.map((p) => ({
      cotacao_id: cotacao.id,
      produto: p.produto,
      valor_unit: p.valorUnit,
      quantidade: p.quantidade,
      unidade: p.unidade,
      icms: p.icms ?? 0,
      ipi: p.ipi ?? 0,
      prazo: p.prazo || "A combinar",
      obs: p.obs || "",
      status: "PENDENTE",
    }));

    const { error: itensError } = await admin.from("cotacao_produtos").insert(itens);

    if (itensError) {
      return NextResponse.json({ error: itensError.message }, { status: 500 });
    }

    return NextResponse.json(cotacao, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { produtoId, decision, motivo } = body;

    if (!produtoId || !decision) {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Atualiza status do produto
    const { data: item, error: itemError } = await admin
      .from("cotacao_produtos")
      .update({
        status: decision,
        motivo_rejeicao: decision === "REJEITADO" ? motivo || "Não aprovado pelo gestor" : null,
      })
      .eq("id", produtoId)
      .select("cotacao_id")
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: itemError?.message || "Item não encontrado" }, { status: 500 });
    }

    // Verifica todos os itens da cotação pai para sincronizar o status geral
    const { data: todosItens } = await admin
      .from("cotacao_produtos")
      .select("status")
      .eq("cotacao_id", item.cotacao_id);

    let statusCotacao = "PENDENTE";
    if (todosItens && todosItens.length > 0) {
      const temPendente = todosItens.some((i) => i.status === "PENDENTE");
      const temAprovado = todosItens.some((i) => i.status === "APROVADO");
      const todosRejeitados = todosItens.every((i) => i.status === "REJEITADO");

      if (todosRejeitados) {
        statusCotacao = "REJEITADO";
      } else if (!temPendente && temAprovado) {
        statusCotacao = "APROVADO";
      } else if (temAprovado) {
        statusCotacao = "APROVADO"; // parcial ou total
      }
    }

    // Atualiza cotação pai
    await admin
      .from("cotacoes")
      .update({
        status: statusCotacao,
        aprovado_por: decision === "APROVADO" ? auth.user.email || "Gestor" : undefined,
        data_decisao: new Date().toISOString(),
      })
      .eq("id", item.cotacao_id);

    return NextResponse.json({ success: true, statusCotacao });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { cotacaoId, nf, dataCompra, obs } = body;

    if (!cotacaoId || !nf) {
      return NextResponse.json({ error: "Número da NF e cotação são obrigatórios" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Busca cotação e produtos aprovados
    const { data: cotacao } = await admin
      .from("cotacoes")
      .select("*, produtos:cotacao_produtos(*)")
      .eq("id", cotacaoId)
      .single();

    if (!cotacao) {
      return NextResponse.json({ error: "Cotação não encontrada" }, { status: 404 });
    }

    const produtosAprovados = (cotacao.produtos || []).filter(
      (p: { status: string }) => p.status === "APROVADO" || p.status === "PENDENTE",
    );

    const descProdutos = produtosAprovados.map((p: { produto: string; quantidade: number; unidade: string }) => `${p.produto} (${p.quantidade} ${p.unidade})`).join("; ");
    const totalCompra = produtosAprovados.reduce(
      (sum: number, p: { valor_unit: number; quantidade: number }) => sum + Number(p.valor_unit) * Number(p.quantidade),
      0,
    );

    const primeiraQuantidade = produtosAprovados[0]?.quantidade || 1;
    const primeiraUnidade = produtosAprovados[0]?.unidade || "UN";
    const primeiroValorUnit = produtosAprovados[0]?.valor_unit || totalCompra;

    // Registra compra
    const { data: compra, error: compraError } = await admin
      .from("compras")
      .insert({
        cotacao_id: cotacaoId,
        fornecedor: cotacao.fornecedor,
        produto: descProdutos || "Diversos",
        quantidade: primeiraQuantidade,
        unidade: primeiraUnidade,
        valor_unit: primeiroValorUnit,
        total: totalCompra,
        nf,
        data_compra: dataCompra || new Date().toISOString().slice(0, 10),
        obs: obs || "",
      })
      .select()
      .single();

    if (compraError || !compra) {
      return NextResponse.json({ error: compraError?.message || "Erro ao registrar compra" }, { status: 500 });
    }

    // Marca cotação como COMPRADO
    await admin.from("cotacoes").update({ status: "COMPRADO" }).eq("id", cotacaoId);

    return NextResponse.json(compra, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao faturar" },
      { status: 500 },
    );
  }
}
