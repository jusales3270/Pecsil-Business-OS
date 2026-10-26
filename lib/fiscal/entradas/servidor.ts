import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { checar, lerNotaEntrada, situacaoDa } from "./checagem";

/**
 * Leitura das notas de entrada para a checagem (N-09), com a chave de serviço. Mesmas três portas do IBS/CBS:
 * o envio do arquivo (lerEntrada, na hora), a tarefa de 10 em 10 minutos e a abertura da tela. Cada XML de
 * NF-e é lido uma vez; o que não é NF-e fica marcado como "fora" para não ser baixado de novo. A classificação
 * proposta é calculada na hora da tela (as dicas mudam); aqui só a leitura e os achados.
 */
const BUCKET = "empresa-documentos";
const LOTE = 150;
const MIME_XML = ["text/xml", "application/xml"];

async function empresa(admin: SupabaseClient, org: string) {
  const { data } = await admin.from("fiscal_config").select("cnpj, uf").eq("organization_id", org).maybeSingle();
  const cnpj = (data?.cnpj ?? "").replace(/\D/g, "");
  return cnpj.length === 14 ? { cnpj, uf: String(data?.uf ?? "") } : null;
}

function linha(org: string, documentId: string, xml: string, e: { cnpj: string; uf: string }): Record<string, unknown> {
  const n = lerNotaEntrada(xml);
  if (!n) return { organization_id: org, document_id: documentId, situacao: "fora" };
  const paraEmpresa = (n.destinatarioCnpj ?? "").replace(/\D/g, "") === e.cnpj;
  const achados = paraEmpresa ? checar(n, e.uf) : [];
  return {
    organization_id: org, document_id: documentId, chave: n.chave, numero: n.numero, emissao: n.emissao, competencia: n.competencia, finalidade: n.finalidade,
    emitente_cnpj: n.emitente.cnpj, emitente_nome: n.emitente.nome, emitente_uf: n.emitente.uf, emitente_crt: n.emitente.crt, v_nf: n.vNF,
    itens: n.itens, achados, situacao: paraEmpresa ? situacaoDa(achados) : "fora",
  };
}

async function gravar(admin: SupabaseClient, registro: Record<string, unknown>) {
  const { error } = await admin.from("fiscal_entradas").insert(registro);
  if (error && error.code !== "23505") throw new Error(error.message);
  return !error;
}

/** Documento recém-guardado: lê na hora, sem derrubar o envio. */
export async function lerEntrada(admin: SupabaseClient, org: string, doc: { id: string; nome?: string | null; tipo?: string | null }, dados: Uint8Array) {
  if (!MIME_XML.includes(String(doc.tipo ?? "")) && !/\.xml$/i.test(String(doc.nome ?? ""))) return;
  try {
    const e = await empresa(admin, org);
    if (e) await gravar(admin, linha(org, doc.id, new TextDecoder().decode(dados), e));
  } catch (err) {
    console.error("Entradas: falha ao ler o documento", doc.id, err);
  }
}

export async function sincronizarEntradas(admin: SupabaseClient, org: string): Promise<{ lidas: number; aviso: string | null }> {
  const e = await empresa(admin, org);
  if (!e) return { lidas: 0, aviso: "Configure o CNPJ da empresa em Fiscal › Configuração." };
  const { data: lidos } = await admin.from("fiscal_entradas").select("document_id").eq("organization_id", org);
  const ja = new Set((lidos ?? []).map((l) => l.document_id as string));
  const { data: docs } = await admin.from("company_documents").select("id, storage_path").eq("organization_id", org).in("mime_type", MIME_XML).is("archived_at", null).order("created_at", { ascending: false }).limit(2000);
  let lidas = 0;
  for (const d of (docs ?? []).filter((x) => !ja.has(x.id)).slice(0, LOTE)) {
    const { data: blob } = await admin.storage.from(BUCKET).download(d.storage_path);
    if (blob && (await gravar(admin, linha(org, d.id, await blob.text(), e)))) lidas++;
  }
  return { lidas, aviso: null };
}

export async function sincronizarEntradasTodas(admin: SupabaseClient) {
  const { data: orgs } = await admin.from("fiscal_config").select("organization_id");
  const saida: { org: string; lidas: number; aviso: string | null }[] = [];
  for (const o of orgs ?? []) {
    try { saida.push({ org: o.organization_id as string, ...(await sincronizarEntradas(admin, o.organization_id as string)) }); }
    catch (err) { saida.push({ org: o.organization_id as string, lidas: 0, aviso: err instanceof Error ? err.message.slice(0, 200) : "erro" }); }
  }
  return saida;
}
