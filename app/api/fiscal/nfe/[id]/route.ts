import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { normalizarNota } from "../../../../../lib/fiscal/emissao/normalizar";
import { ambienteLiberado, auditar, autorDaSessao, clienteDaOrganizacao, resumoDaNota } from "../../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Contexto = { params: Promise<{ id: string }> };
const EDITAVEL = new Set(["rascunho", "validada"]);

/** A nota com os eventos (cancelamento, cartas de correção). O XML fica nas rotas de download. */
export async function GET(_request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.nfe", "ver");
  if ("error" in guard) return guard.error;
  const { data: nota } = await guard.supabase.from("fiscal_nfe")
    .select("id, ambiente, situacao, serie, numero, chave, emissao, natureza, nota, totais, valor_total, destinatario_nome, destinatario_documento, customer_id, validacao, protocolo, autorizada_em, motivo, montada_por_nome, aprovada_por_nome, cancelada_em, created_at, updated_at")
    .eq("id", id).maybeSingle();
  if (!nota) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  const { data: eventos } = await guard.supabase.from("fiscal_nfe_eventos")
    .select("id, tipo, sequencia, texto, protocolo, created_by_name, created_at").eq("nfe_id", id).order("created_at");
  return NextResponse.json({ nota, eventos: eventos ?? [] });
}

/** Salvar o rascunho. Mexer numa nota validada a devolve para rascunho (precisa validar de novo). */
export async function PUT(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const { data: atual } = await guard.supabase.from("fiscal_nfe").select("id, ambiente, situacao").eq("id", id).maybeSingle();
  if (!atual) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  if (!ambienteLiberado(atual.ambiente)) return NextResponse.json({ error: "Ambiente ainda não liberado." }, { status: 400 });
  if (!EDITAVEL.has(atual.situacao)) return NextResponse.json({ error: "Esta nota não pode mais ser alterada." }, { status: 409 });
  const corpo = (await request.json().catch(() => null)) as { nota?: unknown; customer_id?: string | null } | null;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const nota = normalizarNota(corpo?.nota);
  const { error } = await admin.from("fiscal_nfe").update({
    nota, ...resumoDaNota(nota), customer_id: await clienteDaOrganizacao(admin, autor.org, corpo?.customer_id),
    situacao: "rascunho", validacao: null, motivo: null, updated_at: new Date().toISOString(),
  }).eq("id", id).in("situacao", [...EDITAVEL]);
  if (error) return NextResponse.json({ error: "Não foi possível salvar." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * Descartar a nota ainda não autorizada. No treino some de vez; na produção um número já
 * reservado e não usado precisará ser inutilizado (a tela avisa).
 */
export async function DELETE(_request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const { data: atual } = await guard.supabase.from("fiscal_nfe").select("id, ambiente, situacao, serie, numero").eq("id", id).maybeSingle();
  if (!atual) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  if (atual.ambiente !== "treino") return NextResponse.json({ error: "Só nota de treino pode ser descartada aqui." }, { status: 400 });
  if (!["rascunho", "validada", "aguardando_aprovacao", "rejeitada"].includes(atual.situacao)) {
    return NextResponse.json({ error: "Nota autorizada não se apaga: cancele dentro do prazo." }, { status: 409 });
  }
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  await admin.from("fiscal_nfe").delete().eq("id", id).eq("organization_id", autor.org);
  await auditar(admin, { ...autor, evento: "descartada", nfeId: id, dados: { ambiente: atual.ambiente, serie: atual.serie, numero: atual.numero } });
  return NextResponse.json({ ok: true, numeroSemUso: atual.numero ? { serie: atual.serie, numero: atual.numero } : null });
}
