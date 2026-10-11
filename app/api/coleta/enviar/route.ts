import { NextResponse } from "next/server";
import { exigirColeta } from "../../../../lib/coleta/acesso";
import { guardarOriginal } from "../../../../lib/documentos/guardar";
import { LIMITE_DOCUMENTO } from "../../../../lib/documentos/acesso";
import { setorPorModulo } from "../../../../lib/documentos/setores";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Guarda um arquivo aprovado na conferência da coleta, sempre no setor da coleta (origem
 * "coleta"): o setor vem da credencial, nunca da tela. Se o Clef sugeriu um setor, guardar aqui
 * decide a sugestão (aceita se ele disse este setor, corrigida se disse outro).
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const guard = await exigirColeta(form?.get("modulo"));
  if ("error" in guard) return guard.error;
  const arquivo = form?.get("arquivo");
  const setor = setorPorModulo(guard.setor);
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  if (!setor) return NextResponse.json({ error: "Setor da coleta inválido." }, { status: 400 });
  if (arquivo.size > LIMITE_DOCUMENTO) return NextResponse.json({ error: "O arquivo passa de 9,5 MB." }, { status: 413 });
  const pasta = String(form?.get("pasta") ?? "").slice(0, 200);
  try {
    const r = await guardarOriginal(guard.supabase, {
      modulo: setor.modulo, feature: setor.feature, origem: "coleta",
      arquivo: { nome: arquivo.name, tipo: arquivo.type, dados: new Uint8Array(await arquivo.arrayBuffer()) },
      titulo: arquivo.name, categoria: pasta ? `Coleta · ${pasta}`.slice(0, 60) : "Coleta",
    });
    const julgamento = String(form?.get("julgamentoId") ?? "");
    const sugerido = String(form?.get("setorSugerido") ?? "");
    if (julgamento && sugerido) {
      await guard.supabase.rpc("ai_judgment_decide", {
        p_id: julgamento, p_outcome: sugerido === setor.modulo ? "aceita" : "corrigida",
        p_note: sugerido === setor.modulo ? null : `Setor certo: ${setor.rotulo}`,
      });
    }
    return NextResponse.json({ ...r }, { status: r.existente ? 200 : 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "42501") return NextResponse.json({ error: "Sem permissão para coletar arquivos." }, { status: 403 });
    console.error("Falha ao guardar arquivo da coleta", e);
    return NextResponse.json({ error: "Não foi possível guardar o arquivo." }, { status: 400 });
  }
}
