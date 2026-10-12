import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { sha256 } from "../../../../../lib/documentos/guardar";
import { caminhoDocumento } from "../../../../../lib/documentos/setores";
import { lerEGravar } from "../../../../../lib/leitura/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 15_000_000;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Anexo do portal (competência ou pendência), dos dois lados. O arquivo sobe com a chave de serviço
 * (o bucket não tem política para usuários) e o registro é feito com a SESSÃO, que confere o lado e
 * o aceite do termo; se o registro falhar, o arquivo é apagado. Fica em Documentos › Fiscal com a
 * funcionalidade fiscal.portal — o escritório só enxerga esses.
 */
export async function POST(request: Request) {
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const competencia = String(form?.get("competencia") ?? "");
  const pendencia = String(form?.get("pendencia") ?? "");
  if (!(arquivo instanceof File) || !arquivo.size) return NextResponse.json({ error: "Escolha o arquivo." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo acima de 15 MB." }, { status: 413 });
  if (!UUID.test(competencia) && !UUID.test(pendencia)) return NextResponse.json({ error: "Anexe a uma competência ou a uma pendência." }, { status: 400 });
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  if (!org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });

  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const caminho = caminhoDocumento(String(org), "fiscal", randomUUID(), arquivo.name);
  const admin = createSupabaseAdminClient();
  const { error: eUp } = await admin.storage.from("empresa-documentos").upload(caminho, dados, { contentType: arquivo.type || "application/octet-stream", upsert: false });
  if (eUp) return NextResponse.json({ error: "Não foi possível guardar o arquivo." }, { status: 503 });
  const { data: doc, error } = await guard.supabase.rpc("fiscal_portal_anexo_registrar", {
    p_competencia: UUID.test(competencia) ? competencia : null, p_pendencia: UUID.test(pendencia) ? pendencia : null,
    p_original_name: arquivo.name, p_mime: arquivo.type || null, p_size: dados.byteLength, p_sha256: sha256(dados), p_storage_path: caminho,
  });
  if (error) {
    await admin.storage.from("empresa-documentos").remove([caminho]);
    return NextResponse.json({ error: error.message || "Não foi possível anexar." }, { status: error.code === "42501" ? 403 : 400 });
  }
  await lerEGravar(admin, { id: String(doc), organization_id: String(org) }, dados); // leitura e ligações, sem derrubar o envio
  return NextResponse.json({ ok: true, id: doc });
}
