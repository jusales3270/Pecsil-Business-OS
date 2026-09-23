import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../../lib/auth/feature-guard";
import { pontoMedio, precisaRenumerar, renumerar } from "../../../../../../../lib/kanban/fractional-indexing";

export const dynamic = "force-dynamic";

/**
 * Move o card para outra etapa e/ou outra posição.
 *
 * Duas pessoas mexendo no mesmo quadro é o caso normal, não a exceção. Por
 * isso a tela manda o `updatedAt` que ela viu: se o card mudou nesse meio
 * tempo, a resposta é **409** e a tela recarrega — em vez de desfazer
 * silenciosamente o que a outra pessoa acabou de fazer.
 *
 * A posição sai do ponto médio entre os vizinhos. Quando o espaço entre eles
 * acaba (divisões demais no mesmo ponto), a coluna é renumerada e o card
 * entra com a posição limpa.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("comercial.funil", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const { supabase } = guard;

  const stageId = String(body.stageId ?? "");
  if (!stageId) return NextResponse.json({ error: "Informe a etapa de destino." }, { status: 400 });

  const atual = await supabase.from("crm_cards").select("id, stage_id, position, updated_at, status").eq("id", id).maybeSingle();
  if (atual.error) return dbError(atual.error);
  if (!atual.data) return NextResponse.json({ error: "Card não encontrado." }, { status: 404 });

  // Concorrência: quem move precisa ter visto a versão que está no banco.
  if (body.expectedUpdatedAt && body.expectedUpdatedAt !== atual.data.updated_at) {
    return NextResponse.json(
      { error: "CARD_MUDOU", detalhe: "Outra pessoa mexeu neste card. A tela vai recarregar." },
      { status: 409 },
    );
  }

  const destino = await supabase.from("crm_stages").select("id, kind, label").eq("id", stageId).maybeSingle();
  if (destino.error) return dbError(destino.error);
  if (!destino.data) return NextResponse.json({ error: "Etapa não encontrada." }, { status: 404 });

  // Perder exige motivo — o banco também cobra, mas o erro fica mais claro aqui.
  const lostReason = typeof body.lostReason === "string" ? body.lostReason.trim() : "";
  if (destino.data.kind === "perdido" && !lostReason) {
    return NextResponse.json({ error: "Diga por que o card foi perdido." }, { status: 400 });
  }

  // Vizinhos na coluna de destino, já sem o próprio card.
  const coluna = await supabase
    .from("crm_cards")
    .select("id, position")
    .eq("stage_id", stageId)
    .neq("id", id)
    .order("position");
  if (coluna.error) return dbError(coluna.error);

  const vizinhos = (coluna.data ?? []).map((linha) => ({ id: linha.id, position: Number(linha.position) }));
  const indice = Number.isInteger(body.index) ? Math.max(0, Math.min(vizinhos.length, body.index)) : vizinhos.length;
  const anterior = indice > 0 ? vizinhos[indice - 1].position : null;
  const seguinte = indice < vizinhos.length ? vizinhos[indice].position : null;

  let position = pontoMedio(anterior, seguinte);
  if (precisaRenumerar(position)) {
    // Sem espaço entre os vizinhos: a coluna recebe posições limpas e o card
    // entra no lugar pedido.
    const limpas = renumerar(vizinhos.length);
    for (let i = 0; i < vizinhos.length; i += 1) {
      const { error } = await supabase.from("crm_cards").update({ position: limpas[i] }).eq("id", vizinhos[i].id);
      if (error) return dbError(error);
    }
    const antesLimpo = indice > 0 ? limpas[indice - 1] : null;
    const depoisLimpo = indice < limpas.length ? limpas[indice] : null;
    position = pontoMedio(antesLimpo, depoisLimpo);
  }

  const mudancas: Record<string, unknown> = { stage_id: stageId, position };
  if (destino.data.kind === "perdido") mudancas.lost_reason = lostReason;

  const { data, error } = await supabase
    .from("crm_cards")
    .update(mudancas)
    .eq("id", id)
    .select("id, stage_id, position, status, closed_at, updated_at")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Card não encontrado." }, { status: 404 });
  return NextResponse.json({ card: data, etapa: destino.data.label });
}
