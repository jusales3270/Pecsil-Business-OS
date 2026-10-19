import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { erroDoBanco } from "../../../../lib/ti/servidor";
import { COLUNAS_ATIVO } from "../../../../lib/ti/colunas";

export const dynamic = "force-dynamic";

/** Inventário de TI. A TI que atende chamados e quem vê a saúde também consultam (para ligar equipamento). */
export async function GET() {
  const guard = await requireAnyFeature(["ti.ativos", "ti.saude", "ti.chamados"], "ver");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("ti_ativos").select(COLUNAS_ATIVO).order("numero").limit(2000);
  if (error) {
    console.error("TI: falha ao ler o inventário", error);
    return NextResponse.json({ error: "TI_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ ativos: data ?? [], podeEditar: guard.access.can("ti.ativos", "operar") });
}

/** Cadastra (sem `id`) ou altera um equipamento. */
export async function POST(request: Request) {
  const guard = await requireFeature("ti.ativos", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { data, error } = await guard.supabase.rpc("ti_salvar_ativo", { p: body });
  if (error) return erroDoBanco(error, "Não foi possível salvar o equipamento.");
  return NextResponse.json(data, { status: 201 });
}
