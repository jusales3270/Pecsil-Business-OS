import { NextResponse } from "next/server";
import { requireUserSession } from "../../../lib/supabase/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Decisões para você (menu da conta). GET: as minhas (as que esperam resposta primeiro); `?contar=1`
 * devolve só quantas esperam. POST: responder (ou mudar a resposta). Qualquer pessoa logada: o banco só
 * entrega e só aceita a resposta de quem recebeu a pergunta.
 */
type Decisao = { id: string; resposta: string | null };

export async function GET(request: Request) {
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const { data, error } = await s.supabase.rpc("decisoes_minhas");
  if (error) return NextResponse.json({ error: "Não foi possível carregar as decisões." }, { status: 500 });
  const lista = (data ?? []) as Decisao[];
  const pendentes = lista.filter((d) => !d.resposta).length;
  if (new URL(request.url).searchParams.get("contar") === "1") return NextResponse.json({ pendentes });
  return NextResponse.json({ pendentes, decisoes: lista });
}

export async function POST(request: Request) {
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const b = (await request.json().catch(() => null)) as { id?: string; resposta?: string; nota?: string } | null;
  if (!b?.id || !UUID.test(b.id)) return NextResponse.json({ error: "Decisão não encontrada." }, { status: 404 });
  const { error } = await s.supabase.rpc("decisao_responder", { p_id: b.id, p_resposta: String(b.resposta ?? ""), p_nota: b.nota ? String(b.nota).slice(0, 1000) : null });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
