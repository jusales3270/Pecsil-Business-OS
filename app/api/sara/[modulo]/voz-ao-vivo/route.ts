import { NextResponse } from "next/server";
import { preparar } from "../../../../../lib/sara/sessao";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Direct realtime sessions cannot currently enforce a provider-side spending cap. */
export async function POST(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const p = await preparar((await context.params).modulo);
  if ("erro" in p) return p.erro;
  return NextResponse.json({ error: "A voz ao vivo está temporariamente indisponível enquanto o controle de consumo é atualizado. Use texto ou envie um áudio." }, { status: 503 });
}
