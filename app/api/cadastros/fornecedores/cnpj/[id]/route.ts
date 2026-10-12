import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const DECISOES = new Set(["gravar", "cadastrar", "ligar", "unificar", "recusar"]);

/** Decide uma pendência de CNPJ: gravar · cadastrar · ligar (a um fornecedor escolhido) · unificar · recusar. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["compras.fornecedores", "fundacao.cadastros"], "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { decisao?: string; supplierId?: string };
  if (!body.decisao || !DECISOES.has(body.decisao)) return NextResponse.json({ error: "Decisão inválida." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("supplier_cnpj_decide", { p_id: id, p_decisao: body.decisao, p_supplier: body.supplierId ?? null });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar a decisão." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}
