import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Compras diretas (compra sem cotação, que nasce aprovada como OC nº N). A
 * mesma lista no Compras e no Almoxarifado: o Almoxarifado não lê cotações
 * pelo RLS, então ela sai de uma função do banco.
 */
export async function GET() {
  const guard = await requireAnyFeature(["compras.cotacoes", "compras.aprovacoes", "compras.realizadas", "almoxarifado.recebimento"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("compras_diretas_listar", { p_limite: 300 });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("Falha ao listar compras diretas", error);
    return NextResponse.json({ error: "Não foi possível carregar as compras diretas." }, { status: 503 });
  }
  return NextResponse.json({ items: data ?? [] });
}

/** Caminho do Compras: o Ricardo pediu, a OC nasce aprovada e registrada (previsão a pagar e "A caminho"). */
export async function POST(request: Request) {
  const guard = await requireAnyFeature(["compras.cotacoes", "compras.realizadas"], "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados da compra direta ausentes." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("compras_direta_registrar", { p: body });
  if (error) {
    const conhecido = error.code === "P0001" || error.code === "42501";
    if (!conhecido) console.error("Falha ao registrar compra direta", error);
    return NextResponse.json({ error: conhecido ? error.message : "Não foi possível registrar a compra direta." }, { status: error.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
