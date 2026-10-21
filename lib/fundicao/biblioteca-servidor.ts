import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "../supabase/admin";
import { BUCKET_DESENHOS } from "../forja/sync-desenhos";

/**
 * Lado do servidor da Biblioteca da Fundição. O bucket "fundicao-desenhos" não tem política
 * para as pessoas: o arquivo sobe e desce só por aqui, com a chave de serviço, e SEMPRE depois
 * que a rota conferiu a permissão com a sessão de quem pede (funções da migração 202610210001).
 */

export const sha256 = (dados: Uint8Array) => createHash("sha256").update(dados).digest("hex");

/** Lê o arquivo guardado (a rota já conferiu a permissão pela função fundicao_arquivo_abrir). */
export async function lerArquivo(caminho: string): Promise<Blob> {
  const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET_DESENHOS).download(caminho);
  if (error || !data) throw new Error("Não foi possível ler o arquivo agora.");
  return data;
}

/** Guarda o desenho antigo enviado pela Fundição: org/acervo/sha256.ext (o mesmo arquivo cai no mesmo lugar). */
export async function guardarAcervo(org: string, hash: string, ext: string, dados: Uint8Array, mime: string): Promise<string> {
  const caminho = `${org}/acervo/${hash}.${ext}`;
  const { error } = await createSupabaseAdminClient().storage.from(BUCKET_DESENHOS).upload(caminho, dados, { contentType: mime, upsert: true });
  if (error) throw new Error(`Não foi possível guardar o arquivo: ${error.message}`);
  return caminho;
}

export async function apagarArquivos(caminhos: string[]) {
  if (!caminhos.length) return;
  const { error } = await createSupabaseAdminClient().storage.from(BUCKET_DESENHOS).remove(caminhos);
  if (error) console.error("Falha ao apagar arquivo da Biblioteca", error.message);
}

/**
 * Peças do cadastro para ligar o desenho antigo (a Fundição não tem o Comercial): só código,
 * descrição e cliente. A rota exige `fundicao.biblioteca` operar antes de chamar.
 */
export async function buscarPecas(org: string, termo: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("products")
    .select("id, codigo, descricao, customers(name)")
    .eq("organization_id", org).eq("ativo", true)
    .or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    .order("codigo").limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => {
    const cliente = (p as { customers?: { name?: string } | { name?: string }[] | null }).customers;
    const nome = Array.isArray(cliente) ? cliente[0]?.name : cliente?.name;
    return { id: String(p.id), codigo: String(p.codigo), descricao: String(p.descricao), cliente: nome ?? null };
  });
}
