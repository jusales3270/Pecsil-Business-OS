import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { OrdemIndisponivel, montarOrdemCompra, type FreteTipo, type ItemCotacao } from "../../../../../lib/compras/ordem-compra";

export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v) || 0;
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Ordem de Compra da cotação (o número da OC é o da cotação). Só os itens
 * aprovados entram; antes da aprovação devolve 409. Lê com a sessão de quem
 * pede (RLS do Compras).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyFeature(["compras.cotacoes", "compras.aprovacoes", "compras.realizadas"], "ver");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Cotação inválida." }, { status: 400 });

  const { data: c, error } = await guard.supabase
    .from("cotacoes")
    .select("id, status, fornecedor, supplier_id, material_request_id, aprovado_por, data_decisao, deleted_at, frete_tipo, frete_valor, seguro_valor, outras_despesas, prazo_entrega, observacao, produto, valor_unit, quantidade, unidade, icms, ipi, prazo")
    .eq("id", Number(id))
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Não foi possível carregar a cotação." }, { status: 500 });
  if (!c || c.deleted_at) return NextResponse.json({ error: "Cotação não encontrada." }, { status: 404 });

  const { data: produtos } = await guard.supabase
    .from("cotacao_produtos")
    .select("id, produto, quantidade, unidade, valor_unit, icms, ipi, prazo, status")
    .eq("cotacao_id", c.id)
    .order("id");
  const itens: ItemCotacao[] = (produtos ?? []).length
    ? (produtos ?? []).map((p) => ({ produto: p.produto, quantidade: num(p.quantidade), unidade: p.unidade ?? "", valorUnit: num(p.valor_unit), icms: num(p.icms), ipi: num(p.ipi), prazo: p.prazo, status: p.status }))
    : c.produto
      ? [{ produto: c.produto, quantidade: num(c.quantidade), unidade: c.unidade ?? "", valorUnit: num(c.valor_unit), icms: num(c.icms), ipi: num(c.ipi), prazo: c.prazo, status: null }]
      : [];

  // Fornecedor do cadastro; se foi unificado, o que ficou.
  let fornecedor: Record<string, unknown> | null = null;
  if (c.supplier_id) {
    const colunas = "id, name, legal_name, tax_id, state_registration, contact_name, phone, email, address, city, state, postal_code, payment_terms, merged_into";
    const { data: s } = await guard.supabase.from("suppliers").select(colunas).eq("id", c.supplier_id).maybeSingle();
    fornecedor = s;
    if (s?.merged_into) {
      const { data: final } = await guard.supabase.from("suppliers").select(colunas).eq("id", s.merged_into).maybeSingle();
      fornecedor = final ?? s;
    }
  }
  let solicitante: string | null = null;
  if (c.material_request_id) {
    const { data: pedido } = await guard.supabase.from("material_requests").select("requested_by_name").eq("id", c.material_request_id).maybeSingle();
    solicitante = pedido?.requested_by_name ?? null;
  }

  try {
    const ordem = montarOrdemCompra(
      {
        id: Number(c.id), status: c.status, fornecedor: c.fornecedor, aprovadoPor: c.aprovado_por, dataDecisao: c.data_decisao,
        freteTipo: (c.frete_tipo ?? "CIF") as FreteTipo, freteValor: num(c.frete_valor), seguroValor: num(c.seguro_valor), outrasDespesas: num(c.outras_despesas),
        prazoEntrega: c.prazo_entrega, observacao: c.observacao,
      },
      itens,
      {
        nome: texto(fornecedor?.legal_name) ?? texto(fornecedor?.name) ?? c.fornecedor,
        cnpj: texto(fornecedor?.tax_id), ie: texto(fornecedor?.state_registration), contato: texto(fornecedor?.contact_name),
        telefone: texto(fornecedor?.phone), email: texto(fornecedor?.email), endereco: texto(fornecedor?.address), cidade: texto(fornecedor?.city),
        uf: texto(fornecedor?.state), cep: texto(fornecedor?.postal_code), prazoPagamento: texto(fornecedor?.payment_terms),
      },
      solicitante,
    );
    return NextResponse.json({ ordem });
  } catch (e) {
    if (e instanceof OrdemIndisponivel) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
