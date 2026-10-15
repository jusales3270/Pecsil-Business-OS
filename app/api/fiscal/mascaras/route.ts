import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Máscaras de impostos, a alíquota do IPI por NCM e os NCMs em uso nos produtos. Leem o Fiscal
 * (configuração e notas) e quem orça; alteram Configuração fiscal (operar) ou quem aprova notas.
 */
export async function GET() {
  const guard = await requireAnyFeature(["fiscal.config", "fiscal.nfe", "comercial.orcamentos"]);
  if ("error" in guard) return guard.error;
  const [{ data: mascaras, error }, { data: ncms }, { data: produtos }] = await Promise.all([
    guard.supabase.from("fiscal_mascaras").select("*").order("cfop").order("codigo"),
    guard.supabase.from("fiscal_ncm").select("ncm, descricao, ipi_aliquota, updated_by_name, updated_at").order("ncm"),
    guard.supabase.from("products").select("ncm").not("ncm", "is", null).limit(5000),
  ]);
  if (error) return dbError(error);
  const emUso = new Map<string, number>();
  for (const p of produtos ?? []) if (p.ncm) emUso.set(p.ncm, (emUso.get(p.ncm) ?? 0) + 1);
  const podeEditar = guard.access.can("fiscal.config", "operar") || guard.access.can("fiscal.nfe", "aprovar");
  // Estado da empresa (para sugerir 5101 × 6101): quem orça não lê a configuração fiscal inteira.
  const autor = await autorDaSessao(guard.supabase);
  const { data: emitente } = autor ? await createSupabaseAdminClient().from("fiscal_config").select("uf").eq("organization_id", autor.org).maybeSingle() : { data: null };
  return NextResponse.json({
    mascaras: mascaras ?? [],
    ncms: ncms ?? [],
    ncmsEmUso: [...emUso.entries()].map(([ncm, produtos]) => ({ ncm, produtos })).sort((a, b) => b.produtos - a.produtos),
    podeEditar,
    ufEmpresa: emitente?.uf ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
