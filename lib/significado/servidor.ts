import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { comoVetor, vetorDaPergunta, vetoresDosTrechos } from "./modelo";
import { dividirEmTrechos, escolherPorSentido } from "./trechos";

/**
 * Busca por significado no servidor (Etapa 5B). Indexar: texto lido → trechos → vetores, gravados
 * com a chave de serviço (rodada agendada). Buscar: a pergunta vira vetor e a função
 * `company_document_semantic` roda com a SESSÃO de quem pesquisa (o RLS decide o que aparece).
 */

/** Rodada: textos lidos e ainda sem vetores (ou relidos), até o prazo. */
export async function indexarPendentes(admin: SupabaseClient, prazoMs: number): Promise<{ indexados: number; trechos: number; modelo: boolean }> {
  const inicio = Date.now();
  const r = { indexados: 0, trechos: 0, modelo: true };
  const { data, error } = await admin.from("company_document_texts")
    .select("document_id, organization_id, content").eq("status", "lido").is("embedded_at", null)
    .order("read_at", { ascending: true }).limit(20);
  if (error) throw new Error(error.message);
  for (const t of data ?? []) {
    if (Date.now() - inicio > prazoMs) break;
    const trechos = dividirEmTrechos(t.content ?? "");
    const vetores = trechos.length ? await vetoresDosTrechos(trechos) : [];
    if (vetores === null) { r.modelo = false; break; } // modelo indisponível: tenta na próxima rodada
    await admin.from("company_document_chunks").delete().eq("document_id", t.document_id);
    if (trechos.length) {
      const { error: eIns } = await admin.from("company_document_chunks").insert(trechos.map((content, ordem) => ({
        organization_id: t.organization_id, document_id: t.document_id, ordem, content, embedding: comoVetor(vetores[ordem]),
      })));
      if (eIns) { console.error("Falha ao gravar trechos", t.document_id, eIns.message); continue; }
    }
    await admin.from("company_document_texts").update({ embedded_at: new Date().toISOString() }).eq("document_id", t.document_id);
    r.indexados++;
    r.trechos += trechos.length;
  }
  return r;
}

export type AchadoPorSentido = { id: string; trecho: string | null; similaridade: number };

/**
 * Documentos parecidos no SENTIDO com a pergunta, fora os já achados por palavra. Só para buscas
 * simples (sem aspas nem -excluir). Sem o modelo, lista vazia: a busca segue por palavras.
 */
export async function buscarPorSentido(supabase: SupabaseClient, q: string, setor: string | null, jaAchados: Set<string>, max = 5): Promise<AchadoPorSentido[]> {
  const pergunta = q.trim();
  if (pergunta.length < 3 || /"|(^|\s)-\S|\sor\s/i.test(pergunta)) return [];
  let vetor: number[] | null = null;
  try {
    vetor = await vetorDaPergunta(pergunta);
  } catch (e) {
    console.error("Falha ao converter a pergunta", e);
  }
  if (!vetor) return [];
  const { data, error } = await supabase.rpc("company_document_semantic", { p_vetor: comoVetor(vetor), p_setor: setor, p_limite: 20 });
  if (error) { console.error("Falha na busca por significado", error.message); return []; }
  const lista = ((data ?? []) as { id: string; trecho: string | null; similaridade: number }[]).map((d) => ({ id: d.id, trecho: d.trecho, similaridade: Number(d.similaridade) }));
  return escolherPorSentido(lista, { max: max + jaAchados.size }).filter((d) => !jaAchados.has(d.id)).slice(0, max);
}
