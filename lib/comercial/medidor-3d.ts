import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { lerRespostaComEtapas, type RespostaMedidor } from "./medidor-ndjson";

/**
 * Medição do STEP anexado ao orçamento (ROADMAP C-19). Roda com a chave de serviço, logo depois do anexo
 * (after()) ou pelo "Medir de novo": lê o arquivo de Documentos, manda ao medidor 3D (services/medidor-3d,
 * rede interna, MEDIDOR_URL + MEDIDOR_SECRET) e grava os corpos e as imagens. O arquivo não sai do servidor.
 */

const BUCKET_DOCUMENTOS = "empresa-documentos";
export const BUCKET_MEDICOES = "comercial-medicoes";
/** Uma medição "medindo" há mais que isso morreu no meio (deploy, queda): pode recomeçar. */
const TRAVADA_MS = 15 * 60 * 1000;

export const medidorConfigurado = () => Boolean(process.env.MEDIDOR_URL?.trim() && (process.env.MEDIDOR_SECRET?.trim().length ?? 0) >= 32);

/**
 * Etapas da medição em andamento, para a tela mostrar o que está acontecendo (o processo leva de meio minuto a
 * alguns minutos). Ficam na memória deste servidor: a medição roda aqui mesmo (after()), um processo só.
 */
export type EtapaMedicao = { texto: string; em: string };
const PROGRESSO: Map<string, EtapaMedicao[]> = ((globalThis as { __medidorProgresso?: Map<string, EtapaMedicao[]> }).__medidorProgresso ??= new Map());
const avancar = (id: string, texto: string) => {
  const lista = PROGRESSO.get(id) ?? [];
  if (lista.at(-1)?.texto !== texto) lista.push({ texto, em: new Date().toISOString() });
  PROGRESSO.set(id, lista.slice(-30));
};
export const etapasDaMedicao = (id: string): EtapaMedicao[] => PROGRESSO.get(id) ?? [];
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;



export async function processarMedicao(admin: SupabaseClient, medicaoId: string): Promise<void> {
  // Reserva: só uma execução por medição (pendente, com erro ou travada).
  const travada = new Date(Date.now() - TRAVADA_MS).toISOString();
  const { data: m, error } = await admin.from("comercial_medicoes_3d")
    .update({ situacao: "medindo", erro: null, updated_at: new Date().toISOString() })
    .eq("id", medicaoId)
    .or(`situacao.in.(pendente,erro),and(situacao.eq.medindo,updated_at.lt.${travada})`)
    .select("id, organization_id, document_id, tentativas")
    .maybeSingle();
  if (error) throw new Error(`reservar a medição: ${error.message}`);
  if (!m) return;
  PROGRESSO.delete(m.id);
  avancar(m.id, "Preparando o arquivo para o medidor");

  const falhar = async (mensagem: string) => {
    PROGRESSO.delete(m.id);
    await admin.from("comercial_medicoes_3d").update({ situacao: "erro", erro: mensagem.slice(0, 500), tentativas: (m.tentativas ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", m.id);
  };

  if (!medidorConfigurado()) { await falhar("O medidor 3D ainda não está ligado no servidor (MEDIDOR_URL e MEDIDOR_SECRET)."); return; }

  const { data: doc } = await admin.from("company_documents").select("storage_path").eq("id", m.document_id).eq("organization_id", m.organization_id).maybeSingle();
  if (!doc) { await falhar("O arquivo não está mais em Documentos."); return; }
  const { data: blob, error: eBaixar } = await admin.storage.from(BUCKET_DOCUMENTOS).download(doc.storage_path);
  if (eBaixar || !blob) { await falhar("Não foi possível ler o arquivo guardado."); return; }
  avancar(m.id, `Enviando o arquivo ao medidor (${mb(blob.size)})`);

  let resposta: RespostaMedidor;
  try {
    const r = await fetch(`${process.env.MEDIDOR_URL!.replace(/\/$/, "")}/v1/medir?progresso=1`, {
      method: "POST",
      headers: { "x-medidor-secret": process.env.MEDIDOR_SECRET!.trim(), "content-type": "application/octet-stream" },
      body: new Uint8Array(await blob.arrayBuffer()),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    resposta = await lerRespostaComEtapas(r, (texto) => avancar(m.id, texto));
  } catch (e) {
    await falhar(e instanceof Error && e.name === "TimeoutError" ? "O medidor demorou demais: tente de novo." : "O medidor 3D não respondeu.");
    return;
  }
  if (!resposta.ok || !resposta.resultado) { await falhar(resposta.erro?.mensagem ?? "O medidor não conseguiu medir o arquivo."); return; }

  const { corpos, imagens, versao_motor, tempo_ms } = resposta.resultado;
  avancar(m.id, "Guardando as imagens e os pesos");
  const caminhos: Record<string, string> = {};
  let i = 0;
  for (const [corpo, base64] of Object.entries(imagens ?? {})) {
    const caminho = `${m.organization_id}/${m.id}/${corpo === "montagem" ? "montagem" : `p${i++}`}.png`;
    const { error: eImg } = await admin.storage.from(BUCKET_MEDICOES).upload(caminho, Buffer.from(base64, "base64"), { contentType: "image/png", upsert: true });
    if (!eImg) caminhos[corpo] = caminho;
    else console.error("Imagem da medição", eImg.message);
  }
  const { error: eGravar } = await admin.from("comercial_medicoes_3d").update({
    situacao: "pronto", erro: null, corpos, imagens: caminhos, versao_motor, tempo_ms,
    medido_em: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", m.id);
  PROGRESSO.delete(m.id);
  if (eGravar) throw new Error(`gravar a medição: ${eGravar.message}`);
}

/** Parece um STEP de verdade (cabeçalho ISO 10303-21) e tem a extensão certa. */
export function pareceStep(nome: string, dados: Uint8Array): boolean {
  if (!/\.(step|stp)$/i.test(nome)) return false;
  return new TextDecoder("latin1").decode(dados.subarray(0, 64)).includes("ISO-10303-21");
}
