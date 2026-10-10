import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { lerConfigClef } from "../../../../lib/decisao/client";

export const dynamic = "force-dynamic";

/** Painel de uso da IA (só o proprietário): cada uso com consumo, acerto e tempo médio. */
export async function GET() {
  const guard = await requireFeature("fundacao.sugestoes", "ver");
  if ("error" in guard) return guard.error;
  if (!guard.access.isOwner) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data, error } = await guard.supabase.rpc("ai_use_stats", { p_days: 30 });
  if (error) {
    console.error("Falha ao ler o painel de uso da IA", error);
    return NextResponse.json({ error: "SUGESTOES_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ configurado: lerConfigClef() !== null, usos: data ?? [] });
}

/** Liga/desliga um uso, troca o modelo ou ajusta os limites de confiança. */
export async function PATCH(request: Request) {
  const guard = await requireFeature("fundacao.sugestoes", "ver");
  if ("error" in guard) return guard.error;
  if (!guard.access.isOwner) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { code?: string; enabled?: boolean; model?: string; limitHigh?: number; limitLow?: number };
  if (!body.code) return NextResponse.json({ error: "Informe o uso." }, { status: 400 });
  const mudancas: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") mudancas.enabled = body.enabled;
  if (body.model !== undefined) {
    if (body.model !== "clef-flash" && body.model !== "clef") return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
    mudancas.model = body.model;
  }
  for (const [campo, coluna] of [["limitHigh", "limit_high"], ["limitLow", "limit_low"]] as const) {
    const v = body[campo];
    if (v === undefined) continue;
    if (typeof v !== "number" || !(v >= 0 && v <= 1)) return NextResponse.json({ error: "Limite deve ficar entre 0 e 1." }, { status: 400 });
    mudancas[coluna] = v;
  }
  if (!Object.keys(mudancas).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });
  const { data: perfil } = await guard.supabase.rpc("current_profile_id");
  const { error } = await guard.supabase.from("ai_uses").update({ ...mudancas, updated_by: perfil ?? null, updated_at: new Date().toISOString() }).eq("code", body.code);
  if (error) return NextResponse.json({ error: error.code === "23514" ? "O limite baixo precisa ficar abaixo do alto." : "Não foi possível alterar o uso." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
