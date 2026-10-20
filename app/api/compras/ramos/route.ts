import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Ramos de um pedido de material: itens encaminhados a um fornecedor para cotar (aguardando preço).
 * Ler: quem vê cotações (a tela lê direto, pelo RLS). Encaminhar e cancelar: quem lança cotações.
 */
type Acao = { acao: "criar"; pedido: string; itens: string[]; fornecedorId: string } | { acao: "cancelar"; id: string };

export async function POST(request: Request) {
  const guard = await requireFeature("compras.cotacoes", "operar");
  if ("error" in guard) return guard.error;
  const a = (await request.json().catch(() => null)) as Acao | null;
  if (a?.acao === "criar") {
    const itens = Array.isArray(a.itens) ? a.itens.filter((x) => UUID.test(String(x))).slice(0, 200) : [];
    if (!UUID.test(String(a.pedido)) || !itens.length) return NextResponse.json({ error: "Marque ao menos um item do pedido." }, { status: 400 });
    if (!UUID.test(String(a.fornecedorId))) return NextResponse.json({ error: "Escolha o fornecedor no cadastro (ou cadastre-o na hora)." }, { status: 400 });
    const { data, error } = await guard.supabase.rpc("compras_ramo_criar", { p_pedido: a.pedido, p_itens: itens, p_supplier: a.fornecedorId });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    return NextResponse.json(data, { status: 201 });
  }
  if (a?.acao === "cancelar") {
    if (!UUID.test(String(a.id))) return NextResponse.json({ error: "Encaminhamento inválido." }, { status: 400 });
    const { error } = await guard.supabase.rpc("compras_ramo_cancelar", { p_ramo: a.id });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
