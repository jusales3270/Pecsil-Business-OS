import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const erro = (error: { code?: string; message: string }) =>
  NextResponse.json(
    { error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível concluir." },
    { status: error.code === "42501" ? 403 : 400 },
  );

/** Parcelamentos e lançamentos antigos à espera de revisão (Contas a pagar › Histórico a revisar). */
export async function GET() {
  const guard = await requireFeature("financeiro.pagar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("finance_review_groups");
  if (error) {
    console.error("Falha ao ler a revisão do histórico", error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    grupos: data ?? [],
    podeAprovar: guard.access.can("financeiro.pagar", "aprovar"),
    podeEditar: guard.access.can("financeiro.pagar", "operar"),
  });
}

/** Aprovar (sobe para as contas certas) ou excluir (sai do Financeiro) uma série inteira. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { acao?: string; serie?: string };
  if (!body.serie || !["aprovar", "excluir"].includes(body.acao ?? "")) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const guard = await requireFeature("financeiro.pagar", "aprovar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc(body.acao === "aprovar" ? "finance_review_approve" : "finance_review_delete", { p_series: body.serie });
  if (error) return erro(error);
  return NextResponse.json(data);
}

/** Editar os dados da série e das parcelas; com `aprovar: true`, aprova junto. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { serie?: string; aprovar?: boolean } & Record<string, unknown>;
  if (!body.serie) return NextResponse.json({ error: "Série não informada." }, { status: 400 });
  const guard = await requireFeature("financeiro.pagar", body.aprovar ? "aprovar" : "operar");
  if ("error" in guard) return guard.error;
  const { serie, ...dados } = body;
  const { data, error } = await guard.supabase.rpc("finance_review_update", { p_series: serie, p: dados });
  if (error) return erro(error);
  return NextResponse.json(data);
}
