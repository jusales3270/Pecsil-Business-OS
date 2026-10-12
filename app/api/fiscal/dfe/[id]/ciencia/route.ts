import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import { organizacaoDaSessao, respostaDoErro } from "../../../../../../lib/fiscal/rotas";
import { darCiencia } from "../../../../../../lib/fiscal/servidor";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Dar ciência" numa nota recebida (evento informativo 210210): avisa a SEFAZ que a empresa sabe
 * da nota e libera o XML completo, que chega na próxima busca e vai para Documentos.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  // A sessão precisa enxergar a nota (RLS) antes de o servidor agir por ela.
  const { data: visivel } = await guard.supabase.from("fiscal_dfe").select("id").eq("id", id).maybeSingle();
  if (!visivel) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  const org = await organizacaoDaSessao(guard.supabase);
  if (!org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  try {
    const r = await darCiencia(createSupabaseAdminClient(), org, id);
    return NextResponse.json({ ok: true, mensagem: r.jaTinha ? "A ciência já estava registrada." : "Ciência registrada. O XML completo chega na próxima busca." });
  } catch (e) {
    return respostaDoErro(e, "Falha na ciência da operação");
  }
}
