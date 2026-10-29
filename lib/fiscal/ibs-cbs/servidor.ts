import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { lerIbsCbs, type NotaIbsCbs } from "./leitura";

/**
 * Leitura do IBS/CBS das NF-e guardadas (N-03), com a chave de serviço. Três portas, o mesmo caminho:
 * o envio do arquivo (lerDocumento, na hora), a tarefa de 10 em 10 minutos (sincronizarTodas) e a abertura da
 * tela (sincronizar). Cada XML é lido uma vez; XML que não é NF-e fica marcado (lado "outra", sem competência)
 * para não ser baixado de novo. Nota lida antes de a conferência existir (sem o regime do emitente) ou antes do resumo de
 * receita do Presumido é relida.
 */
const BUCKET = "empresa-documentos";
const LOTE = 150;
const MIME_XML = ["text/xml", "application/xml"];

const pareceXml = (nome: string | null | undefined, tipo: string | null | undefined) => MIME_XML.includes(String(tipo ?? "")) || /\.xml$/i.test(String(nome ?? ""));

async function cnpjDaEmpresa(admin: SupabaseClient, org: string) {
  const { data } = await admin.from("fiscal_config").select("cnpj").eq("organization_id", org).maybeSingle();
  const cnpj = (data?.cnpj ?? "").replace(/\D/g, "");
  return cnpj.length === 14 ? cnpj : null;
}

function linha(org: string, origem: { document_id: string } | { nfe_id: string }, n: NotaIbsCbs | null): Record<string, unknown> {
  if (!n) return { organization_id: org, ...origem, lado: "outra", tem_grupo: false, itens: [] };
  return {
    organization_id: org, ...origem, chave: n.chave, numero: n.numero, lado: n.lado, finalidade: n.finalidade, emissao: n.emissao, competencia: n.competencia,
    emitente_cnpj: n.emitenteCnpj, emitente_nome: n.emitenteNome, emitente_crt: n.emitenteCrt, destinatario_cnpj: n.destinatarioCnpj, tem_grupo: n.temGrupo,
    v_bc: n.vBC, v_ibs_uf: n.vIBSUF, v_ibs_mun: n.vIBSMun, v_ibs: n.vIBS, v_cbs: n.vCBS, v_nf: n.vNF, itens: n.itens, receita: n.receita,
  };
}

/**
 * Grava uma leitura. O mesmo documento lido por duas portas ao mesmo tempo esbarra no índice do documento e fica
 * uma vez. A mesma NF-e (chave) vinda de outro documento é gravada como repetida (`repetida_de`): o documento fica
 * lido, mas a nota conta uma vez só (índice único da chave). Devolve true quando a leitura vale.
 */
async function gravar(admin: SupabaseClient, registro: Record<string, unknown>) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const original = registro.chave ? await leituraQueVale(admin, String(registro.organization_id), String(registro.chave)) : null;
    const { error } = await admin.from("fiscal_ibscbs_notas").insert(original ? { ...registro, repetida_de: original } : registro);
    if (!error) return !original;
    if (error.code !== "23505") throw new Error(error.message);
    // 23505 no índice do documento: já lido. No da chave: outra porta leu a mesma nota agora; tenta de novo como repetida.
    if (!String(error.message).includes("chave_unica")) return false;
  }
  return false;
}

/** A leitura que vale de uma NF-e (a primeira), pela chave. */
async function leituraQueVale(admin: SupabaseClient, org: string, chave: string): Promise<string | null> {
  const { data } = await admin.from("fiscal_ibscbs_notas").select("id").eq("organization_id", org).eq("chave", chave).is("repetida_de", null).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** A NF-e já está lida na plataforma (por um documento ou emitida por ela)? Devolve o documento que vale, se houver. */
export async function notaJaLida(admin: SupabaseClient, org: string, chave: string): Promise<{ documentId: string | null; nfeId: string | null } | null> {
  const { data } = await admin.from("fiscal_ibscbs_notas").select("document_id, nfe_id").eq("organization_id", org).eq("chave", chave).is("repetida_de", null).limit(1).maybeSingle();
  if (data) return { documentId: (data.document_id as string | null) ?? null, nfeId: (data.nfe_id as string | null) ?? null };
  const { data: nfe } = await admin.from("fiscal_nfe").select("id").eq("organization_id", org).eq("chave", chave).eq("ambiente", "producao").eq("situacao", "autorizada").limit(1).maybeSingle();
  return nfe ? { documentId: null, nfeId: nfe.id as string } : null;
}

/** Documento recém-guardado: lê na hora, sem derrubar o envio. */
export async function lerDocumento(admin: SupabaseClient, org: string, doc: { id: string; nome?: string | null; tipo?: string | null }, dados: Uint8Array) {
  if (!pareceXml(doc.nome, doc.tipo)) return;
  try {
    const cnpj = await cnpjDaEmpresa(admin, org);
    if (!cnpj) return; // sem o CNPJ não há como separar entrada de saída: a tela avisa e lê depois
    const n = lerIbsCbs(new TextDecoder().decode(dados), cnpj);
    await gravar(admin, linha(org, { document_id: doc.id }, n));
  } catch (e) {
    console.error("IBS/CBS: falha ao ler o documento", doc.id, e);
  }
}

/** Lê o que falta de uma empresa (no máximo LOTE documentos por vez). */
export async function sincronizar(admin: SupabaseClient, org: string): Promise<{ lidas: number; aviso: string | null; pendentes: number }> {
  const cnpj = await cnpjDaEmpresa(admin, org);
  if (!cnpj) return { lidas: 0, aviso: "Configure o CNPJ da empresa em Fiscal › Configuração para separar entradas e saídas.", pendentes: 0 };
  // Lidas antes da conferência (sem o regime do emitente e a composição da base): saem para serem relidas.
  await admin.from("fiscal_ibscbs_notas").delete().eq("organization_id", org).not("competencia", "is", null).is("emitente_crt", null);
  // Lidas antes do resumo de receita (base do Lucro Presumido, N-07): saem para serem relidas.
  await admin.from("fiscal_ibscbs_notas").delete().eq("organization_id", org).not("competencia", "is", null).is("receita", null);

  const { data: lidos } = await admin.from("fiscal_ibscbs_notas").select("document_id").eq("organization_id", org).not("document_id", "is", null);
  const ja = new Set((lidos ?? []).map((l) => l.document_id as string));
  const { data: docs } = await admin.from("company_documents").select("id, storage_path").eq("organization_id", org).in("mime_type", MIME_XML).is("archived_at", null).order("created_at", { ascending: false }).limit(2000);
  const faltam = (docs ?? []).filter((d) => !ja.has(d.id));
  let lidas = 0;
  for (const d of faltam.slice(0, LOTE)) {
    const { data: blob } = await admin.storage.from(BUCKET).download(d.storage_path);
    if (!blob) continue;
    const n = lerIbsCbs(await blob.text(), cnpj);
    if ((await gravar(admin, linha(org, { document_id: d.id }, n))) && n) lidas++;
  }
  // NF-e emitida pela plataforma em produção (o treino não conta).
  const { data: emitidas } = await admin.from("fiscal_nfe").select("id, xml_autorizado").eq("organization_id", org).eq("ambiente", "producao").not("xml_autorizado", "is", null);
  const { data: jaNfe } = await admin.from("fiscal_ibscbs_notas").select("nfe_id").eq("organization_id", org).not("nfe_id", "is", null);
  const nfeLidas = new Set((jaNfe ?? []).map((l) => l.nfe_id as string));
  for (const e of (emitidas ?? []).filter((x) => !nfeLidas.has(x.id)).slice(0, LOTE)) {
    const n = lerIbsCbs(String(e.xml_autorizado), cnpj);
    if ((await gravar(admin, linha(org, { nfe_id: e.id }, n))) && n) lidas++;
  }
  return { lidas, aviso: null, pendentes: Math.max(0, faltam.length - LOTE) };
}

/** Tarefa agendada: todas as empresas com o Fiscal configurado. */
export async function sincronizarTodas(admin: SupabaseClient) {
  const { data: orgs } = await admin.from("fiscal_config").select("organization_id, cnpj");
  const resultado: { org: string; lidas: number; aviso: string | null }[] = [];
  for (const o of orgs ?? []) {
    try {
      const r = await sincronizar(admin, o.organization_id as string);
      resultado.push({ org: o.organization_id as string, lidas: r.lidas, aviso: r.aviso });
    } catch (e) {
      resultado.push({ org: o.organization_id as string, lidas: 0, aviso: e instanceof Error ? e.message.slice(0, 200) : "erro" });
    }
  }
  return resultado;
}
