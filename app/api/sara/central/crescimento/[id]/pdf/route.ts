import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../../../lib/auth/session-access";
import { documentoDoCrescimento, type Relatorio } from "../../../../../../../lib/sara/central/crescimento";
import { guardarDocumento } from "../../../../../../../lib/sara/central/documentos";
import { requireUserSession } from "../../../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * O relatório de crescimento em PDF (War Room › Conselho › Crescimento › "Gerar o PDF"), com o timbre, para abrir,
 * imprimir ou enviar. Só para quem tem a SARA central. O mesmo relatório pedido de novo pela mesma pessoa devolve o
 * PDF que já existe (não gasta outro número DOC).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const sb = session.supabase;
  const access = await readSessionAccess(sb).catch(() => null);
  if (!access?.canModule("warroom") || !access.can("warroom.sara", "ver")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: rel } = await sb.from("sara_relatorios").select("id, semana, situacao, conteudo").eq("id", id).maybeSingle<{ id: string; semana: string; situacao: string; conteudo: Relatorio | null }>();
  if (!rel?.conteudo || rel.situacao !== "feito") return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
  const origem = `crescimento:${rel.id}`;
  const eu = (await sb.rpc("current_profile_id")).data as string | null;
  const { data: ja } = await sb.from("sara_documentos").select("id, numero, paginas").eq("criado_por", eu ?? "").eq("conteudo->>origem", origem).not("caminho", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; numero: string; paginas: number | null }>();
  if (ja) return NextResponse.json({ id: ja.id, numero: ja.numero, paginas: ja.paginas ?? 0, existente: true });
  const g = await guardarDocumento(sb, documentoDoCrescimento(rel.conteudo, rel.semana), null, { origem });
  if ("erro" in g) return NextResponse.json({ error: g.erro }, { status: 500 });
  return NextResponse.json(g);
}
