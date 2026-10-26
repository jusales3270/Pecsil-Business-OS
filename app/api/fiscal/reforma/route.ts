import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { premissasDosParametros } from "../../../../lib/contabil/reforma";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Simulador da reforma (N-11): os dados para a conta, que roda na tela (lib/contabil/reforma.ts). Orçamentos
 * e máscaras pela sessão (cada um vê o que já vê); as premissas da reforma vêm dos parâmetros legais, que são
 * públicos para quem vê o Fiscal ou os orçamentos.
 */
const LEITURA = ["fiscal.icms", "fiscal.config", "fiscal.parametros", "fiscal.nfe", "fiscal.escritorio", "fiscal.portal", "fiscal.contabilidade", "comercial.orcamentos"] as const;
const CHAVES = ["reforma_aliquota_referencia", "reforma_2026_fase_teste", "reforma_2027", "reforma_2029_2033"];

type Orc = { id: string; numero: number | null; data_orcamento: string | null; situacao: string; treino: boolean; condicao_pagamento: string | null; mascara_id: string | null; cliente: { name: string } | null; itens: { quantidade: number; preco_unitario: number }[] };

export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const admin = createSupabaseAdminClient();
  const [{ data: orcs }, { data: mascaras }, { data: params }] = await Promise.all([
    guard.supabase.from("sales_quotes").select("id, numero, data_orcamento, situacao, treino, condicao_pagamento, mascara_id, cliente:customers(name), itens:sales_quote_items(quantidade, preco_unitario)").order("created_at", { ascending: false }).limit(200),
    guard.supabase.from("fiscal_mascaras").select("id, codigo, descricao, cfop, icms_aliquota, icms_reducao_base, ipi_aliquota, pis_aliquota, cofins_aliquota, pis_cofins_exclui_icms").eq("ativo", true).order("codigo"),
    admin.from("contabil_parametros").select("chave, valor, situacao, vigente_de, fonte").in("chave", CHAVES).neq("situacao", "descartado").order("vigente_de", { ascending: false }),
  ]);
  // A versão mais recente de cada parâmetro (a conferida antes do rascunho).
  const porChave = new Map<string, { chave: string; valor: unknown; situacao: string; fonte: { norma?: string } | null }>();
  for (const p of [...(params ?? [])].sort((a, b) => Number(b.situacao === "conferido") - Number(a.situacao === "conferido"))) if (!porChave.has(p.chave)) porChave.set(p.chave, p);
  const orcamentos = ((orcs ?? []) as unknown as Orc[]).map((o) => ({
    id: o.id, numero: o.numero, data: o.data_orcamento, situacao: o.situacao, treino: o.treino, cliente: o.cliente?.name ?? null, mascaraId: o.mascara_id,
    prazo: Number((o.condicao_pagamento ?? "").match(/\d+/)?.[0] ?? 0) || null, condicao: o.condicao_pagamento,
    total: Math.round((o.itens ?? []).reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0) * 100) / 100,
  }));
  return NextResponse.json({ orcamentos, mascaras: mascaras ?? [], ...premissasDosParametros([...porChave.values()]) }, { headers: { "Cache-Control": "no-store" } });
}
