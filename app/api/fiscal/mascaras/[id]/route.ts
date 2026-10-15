import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { normalizarMascara } from "../../../../../lib/fiscal/mascaras";
import { autorDaSessao } from "../../../../../lib/fiscal/emissao/servidor";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

/**
 * Altera a máscara (corpo com os campos que mudaram) ou registra a conferência com o contador
 * ({ confirmar: true } / { confirmar: false }). Mudar um número tira a confirmação (o banco faz).
 */
export async function PUT(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["fiscal.config", "fiscal.nfe"]);
  if ("error" in guard) return guard.error;
  if (!(guard.access.can("fiscal.config", "operar") || guard.access.can("fiscal.nfe", "aprovar"))) {
    return NextResponse.json({ error: "Só a Configuração fiscal (operar) ou quem aprova notas altera as máscaras." }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Máscara inválida." }, { status: 400 });
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return NextResponse.json({ error: "Dados ausentes." }, { status: 400 });

  let patch: Record<string, unknown>;
  if (typeof corpo.confirmar === "boolean") {
    const autor = await autorDaSessao(guard.supabase);
    if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
    patch = corpo.confirmar
      ? { confirmada_em: new Date().toISOString(), confirmada_por: autor.profileId, confirmada_por_nome: autor.nome }
      : { confirmada_em: null, confirmada_por: null, confirmada_por_nome: null };
  } else {
    const r = normalizarMascara(corpo);
    if (r.erros.length) return NextResponse.json({ error: r.erros.join(" ") }, { status: 400 });
    patch = r.patch;
  }
  const { data, error } = await guard.supabase.from("fiscal_mascaras").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Máscara não encontrada." }, { status: 404 });
  return NextResponse.json({ mascara: data });
}
