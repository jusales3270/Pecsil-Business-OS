import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { organizacaoDaSessao, respostaDoErro } from "../../../../../lib/fiscal/rotas";
import { rodadaDistribuicao } from "../../../../../lib/fiscal/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Buscar agora" em Notas recebidas: a mesma rodada da tarefa agendada, só para a organização da
 * sessão. A regra da SEFAZ vale igual: dentro da hora de espera, não consulta (e diz quando pode).
 */
export async function POST() {
  const guard = await requireAnyFeature(["fiscal.icms", "fiscal.config"], "operar");
  if ("error" in guard) return guard.error;
  const org = await organizacaoDaSessao(guard.supabase);
  if (!org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  try {
    const r = await rodadaDistribuicao(createSupabaseAdminClient(), org, { prazoMs: 40_000 });
    return NextResponse.json(r);
  } catch (e) {
    return respostaDoErro(e, "Falha na busca das notas na SEFAZ");
  }
}
