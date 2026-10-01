import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Compras avisadas que ainda não foram recebidas por completo. */
export async function GET() {
  const guard = await requireAnyFeature(["almoxarifado.recebimento", "almoxarifado.solicitacoes"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("almoxarifado_a_caminho");
  if (error) {
    console.error("Falha ao ler material a caminho", error);
    return NextResponse.json({ error: "ALMOXARIFADO_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ items: data ?? [], canReceive: guard.access.can("almoxarifado.recebimento", "operar") });
}
