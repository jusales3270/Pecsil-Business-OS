import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";
import { guardarOriginal } from "../../../../../../lib/documentos/guardar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Contexto = { params: Promise<{ id: string }> };
const TIPOS: Record<string, string> = { pedido: "Pedido do cliente", cotacao: "Cotação enviada", outro: "Anexo" };
const LIMITE = 25 * 1024 * 1024;

/**
 * Anexar ao orçamento: o pedido de compra do cliente e a cotação enviada (os dois são exigidos
 * para marcar como ganho — regra do Jefferson), ou outro arquivo. O original fica em Documentos
 * (setor Comercial), visível para quem vê orçamentos.
 */
export async function POST(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const { data: q } = await guard.supabase.from("sales_quotes").select("id, organization_id, numero, situacao, treino").eq("id", id).maybeSingle();
  if (!q) return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
  if (q.situacao !== "rascunho" && q.situacao !== "enviado") return NextResponse.json({ error: "Orçamento fechado: reabra para anexar." }, { status: 409 });
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const tipo = String(form?.get("tipo") ?? "outro");
  if (!(arquivo instanceof File) || !arquivo.size) return NextResponse.json({ error: "Escolha o arquivo." }, { status: 400 });
  if (!(tipo in TIPOS)) return NextResponse.json({ error: "Tipo de anexo desconhecido." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo acima de 25 MB." }, { status: 413 });
  try {
    const guardado = await guardarOriginal(guard.supabase, {
      modulo: "comercial", feature: "comercial.orcamentos", origem: "envio",
      arquivo: { nome: arquivo.name, tipo: arquivo.type, dados: new Uint8Array(await arquivo.arrayBuffer()) },
      titulo: q.treino ? `TREINO · ${TIPOS[tipo]} · orçamento T-${q.numero}` : `${TIPOS[tipo]} · orçamento #${q.numero}`, categoria: TIPOS[tipo], entidade: { tipo: "orcamento", id: q.id },
    });
    const { data: perfil } = await guard.supabase.rpc("current_profile_id");
    const { data: autor } = await guard.supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
    const { error } = await guard.supabase.from("sales_quote_attachments").insert({
      organization_id: q.organization_id, quote_id: q.id, document_id: guardado.id, tipo, created_by_name: autor?.full_name || autor?.email || null,
    });
    if (error && error.code !== "23505") return dbError(error);
    return NextResponse.json({ ok: true, documento: guardado.id });
  } catch (e) {
    console.error("Falha ao anexar no orçamento", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Não foi possível guardar o arquivo." }, { status: 500 });
  }
}

/** Tirar o anexo do orçamento (o original continua em Documentos). */
export async function DELETE(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const anexo = new URL(request.url).searchParams.get("anexo");
  if (!anexo) return NextResponse.json({ error: "Informe o anexo." }, { status: 400 });
  const { data, error } = await guard.supabase.from("sales_quote_attachments").delete().eq("id", anexo).eq("quote_id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Anexo não encontrado ou orçamento fechado." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
