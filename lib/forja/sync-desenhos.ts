import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getForjaSession } from "./client";
import { CAMPOS, caminhoArquivo, extensao, parseDesenhos, planejar, type DesenhoForja, type Gravado } from "./desenhos-core";

/**
 * Biblioteca da Fundição (P-11): copia para a plataforma todos os desenhos com arquivo da Forja.
 *
 * Roda junto da sincronização das OS (a cada 10 min). Lê a lista inteira da Forja, grava só o
 * que mudou e baixa o arquivo quando o desenho é novo ou o arquivo foi trocado. A versão anterior
 * fica guardada (substituída); o desenho que some da Forja fica marcado, nunca apagado. Cada
 * rodada baixa no máximo LIMITE_ARQUIVOS, para a carga inicial não segurar o cron: o resto vai
 * nas rodadas seguintes.
 */

export const BUCKET_DESENHOS = "fundicao-desenhos";
const LIMITE_ARQUIVOS = 30;
const LOTE = 400;

type Row = Record<string, unknown>;

export type RelatorioDesenhos = {
  noForja: number;
  rejeitados: number;
  novos: number;
  alterados: number;
  removidos: number;
  baixados: number;
  pendentes: number;
  avisos: string[];
};

const chunks = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / LOTE) }, (_, i) => list.slice(i * LOTE, (i + 1) * LOTE));

async function todas(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, contexto: string) {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(`${contexto}: ${error.message}`);
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const linha = (org: string, d: DesenhoForja, produto: string | null) => ({
  organization_id: org, origem: "forja", forja_desenho_id: d.forja_desenho_id, product_id: produto,
  ...Object.fromEntries(CAMPOS.map((c) => [c, d[c]])),
  forja_atualizado_em: d.forja_atualizado_em, removido_na_forja_em: null, updated_at: new Date().toISOString(),
});

export async function sincronizarDesenhos(admin: SupabaseClient, org: string, { simular }: { simular: boolean }): Promise<RelatorioDesenhos> {
  const forja = getForjaSession();
  const { desenhos, rejeitados } = parseDesenhos(await forja.getData("/api/integracao/desenhos"));
  const relatorio: RelatorioDesenhos = { noForja: desenhos.length, rejeitados, novos: 0, alterados: 0, removidos: 0, baixados: 0, pendentes: 0, avisos: [] };

  const gravadosBrutos = await todas((a, b) => admin.from("fundicao_desenhos")
    .select(`id, forja_desenho_id, forja_arquivo_key, removido_na_forja_em, ${CAMPOS.join(", ")}`)
    .eq("organization_id", org).eq("origem", "forja").order("id").range(a, b), "desenhos gravados");
  const comArquivo = new Set((await todas((a, b) => admin.from("fundicao_desenho_arquivos").select("desenho_id")
    .eq("organization_id", org).is("substituido_em", null).order("id").range(a, b), "arquivos")).map((r) => String(r.desenho_id)));
  const gravados = gravadosBrutos.map((g) => ({ ...g, tem_arquivo: comArquivo.has(String(g.id)) })) as Gravado[];
  const plano = planejar(desenhos, gravados);
  relatorio.novos = plano.novos.length;
  relatorio.alterados = plano.alterados.length;
  relatorio.removidos = plano.removidos.length;
  relatorio.pendentes = plano.baixar.length;
  if (simular) return relatorio;

  // Produto do cadastro (Comercial) ligado ao artigo da Forja.
  const produtos = await todas((a, b) => admin.from("products").select("id, forja_artigo_id").eq("organization_id", org)
    .not("forja_artigo_id", "is", null).order("id").range(a, b), "produtos");
  const produtoDe = new Map(produtos.map((p) => [String(p.forja_artigo_id), String(p.id)]));
  const produto = (d: DesenhoForja) => (d.forja_artigo_id ? produtoDe.get(d.forja_artigo_id) ?? null : null);

  const gravar = [...plano.novos, ...plano.alterados.map((a) => a.desenho)].map((d) => linha(org, d, produto(d)));
  for (const lote of chunks(gravar)) {
    const { error } = await admin.from("fundicao_desenhos").upsert(lote, { onConflict: "organization_id,forja_desenho_id" });
    if (error) throw new Error(`gravar desenhos: ${error.message}`);
  }
  const alteradosIds = new Set(plano.alterados.map((a) => a.id));
  const voltaram = plano.voltaram.filter((id) => !alteradosIds.has(id));
  for (const lote of chunks(voltaram)) {
    const { error } = await admin.from("fundicao_desenhos").update({ removido_na_forja_em: null, updated_at: new Date().toISOString() }).in("id", lote);
    if (error) throw new Error(`desenhos de volta: ${error.message}`);
  }
  for (const lote of chunks(plano.removidos)) {
    const agora = new Date().toISOString();
    const { error } = await admin.from("fundicao_desenhos").update({ removido_na_forja_em: agora, updated_at: agora }).in("id", lote);
    if (error) throw new Error(`desenhos removidos: ${error.message}`);
  }

  // Arquivos: só os primeiros LIMITE_ARQUIVOS desta rodada.
  const ids = new Map((await todas((a, b) => admin.from("fundicao_desenhos").select("id, forja_desenho_id")
    .eq("organization_id", org).eq("origem", "forja").order("id").range(a, b), "ids")).map((r) => [String(r.forja_desenho_id), String(r.id)]));
  const porForja = new Map(desenhos.map((d) => [d.forja_desenho_id, d]));
  for (const item of plano.baixar.slice(0, LIMITE_ARQUIVOS)) {
    const desenhoId = ids.get(item.forja_desenho_id);
    const d = porForja.get(item.forja_desenho_id);
    if (!desenhoId || !d) continue;
    try {
      await guardarArquivo(admin, org, desenhoId, d);
      relatorio.baixados += 1;
    } catch (e) {
      relatorio.avisos.push(`${d.artigo_codigo} ${d.codigo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  relatorio.pendentes = Math.max(0, plano.baixar.length - relatorio.baixados);
  relatorio.avisos = relatorio.avisos.slice(0, 10);
  return relatorio;
}

/** Baixa o arquivo atual do desenho e o guarda como a versão atual (a anterior fica, substituída). */
async function guardarArquivo(admin: SupabaseClient, org: string, desenhoId: string, d: DesenhoForja) {
  const arquivo = await getForjaSession().getArquivo(`/api/integracao/desenhos/${encodeURIComponent(d.forja_desenho_id)}/arquivo`);
  if (!arquivo) throw new Error("o arquivo não está mais na Forja");
  const hash = createHash("sha256").update(arquivo.dados).digest("hex");
  const mime = (arquivo.tipo ?? d.arquivo.mime)?.split(";")[0].trim() || null;
  const agora = new Date().toISOString();

  const { data: versoes, error: eV } = await admin.from("fundicao_desenho_arquivos").select("id, sha256, substituido_em").eq("desenho_id", desenhoId);
  if (eV) throw new Error(eV.message);
  const mesma = (versoes ?? []).find((v) => v.sha256 === hash);
  const atuaisOutras = (versoes ?? []).filter((v) => !v.substituido_em && v.sha256 !== hash).map((v) => v.id);

  if (!mesma) {
    const caminho = caminhoArquivo(org, desenhoId, hash, extensao(mime, d.arquivo.nome));
    const { error: eUp } = await admin.storage.from(BUCKET_DESENHOS).upload(caminho, arquivo.dados, { contentType: mime || "application/octet-stream", upsert: true });
    if (eUp) throw new Error(`guardar o arquivo: ${eUp.message}`);
    if (atuaisOutras.length) await marcarSubstituidas(admin, atuaisOutras, agora);
    const { error } = await admin.from("fundicao_desenho_arquivos").insert({
      organization_id: org, desenho_id: desenhoId, sha256: hash, storage_path: caminho, mime, tamanho: arquivo.dados.byteLength, nome: d.arquivo.nome,
    });
    if (error) throw new Error(`registrar o arquivo: ${error.message}`);
  } else if (mesma.substituido_em || atuaisOutras.length) {
    // A Forja voltou a um arquivo que já estava guardado: ele volta a ser o atual.
    if (atuaisOutras.length) await marcarSubstituidas(admin, atuaisOutras, agora);
    const { error } = await admin.from("fundicao_desenho_arquivos").update({ substituido_em: null }).eq("id", mesma.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await admin.from("fundicao_desenhos").update({ forja_arquivo_key: arquivo.chave ?? d.forja_arquivo_key, updated_at: agora }).eq("id", desenhoId);
  if (error) throw new Error(error.message);
}

async function marcarSubstituidas(admin: SupabaseClient, ids: string[], quando: string) {
  const { error } = await admin.from("fundicao_desenho_arquivos").update({ substituido_em: quando }).in("id", ids);
  if (error) throw new Error(`marcar versão anterior: ${error.message}`);
}
