import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { chaveDaNfe, sha256 } from "../../../../../lib/documentos/guardar";
import { caminhoDocumento } from "../../../../../lib/documentos/setores";
import { lerEntrada } from "../../../../../lib/fiscal/entradas/servidor";
import { lerDocumento as lerIbsCbs } from "../../../../../lib/fiscal/ibs-cbs/servidor";
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
 * funcionalidade fiscal.portal — o escritório só enxerga esses. O mesmo arquivo já guardado no Fiscal não é
 * guardado de novo (o anexo aponta para ele); o mesmo arquivo ou a mesma NF-e (pela chave) anexados de novo no
 * mesmo lugar são recusados (409).
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
  const admin = createSupabaseAdminClient();
  // A mesma NF-e já anexada aqui (mesmo em outro arquivo: outro download, com ou sem protocolo) não entra de novo.
  const chave = chaveDaNfe(dados);
  if (chave) {
    const alvo = UUID.test(competencia) ? { coluna: "competencia_id", id: competencia } : { coluna: "pendencia_id", id: pendencia };
    const { data: aqui } = await guard.supabase.from("fiscal_portal_anexos").select("document_id, nome").eq(alvo.coluna, alvo.id);
    const ids = (aqui ?? []).map((x) => String(x.document_id));
    if (ids.length) {
      const { data: mesma } = await admin.from("fiscal_ibscbs_notas").select("document_id, numero").eq("organization_id", String(org)).eq("chave", chave).in("document_id", ids).limit(1).maybeSingle();
      if (mesma) {
        const nome = (aqui ?? []).find((x) => String(x.document_id) === String(mesma.document_id))?.nome;
        return NextResponse.json({ error: `${mesma.numero ? `A NF-e ${mesma.numero}` : "Esta NF-e"} já está anexada aqui${nome ? ` (${nome})` : ""}. Nada foi anexado de novo.` }, { status: 409 });
      }
    }
  }
  const caminho = caminhoDocumento(String(org), "fiscal", randomUUID(), arquivo.name);
  const { error: eUp } = await admin.storage.from("empresa-documentos").upload(caminho, dados, { contentType: arquivo.type || "application/octet-stream", upsert: false });
  if (eUp) return NextResponse.json({ error: "Não foi possível guardar o arquivo." }, { status: 503 });
  const { data: doc, error } = await guard.supabase.rpc("fiscal_portal_anexo_registrar", {
    p_competencia: UUID.test(competencia) ? competencia : null, p_pendencia: UUID.test(pendencia) ? pendencia : null,
    p_original_name: arquivo.name, p_mime: arquivo.type || null, p_size: dados.byteLength, p_sha256: sha256(dados), p_storage_path: caminho,
  });
  if (error) {
    await admin.storage.from("empresa-documentos").remove([caminho]);
    // 23505: o mesmo arquivo já está anexado aqui (a mensagem diz quando e por quem).
    return NextResponse.json({ error: error.message || "Não foi possível anexar." }, { status: error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400 });
  }
  // O mesmo arquivo já guardado no Fiscal: o anexo aponta para ele, e a cópia que acabou de subir sai.
  const { data: guardado } = await admin.from("company_documents").select("storage_path").eq("id", String(doc)).maybeSingle();
  const reaproveitado = Boolean(guardado && guardado.storage_path !== caminho);
  if (reaproveitado) await admin.storage.from("empresa-documentos").remove([caminho]);
  else {
    // Leitura na hora (texto e ligações; NF-e: IBS/CBS, receita e conferência), sem derrubar o envio.
    await lerEGravar(admin, { id: String(doc), organization_id: String(org) }, dados);
    const tipo = { id: String(doc), nome: arquivo.name, tipo: arquivo.type || null };
    await lerIbsCbs(admin, String(org), tipo, dados);
    await lerEntrada(admin, String(org), tipo, dados);
  }
  return NextResponse.json({ ok: true, id: doc, existente: reaproveitado });
}

/**
 * Excluir um anexo (?id=<anexo>): só o lado que enviou, com a competência aberta e a pendência não resolvida
 * (fiscal_portal_anexo_excluir confere e registra na auditoria). O arquivo sai do armazenamento quando o documento sai.
 */
export async function DELETE(request: Request) {
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Anexo inválido." }, { status: 400 });
  const { data: caminho, error } = await guard.supabase.rpc("fiscal_portal_anexo_excluir", { p_anexo: id });
  if (error) return NextResponse.json({ error: error.message || "Não foi possível excluir." }, { status: error.code === "42501" ? 403 : 400 });
  if (caminho) await createSupabaseAdminClient().storage.from("empresa-documentos").remove([String(caminho)]);
  return NextResponse.json({ ok: true });
}
