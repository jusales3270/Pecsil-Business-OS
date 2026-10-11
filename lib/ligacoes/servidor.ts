import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { achados } from "./achados";

/**
 * Ligações por regra (Segundo Cérebro, Etapa 4): o que o texto do documento cita vira ligação
 * com a nota, o fornecedor, a cotação… (função `company_document_link_candidates`, só do
 * servidor). Grava com a chave de serviço. Ligação confirmada ou descartada pela pessoa nunca é
 * mexida: descartada não volta.
 */

type Doc = { id: string; organization_id: string };
type Candidato = { target_type: string; target_id: string; target_label: string | null; rule: string; evidence: string | null; confidence: string };

export async function ligarDocumento(admin: SupabaseClient, doc: Doc, texto: string): Promise<number> {
  const a = achados(texto ?? "");
  const { data, error } = await admin.rpc("company_document_link_candidates", {
    p_document: doc.id, p_cnpjs: a.cnpjs, p_chaves: a.chaves, p_nfs: a.nfs, p_cotacoes: a.cotacoes, p_os: a.os,
  });
  if (error) throw new Error(`Falha ao buscar ligações: ${error.message}`);
  const candidatos = (data ?? []) as Candidato[];
  const { data: atuais, error: eAtuais } = await admin.from("company_document_links").select("id, target_type, target_id, status").eq("document_id", doc.id);
  if (eAtuais) throw new Error(`Falha ao ler ligações: ${eAtuais.message}`);
  const chave = (t: string, id: string) => `${t}:${id}`;
  const existentes = new Map((atuais ?? []).map((l) => [chave(l.target_type, l.target_id), l]));
  const novos = candidatos.filter((c) => !existentes.has(chave(c.target_type, c.target_id)));
  if (novos.length) {
    const { error: eIns } = await admin.from("company_document_links").insert(novos.map((c) => ({ organization_id: doc.organization_id, document_id: doc.id, ...c })));
    if (eIns) throw new Error(`Falha ao gravar ligações: ${eIns.message}`);
  }
  // Ligação automática que o texto não sustenta mais sai; a decidida pela pessoa fica.
  const validas = new Set(candidatos.map((c) => chave(c.target_type, c.target_id)));
  const sumiram = (atuais ?? []).filter((l) => l.status === "ativa" && !validas.has(chave(l.target_type, l.target_id))).map((l) => l.id);
  if (sumiram.length) await admin.from("company_document_links").delete().in("id", sumiram);
  await admin.from("company_document_texts").update({ linked_at: new Date().toISOString() }).eq("document_id", doc.id);
  return novos.length;
}

/** Liga sem nunca derrubar quem chamou (leitura, OCR, rodada). */
export async function ligarSemFalhar(admin: SupabaseClient, doc: Doc, texto: string): Promise<number> {
  try {
    return await ligarDocumento(admin, doc, texto);
  } catch (e) {
    console.error("Falha ao ligar documento", doc.id, e);
    return 0;
  }
}

/**
 * Rodada das ligações: documentos lidos e ainda não ligados, e os ligados há mais de 1 dia
 * (assim um documento guardado antes de a nota ou o fornecedor existir acaba ligado).
 */
export async function ligarPendentes(admin: SupabaseClient, limite = 20): Promise<{ ligados: number; novas: number }> {
  const umDia = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await admin.from("company_document_texts")
    .select("document_id, organization_id, content")
    .in("status", ["lido", "sem_texto"])
    .or(`linked_at.is.null,linked_at.lt.${umDia}`)
    .order("linked_at", { ascending: true, nullsFirst: true })
    .limit(limite);
  if (error) throw new Error(error.message);
  let novas = 0;
  for (const t of data ?? []) novas += await ligarSemFalhar(admin, { id: t.document_id, organization_id: t.organization_id }, t.content ?? "");
  return { ligados: (data ?? []).length, novas };
}
