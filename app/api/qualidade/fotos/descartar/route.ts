import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { apagarArquivos } from "../../../../../lib/qualidade/fotos-servidor";

export const dynamic = "force-dynamic";

/** Descarta as fotos pendentes que a pessoa mandou numa conversa com a SARA (nada foi registrado com elas). */
export async function POST(request: Request) {
  const guard = await requireFeature("qualidade.nao_conformidades", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as { conversa?: string };
  if (!b.conversa || !/^[0-9a-f-]{36}$/i.test(b.conversa)) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("qualidade_fotos_descartar", { p_conversa: b.conversa });
  if (error) return dbError(error);
  const caminhos = (data ?? []) as string[];
  await apagarArquivos(caminhos);
  return NextResponse.json({ descartadas: caminhos.length });
}
