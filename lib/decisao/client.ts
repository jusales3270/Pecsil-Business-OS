import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DecisaoErro, confiancaGeral, consultar, faixa, lerResposta, montarPedido, urlClef, type Faixa, type ModeloClef, type Pergunta, type Resposta } from "./core";
import { filtrarEstado } from "./guard";

/**
 * Cliente do modelo de decisão (Clef) no servidor. Toda consulta passa por aqui:
 *   1. o uso precisa estar ligado (painel do proprietário; o teste do proprietário roda sempre);
 *   2. o texto passa pelo filtro de dado pessoal; bloqueado, nada sai e o bloqueio é registrado;
 *   3. chama o Clef (8 s, uma nova tentativa se o serviço cair);
 *   4. grava a consulta em `ai_judgments` (pendente), com faixa, tempo e tokens.
 * Se o serviço falhar, grava o erro e devolve "indisponivel": a tela segue no fluxo manual.
 *
 * Chaves: CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN (só Workers AI), nunca NEXT_PUBLIC_.
 */

export type ConfigClef = { conta: string; token: string };

export function lerConfigClef(): ConfigClef | null {
  const conta = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_AI_TOKEN?.trim();
  return conta && token ? { conta, token } : null;
}

type ConfigUso = { code: string; label: string; enabled: boolean; model: ModeloClef; limitHigh: number; limitLow: number; featureCode: string };

export type ResultadoPergunta =
  | { status: "ok"; julgamentoId: string; respostas: Record<string, Resposta>; confianca: number; faixa: Faixa; modelo: ModeloClef; ms: number }
  | { status: "desligado" | "nao_configurado" | "uso_desconhecido" }
  | { status: "bloqueado"; motivos: string[]; julgamentoId: string | null }
  | { status: "indisponivel"; motivo: string; julgamentoId: string | null };

export async function perguntar(
  supabase: SupabaseClient,
  { uso, entidade, estado, perguntas, ignorarDesligado = false }: {
    uso: string;
    entidade?: { tipo: string; id: string };
    estado: string;
    perguntas: Record<string, Pergunta>;
    /** Só para o teste do proprietário: roda mesmo com o uso desligado. */
    ignorarDesligado?: boolean;
  },
): Promise<ResultadoPergunta> {
  const { data: cfg } = await supabase.rpc("ai_use_config", { p_code: uso });
  const config = cfg as ConfigUso | null;
  if (!config) return { status: "uso_desconhecido" };
  if (!config.enabled && !ignorarDesligado) return { status: "desligado" };

  const registrar = async (dados: { resumo: string; respostas?: unknown; confianca?: number | null; faixa?: Faixa | null; ms?: number | null; tokens?: number | null; situacao: "pendente" | "bloqueada" | "erro"; detalhe?: string }) => {
    const { data, error } = await supabase.rpc("ai_judgment_record", {
      p_use: uso, p_entity_type: entidade?.tipo ?? null, p_entity_id: entidade?.id ?? null, p_state_summary: dados.resumo,
      p_questions: perguntas, p_answers: dados.respostas ?? {}, p_confidence: dados.confianca ?? null, p_band: dados.faixa ?? null,
      p_model: config.model, p_latency_ms: dados.ms ?? null, p_input_tokens: dados.tokens ?? null, p_outcome: dados.situacao, p_error_detail: dados.detalhe ?? null,
    });
    if (error) console.error("Falha ao registrar consulta ao modelo", error.message);
    return (data as string | null) ?? null;
  };

  const filtro = filtrarEstado(estado);
  if (!filtro.ok) {
    const id = await registrar({ resumo: `(bloqueado pelo filtro: ${filtro.motivos.join(", ")})`, situacao: "bloqueada", detalhe: filtro.motivos.join(", ") });
    return { status: "bloqueado", motivos: filtro.motivos, julgamentoId: id };
  }

  const chaves = lerConfigClef();
  if (!chaves) return { status: "nao_configurado" };

  try {
    const pedido = montarPedido(estado, perguntas);
    const { json, ms } = await consultar({ fetch, url: urlClef(chaves.conta, config.model), token: chaves.token, corpo: pedido });
    const { respostas, tokens } = lerResposta(json);
    const confianca = confiancaGeral(respostas);
    const f = faixa(confianca, { alto: Number(config.limitHigh), baixo: Number(config.limitLow) });
    const id = await registrar({ resumo: estado, respostas, confianca, faixa: f, ms, tokens, situacao: "pendente" });
    return { status: "ok", julgamentoId: id ?? "", respostas, confianca, faixa: f, modelo: config.model, ms };
  } catch (e) {
    const motivo = e instanceof DecisaoErro ? e.message : "Falha inesperada ao consultar o modelo.";
    if (!(e instanceof DecisaoErro)) console.error("Falha inesperada no modelo de decisão", e);
    const id = await registrar({ resumo: estado, situacao: "erro", detalhe: motivo });
    return { status: "indisponivel", motivo, julgamentoId: id };
  }
}
