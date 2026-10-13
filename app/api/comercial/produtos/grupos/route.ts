import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Grupos de produto: dão o código interno no formato do GRV ({prefixo}-{grupo}-{sequência}).
 * Criar ou ajustar (nome, prefixo, próximo número para continuar a sequência do GRV).
 */
export async function POST(request: Request) {
  const guard = await requireFeature("comercial.produtos", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => null)) as { id?: string; codigo?: string; nome?: string; prefixo?: string; proximo?: unknown } | null;
  const codigo = String(b?.codigo ?? "").trim().toUpperCase();
  const nome = String(b?.nome ?? "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 60);
  const prefixo = String(b?.prefixo ?? "5").trim().toUpperCase() || "5";
  const proximo = Number(b?.proximo ?? 1);
  if (!/^[0-9A-Z]{1,6}$/.test(codigo)) return NextResponse.json({ error: "Código do grupo: até 6 letras ou números (ex.: 24)." }, { status: 400 });
  if (!nome) return NextResponse.json({ error: "Informe o nome do grupo (ex.: ANEL)." }, { status: 400 });
  if (!/^[0-9A-Z]{1,6}$/.test(prefixo)) return NextResponse.json({ error: "Prefixo: até 6 letras ou números (ex.: 5)." }, { status: 400 });
  if (!Number.isInteger(proximo) || proximo < 1 || proximo > 99999) return NextResponse.json({ error: "Próximo número entre 1 e 99999." }, { status: 400 });
  const campos = { codigo, nome, prefixo, proximo, updated_at: new Date().toISOString() };
  if (b?.id) {
    const { error } = await guard.supabase.from("product_groups").update(campos).eq("id", b.id);
    if (error) return dbError(error);
    return NextResponse.json({ id: b.id });
  }
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  const { data, error } = await guard.supabase.from("product_groups").insert({ ...campos, organization_id: org }).select("id").single();
  if (error) return dbError(error);
  return NextResponse.json({ id: data.id });
}
