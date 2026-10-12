import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { linhasDoPdf, textoDoPdf } from "../arquivos/pdf-texto";
import { lerXls } from "../arquivos/xls";
import { tipoDoArquivo } from "../arquivos/detectar";
import { lerNfe } from "../almoxarifado/nfe-xml";
import { ligarPendentes, ligarSemFalhar } from "../ligacoes/servidor";
import { indexarPendentes } from "../significado/servidor";
import { imagensDoPdf, ocr } from "./ocr";
import { LIMITE_TEXTO, lerTexto, type Extratores, type Leitura } from "./texto";

/**
 * Leitura no servidor (Etapa 3): o texto de cada documento guardado vai para
 * `company_document_texts`, sempre relido a partir do original e gravado com a chave de serviço.
 * PDF escaneado e foto ficam "pendente_ocr" e são lidos pela rodada agendada (OCR local, D4).
 * Depois de lido, o documento é ligado ao que cita (Etapa 4: nota, fornecedor, cotação…).
 */

const BUCKET = "empresa-documentos";
const MAX_TENTATIVAS = 3;

export const extratoresServidor: Extratores = {
  // O pdfjs toma posse do buffer que recebe: passa uma cópia, para o OCR ainda poder usar o original.
  pdf: async (dados) => (await textoDoPdf(dados.slice(), 400)).map((p) => linhasDoPdf(p).map((l) => l.map((i) => i.s).join(" ")).join("\n")),
  xls: async (dados) => lerXls(Buffer.from(dados)).map((l) => l.filter((c) => c !== null && c !== "").join(" | ")).filter(Boolean),
};

type Doc = { id: string; organization_id: string };

async function gravar(admin: SupabaseClient, doc: Doc, campos: Record<string, unknown>) {
  // Texto (re)lido: os vetores de significado são refeitos na próxima rodada (embedded_at = null).
  const { error } = await admin.from("company_document_texts").upsert({ document_id: doc.id, organization_id: doc.organization_id, read_at: new Date().toISOString(), embedded_at: null, ...campos });
  if (error) throw new Error(`Não foi possível gravar a leitura: ${error.message}`);
}

const comoLido = (l: Extract<Leitura, { status: "lido" }>) => ({ status: "lido", method: l.metodo, content: l.texto, pages: l.paginas, chars: l.texto.length, error: null });

/** Lê o texto (sem OCR) e grava. Sem texto e passível de OCR → "pendente_ocr". Nunca lança. */
export async function lerEGravar(admin: SupabaseClient, doc: Doc, dados: Uint8Array, tentativas = 0): Promise<Leitura | null> {
  try {
    const l = await lerTexto(dados, extratoresServidor);
    if (l.status === "lido") await gravar(admin, doc, { ...comoLido(l), attempts: tentativas });
    else await gravar(admin, doc, { status: l.ocr ? "pendente_ocr" : "sem_texto", method: null, content: null, pages: null, chars: 0, error: l.motivo.slice(0, 300), attempts: tentativas });
    // Sem texto ainda liga pela origem (a nota ou o recebimento de onde o documento veio).
    await ligarSemFalhar(admin, doc, l.status === "lido" ? l.texto : "");
    await cnpjDoEmitente(admin, doc, dados);
    return l;
  } catch (e) {
    console.error("Falha ao ler documento", doc.id, e);
    await gravar(admin, doc, { status: "erro", error: (e instanceof Error ? e.message : "falha na leitura").slice(0, 300), attempts: tentativas + 1 }).catch(() => undefined);
    return null;
  }
}

/**
 * XML de NF-e guardado: o CNPJ e o nome do emitente vão para a fila "CNPJ a conferir" quando o
 * cadastro ainda não tem aquele CNPJ (o banco decide se é completar, novo ou nada). Nunca derruba.
 */
async function cnpjDoEmitente(admin: SupabaseClient, doc: Doc, dados: Uint8Array) {
  if (tipoDoArquivo(dados) !== "nfe-xml") return;
  try {
    const nfe = lerNfe(new TextDecoder("utf-8").decode(dados));
    if (!nfe.emitente.cnpj) return;
    const { error } = await admin.rpc("supplier_cnpj_registrar", { p_org: doc.organization_id, p_cnpj: nfe.emitente.cnpj, p_nome: nfe.emitente.nome || nfe.emitente.fantasia, p_documento: doc.id });
    if (error) console.error("Falha ao registrar CNPJ do emitente", doc.id, error.message);
  } catch {
    // XML que não é NF-e válida: nada a registrar.
  }
}

/** OCR de um documento (PDF escaneado ou foto). */
async function lerPorOcr(admin: SupabaseClient, doc: Doc, dados: Uint8Array, tentativas: number) {
  const imagens = tipoDoArquivo(dados) === "imagem" ? [Buffer.from(dados)] : await imagensDoPdf(dados);
  const textos = await ocr(imagens);
  const texto = textos.join("\n\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMITE_TEXTO);
  if (texto.replace(/\s/g, "").length < 3) {
    await gravar(admin, doc, { status: "sem_texto", method: "ocr", content: null, pages: imagens.length, chars: 0, error: imagens.length ? "o OCR não encontrou texto" : "sem imagem de página para ler", attempts: tentativas });
    return "sem_texto" as const;
  }
  await gravar(admin, doc, { status: "lido", method: "ocr", content: texto, pages: imagens.length, chars: texto.length, error: null, attempts: tentativas });
  await ligarSemFalhar(admin, doc, texto);
  return "lido" as const;
}

export type Rodada = { vistos: number; lidos: number; ocr: number; semTexto: number; erros: number; restantes: boolean; ligados: number; ligacoesNovas: number; indexados: number; trechos: number; modeloSignificado: boolean };

/**
 * Uma rodada da fila: documentos ainda sem leitura (inclui os guardados antes desta etapa) e os
 * que esperam o OCR. Para ao bater o prazo (o OCR pesa); a próxima rodada continua.
 */
export async function processarPendentes(admin: SupabaseClient, { limite = 10, prazoMs = 50_000 } = {}): Promise<Rodada> {
  const inicio = Date.now();
  const r: Rodada = { vistos: 0, lidos: 0, ocr: 0, semTexto: 0, erros: 0, restantes: false, ligados: 0, ligacoesNovas: 0, indexados: 0, trechos: 0, modeloSignificado: true };
  const { data, error } = await admin.rpc("company_document_texts_pendentes", { p_limite: limite });
  if (error) throw new Error(error.message);
  const fila = (data ?? []) as { id: string; organization_id: string; storage_path: string; status: string | null; attempts: number }[];
  for (const item of fila) {
    if (Date.now() - inicio > prazoMs) { r.restantes = true; break; }
    r.vistos++;
    const doc = { id: item.id, organization_id: item.organization_id };
    try {
      const { data: arquivo, error: eBaixar } = await admin.storage.from(BUCKET).download(item.storage_path);
      if (eBaixar || !arquivo) throw new Error(`arquivo não encontrado no armazenamento${eBaixar ? `: ${eBaixar.message}` : ""}`);
      const dados = new Uint8Array(await arquivo.arrayBuffer());
      // Sem leitura ou com erro: lê o texto de novo; se for escaneado/foto, segue para o OCR.
      let precisaOcr = item.status === "pendente_ocr";
      if (!item.status || item.status === "erro") {
        const l = await lerEGravar(admin, doc, dados, item.attempts);
        if (!l) { r.erros++; continue; }
        if (l.status === "lido") { r.lidos++; continue; }
        precisaOcr = l.ocr;
        if (!precisaOcr) { r.semTexto++; continue; }
      }
      if (precisaOcr) {
        const res = await lerPorOcr(admin, doc, dados, item.attempts + 1);
        if (res === "lido") r.ocr++; else r.semTexto++;
      }
    } catch (e) {
      r.erros++;
      const tentativas = item.attempts + 1;
      console.error("Falha na leitura do documento", item.id, e);
      await gravar(admin, doc, { status: tentativas >= MAX_TENTATIVAS ? "erro" : (item.status ?? "erro"), error: (e instanceof Error ? e.message : "falha na leitura").slice(0, 300), attempts: tentativas }).catch(() => undefined);
    }
  }
  if (fila.length === limite) r.restantes = true;
  // Ligações (Etapa 4): os lidos ainda sem ligação e os religados do dia, se sobrou tempo.
  if (Date.now() - inicio < prazoMs) {
    const l = await ligarPendentes(admin, 20).catch((e) => { console.error("Falha na rodada de ligações", e); return { ligados: 0, novas: 0 }; });
    r.ligados = l.ligados;
    r.ligacoesNovas = l.novas;
  }
  // Significado (Etapa 5B): trechos e vetores dos textos lidos, com o tempo que sobrou.
  const sobra = prazoMs - (Date.now() - inicio);
  if (sobra > 5_000) {
    const ix = await indexarPendentes(admin, sobra).catch((e) => { console.error("Falha na rodada de significado", e); return { indexados: 0, trechos: 0, modelo: false }; });
    r.indexados = ix.indexados;
    r.trechos = ix.trechos;
    r.modeloSignificado = ix.modelo;
  }
  return r;
}
