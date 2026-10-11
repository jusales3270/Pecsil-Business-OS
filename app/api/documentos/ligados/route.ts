import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

const TIPOS = new Set(["fornecedor", "cliente", "nota_icms", "recebimento", "titulo", "cotacao", "os"]);

/**
 * Documentos ligados a uma entidade (Segundo Cérebro, Etapa 4): `?tipo=fornecedor&id=…`. O banco
 * (RLS) só entrega a ligação a quem vê o documento E a entidade. Descartadas não aparecem.
 */
export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const url = new URL(request.url);
  const tipo = url.searchParams.get("tipo") ?? "";
  const id = (url.searchParams.get("id") ?? "").slice(0, 80);
  if (!TIPOS.has(tipo) || !id) return NextResponse.json({ error: "Informe o tipo e o id." }, { status: 400 });
  let acesso;
  try {
    acesso = await readSessionAccess(session.supabase);
  } catch {
    return NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 });
  }
  const { data, error } = await session.supabase.from("company_document_links")
    .select("id, rule, evidence, confidence, status, documento:company_documents(id, title, original_name, module_code, feature_code, created_at, archived_at, leitura:company_document_texts(status, method, pages))")
    .eq("target_type", tipo).eq("target_id", id).neq("status", "descartada")
    .order("created_at", { ascending: false }).limit(200);
  if (error) {
    console.error("Falha ao listar documentos ligados", error);
    return NextResponse.json({ error: "LIGACOES_UNAVAILABLE" }, { status: 503 });
  }
  type Linha = { id: string; rule: string; evidence: string | null; confidence: string; status: string; documento: { feature_code: string; archived_at: string | null } | null };
  const ligacoes = ((data ?? []) as unknown as Linha[])
    .filter((l) => l.documento && !l.documento.archived_at)
    .map((l) => ({ ...l, podeDecidir: acesso.isOwner || acesso.can(l.documento!.feature_code, "operar") }));
  return NextResponse.json({ ligacoes });
}
