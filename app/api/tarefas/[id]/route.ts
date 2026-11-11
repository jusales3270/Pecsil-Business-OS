import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;
const ACOES = ["comentar", "andamento", "feita", "devolver", "reabrir", "cancelar", "prazo", "responsavel"];

/**
 * Uma tarefa (I-28). GET: a tarefa e o histórico (quem vê, o banco decide). POST { acao, texto, prazo, responsavel }:
 * o andamento, pela função tarefa_atualizar, que confere quem pode o quê (responsável, quem criou, a área).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const [{ data: t }, { data: andamentos }, { data: eu }] = await Promise.all([
    s.supabase.from("tarefas").select("*, quadros(titulo)").eq("id", id).maybeSingle(),
    s.supabase.from("tarefa_andamentos").select("tipo, texto, autor_nome, created_at").eq("tarefa_id", id).order("created_at"),
    s.supabase.rpc("current_profile_id"),
  ]);
  if (!t) return NextResponse.json({ error: "Tarefa não encontrada ou sem permissão." }, { status: 404 });
  return NextResponse.json({ tarefa: t, andamentos: andamentos ?? [], eu });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const corpo = (await request.json().catch(() => null)) as { acao?: string; texto?: string; prazo?: string | null; responsavel?: string | null } | null;
  if (!corpo?.acao || !ACOES.includes(corpo.acao)) return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  const prazo = corpo.prazo && /^\d{4}-\d{2}-\d{2}$/.test(corpo.prazo) ? corpo.prazo : null;
  const responsavel = corpo.responsavel && UUID.test(corpo.responsavel) ? corpo.responsavel : null;
  const { error } = await s.supabase.rpc("tarefa_atualizar", { p_id: id, p_acao: corpo.acao, p_texto: corpo.texto ?? null, p_prazo: prazo, p_responsavel: responsavel });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
