import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase/admin";

/**
 * Evidências das não conformidades. O bucket "qualidade-evidencias" não tem política para as pessoas: o
 * arquivo sobe e desce só por aqui, com a chave de serviço, e SEMPRE depois que a função do banco conferiu
 * a permissão com a sessão de quem pede (migração 202610300001).
 */

const BUCKET = "qualidade-evidencias";
const EXTENSAO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Guarda a foto como pendente da conversa. Devolve o id. Lança se não conseguir. */
export async function guardarFoto(sb: SupabaseClient, imagem: { tipo: string; dados: string }, conversa: string | null): Promise<string> {
  const { data: org } = await sb.rpc("current_organization_id");
  if (!org) throw new Error("Sem organização na sessão.");
  const id = randomUUID();
  const caminho = `${org}/nc/${id}.${EXTENSAO[imagem.tipo] ?? "jpg"}`;
  const bytes = Buffer.from(imagem.dados, "base64");
  const admin = createSupabaseAdminClient();
  const { error: e1 } = await admin.storage.from(BUCKET).upload(caminho, bytes, { contentType: imagem.tipo });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.rpc("qualidade_foto_guardar", { p_id: id, p_caminho: caminho, p_mime: imagem.tipo, p_tamanho: bytes.length, p_conversa: conversa });
  if (e2) { await admin.storage.from(BUCKET).remove([caminho]); throw new Error(e2.message); }
  // Limpa as tentativas abandonadas da pessoa. Falhar aqui não atrapalha a foto de agora.
  void limparVencidas(sb);
  return id;
}

async function limparVencidas(sb: SupabaseClient) {
  const { data, error } = await sb.rpc("qualidade_fotos_vencidas_limpar");
  if (error) return console.error("[qualidade] não limpou as fotos vencidas", error.message);
  const caminhos = (data ?? []) as string[];
  if (caminhos.length) await createSupabaseAdminClient().storage.from(BUCKET).remove(caminhos);
}

/** Fotos pendentes que a pessoa mandou nesta conversa, na ordem em que chegaram. */
export async function fotosPendentes(sb: SupabaseClient, conversa: string): Promise<string[]> {
  const eu = (await sb.rpc("current_profile_id")).data as string | null;
  const { data, error } = await sb.from("qualidade_nc_fotos").select("id").eq("conversa_id", conversa).eq("autor_id", eu ?? "").is("nc_id", null).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => String(f.id));
}

/** A leitura da foto no cartão mais recente desta conversa, para o cartão refeito não perdê-la. Para na última NC já gravada: a leitura dela não passa para a próxima. */
export async function leituraDaConversa(sb: SupabaseClient, conversa: string): Promise<{ analise_sara: string; confianca?: string } | null> {
  const { data, error } = await sb.from("sara_acoes").select("entrada, situacao").eq("conversa_id", conversa).eq("ferramenta", "registrar_nao_conformidade").order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error(error.message);
  for (const linha of data ?? []) {
    if (linha.situacao === "executada") return null;
    const e = linha.entrada as { analise_sara?: string; confianca?: string } | null;
    if (e?.analise_sara) return { analise_sara: e.analise_sara, ...(e.confianca ? { confianca: e.confianca } : {}) };
  }
  return null;
}

/** Lê a foto guardada (a rota já conferiu a permissão pela função qualidade_foto_abrir). */
export async function lerFoto(caminho: string): Promise<Blob> {
  const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET).download(caminho);
  if (error || !data) throw new Error("Não foi possível ler a foto agora.");
  return data;
}
