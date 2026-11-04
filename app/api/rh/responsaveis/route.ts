import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Responsável pelo setor (04/11/2026): o RH marca ou desmarca o colaborador (setor = o departamento dele) ou o terceiro
 * do quadro (setor digitado). Quem está marcado aparece em Responsável nas visitas da Portaria. Exige RH › Responsáveis
 * pelo setor em Operar; a função do banco confere de novo e registra o evento na Auditoria.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("rh.responsaveis", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => null)) as { tipo?: unknown; id?: unknown; marcado?: unknown; setor?: unknown } | null;
  const tipo = body?.tipo === "colaborador" || body?.tipo === "terceiro" ? body.tipo : null;
  const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!tipo || !id || typeof body?.marcado !== "boolean") return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("rh_responsavel_setor", {
    p_tipo: tipo, p_id: id, p_marcado: body.marcado, p_setor: typeof body.setor === "string" ? body.setor : null,
  });
  if (error) {
    const conhecido = error.code === "P0001" || error.code === "42501";
    if (!conhecido) console.error("Falha ao marcar responsável pelo setor", error);
    return NextResponse.json({ error: conhecido ? error.message : "Não foi possível gravar a marcação." }, { status: error.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json(data);
}
