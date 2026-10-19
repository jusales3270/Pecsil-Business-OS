import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * A ficha do Segundo Cérebro nas telas dos módulos (etapa G3). Quem decide o que aparece é o banco
 * (cerebro_ficha): a ficha só vem para quem pode ver o registro, e cada número e cada ligação só para
 * quem tem a permissão da área dele. Sem permissão ou sem ficha: 404 (a tela simplesmente não mostra).
 */
const TIPOS = new Set(["fornecedor", "cliente", "material", "item"]);

export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const q = new URL(request.url).searchParams;
  const tipo = q.get("tipo") ?? "";
  const chave = (q.get("chave") ?? "").slice(0, 200);
  if (!TIPOS.has(tipo) || !chave) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const { data, error } = await session.supabase.rpc("cerebro_ficha", { p_tipo: tipo, p_chave: chave });
  if (error) return NextResponse.json({ error: "CEREBRO_UNAVAILABLE" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(data);
}
