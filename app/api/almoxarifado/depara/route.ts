import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { LEITORES_MATERIAIS } from "../../../../lib/almoxarifado/materiais";

export const dynamic = "force-dynamic";

/**
 * De-para do fornecedor (A-01): para os códigos de produto de uma nota (cProd), o material do
 * catálogo já ligado antes para o mesmo CNPJ, com o fator de unidade. Aprende no recebimento.
 *   GET ?cnpj=11222333000181&codigos=RX-25,ZZ-1
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature([...LEITORES_MATERIAIS], "ver");
  if ("error" in guard) return guard.error;
  const p = new URL(request.url).searchParams;
  const cnpj = (p.get("cnpj") ?? "").replace(/\D/g, "");
  const codigos = [...new Set((p.get("codigos") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean))].slice(0, 200);
  if (cnpj.length !== 14 || !codigos.length) return NextResponse.json({ ligacoes: {} });
  const { data, error } = await guard.supabase
    .from("material_codigos_fornecedor")
    .select("codigo_fornecedor, fator, material_id, materials(id, codigo, descricao, unidade, ativo)")
    .eq("cnpj", cnpj)
    .in("codigo_fornecedor", codigos);
  if (error) return NextResponse.json({ error: "Não foi possível ler o de-para." }, { status: 500 });
  const ligacoes: Record<string, { material: { id: string; codigo: string; descricao: string; unidade: string }; fator: number }> = {};
  for (const linha of data ?? []) {
    const m = Array.isArray(linha.materials) ? linha.materials[0] : linha.materials;
    if (m && m.ativo) ligacoes[linha.codigo_fornecedor] = { material: { id: m.id, codigo: m.codigo, descricao: m.descricao, unidade: m.unidade }, fator: Number(linha.fator) || 1 };
  }
  return NextResponse.json({ ligacoes });
}
