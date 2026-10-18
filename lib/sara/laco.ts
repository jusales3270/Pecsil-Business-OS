import type { SupabaseClient } from "@supabase/supabase-js";
import { filtrarEstado } from "../decisao/guard.ts";
import { semPensar } from "./base.ts";
import type { Abrir, Ferramenta, Fonte } from "./ferramentas.ts";

/**
 * Laço da conversa da SARA com o Claude (Anthropic) por *tool use*. Não lê o ambiente (a chave e o
 * fetch entram por parâmetro; quem lê a chave é lib/sara/claude.ts, só no servidor), então é testável.
 * As ferramentas rodam com a sessão de quem pergunta; o que elas devolvem passa pelo filtro de dado
 * pessoal antes de ir ao modelo. Máximo de 6 rodadas de ferramenta por pergunta.
 *
 * Cache de prompt da Anthropic: a parte fixa (ferramentas + manual + regras) é marcada para cache e
 * cobrada bem mais barato quando se repete; a parte do dia (data, nome, permissões) vem depois dela.
 * A última mensagem também é marcada, para a rodada seguinte da mesma pergunta reaproveitar a conversa.
 *
 * Sem "pensamento" (thinking) no copiloto: medido em 17/10, ele não mudou as consultas escolhidas e
 * custava ~23% de tempo e ~29% dos tokens de saída. O raciocínio profundo fica para o modo conselheiro.
 */

export type MensagemHistorico = { papel: "pessoa" | "sara"; texto: string };
export type RespostaSara = {
  texto: string; fontes: Fonte[]; abrir: Abrir | null; ferramentas: { nome: string; entrada: unknown; ok: boolean }[];
  /** tokensEntrada inclui os tokens lidos do cache e os gravados nele (volume total de entrada). */
  tokensEntrada: number; tokensSaida: number; cacheLido: number; cacheGravado: number; modelo: string;
};
export type Sistema = string | { fixo: string; variavel: string };

const CACHE = { type: "ephemeral" } as const;
const blocosDoSistema = (s: Sistema) => (typeof s === "string" ? s : [{ type: "text", text: s.fixo, cache_control: CACHE }, ...(s.variavel ? [{ type: "text", text: s.variavel }] : [])]);
/** Cópia das mensagens com a marca de cache no último bloco da última mensagem. */
function comCacheNoFim(mensagens: { role: "user" | "assistant"; content: unknown }[]) {
  if (!mensagens.length) return mensagens;
  const ultima = mensagens[mensagens.length - 1];
  const blocos = typeof ultima.content === "string" ? [{ type: "text", text: ultima.content }] : [...(ultima.content as Record<string, unknown>[])];
  blocos[blocos.length - 1] = { ...blocos[blocos.length - 1], cache_control: CACHE };
  return [...mensagens.slice(0, -1), { role: ultima.role, content: blocos }];
}

const API = "https://api.anthropic.com/v1/messages";
/** Frase curta de passagem antes de uma consulta ("Vou consultar as contas…"), que não é resposta. */
const PASSAGEM = /^(vou|deixa eu|deixe-me|um momento|já vou|só um instante)\b[^\n]{0,160}$/i;
const RODADAS = 6;

type Bloco = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export async function conversarCom(sb: SupabaseClient, a: {
  chave: string; buscar?: typeof fetch; modelo: string; sistema: Sistema; historico: MensagemHistorico[]; pergunta: string; ferramentas: Ferramenta[];
  /** Cancela a conversa (o verificador de escopo deu FORA). */
  sinal?: AbortSignal;
}): Promise<RespostaSara> {
  const chave = a.chave;
  const buscar = a.buscar ?? fetch;
  if (!chave) throw new Error("NAO_CONFIGURADA");
  const mensagens: { role: "user" | "assistant"; content: unknown }[] = [
    ...a.historico.slice(-12).map((m) => ({ role: (m.papel === "pessoa" ? "user" : "assistant") as "user" | "assistant", content: m.texto })),
    { role: "user", content: a.pergunta },
  ];
  const tools = a.ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.esquema }));
  const fontes: Fonte[] = [];
  let abrir: Abrir | null = null;
  const usadas: RespostaSara["ferramentas"] = [];
  let tokensEntrada = 0, tokensSaida = 0, cacheLido = 0, cacheGravado = 0;
  // O texto de todas as rodadas: o modelo pode escrever a resposta antes de pedir uma ferramenta
  // (ex.: dá o total e depois abre a tela). Ficar só com a última rodada perdia essa parte.
  const textos: string[] = [];
  // Sem as frases de passagem ("Vou consultar…") e sem repetir o que já foi dito.
  const juntar = () => {
    const partes = textos.map((t) => t.trim()).filter(Boolean);
    return partes.filter((t, i) => !(i < partes.length - 1 && (PASSAGEM.test(t) || partes.slice(i + 1).some((d) => d.includes(t))))).join("\n\n");
  };

  const executar = async (nome: string, entrada: Record<string, unknown>): Promise<{ conteudo: string; ok: boolean }> => {
    const f = a.ferramentas.find((x) => x.nome === nome);
    if (!f) return { conteudo: JSON.stringify({ erro: "Ferramenta indisponível para esta pessoa (sem permissão)." }), ok: false };
    try {
      const res = await f.rodar(sb, entrada);
      const json = JSON.stringify(res.dados);
      const filtro = filtrarEstado(json);
      if (!filtro.ok) return { conteudo: JSON.stringify({ erro: "Resultado bloqueado: continha dado pessoal.", motivos: filtro.motivos }), ok: false };
      fontes.push(...res.fontes);
      if (res.abrir) abrir = res.abrir;
      return { conteudo: json.slice(0, 30_000), ok: true };
    } catch (e) { return { conteudo: JSON.stringify({ erro: `A consulta falhou: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}` }), ok: false }; }
  };


  for (let rodada = 0; rodada < RODADAS; rodada++) {
    if (a.sinal?.aborted) throw new Error("CANCELADA");
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 60_000);
    const cancelar = () => ctrl.abort();
    a.sinal?.addEventListener("abort", cancelar);
    let r: Response;
    try {
      r = await buscar(API, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: a.modelo, max_tokens: 1500, thinking: semPensar(a.modelo), system: blocosDoSistema(a.sistema), messages: comCacheNoFim(mensagens), ...(tools.length ? { tools } : {}) }),
      });
    } catch (e) {
      if (a.sinal?.aborted) throw new Error("CANCELADA");
      throw e;
    } finally { clearTimeout(relogio); a.sinal?.removeEventListener("abort", cancelar); }
    const corpo = await r.json().catch(() => null) as { content?: Bloco[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; error?: { message?: string } } | null;
    if (!r.ok || !corpo?.content) throw new Error(`MODELO_INDISPONIVEL: ${r.status} ${corpo?.error?.message ?? ""}`.trim());
    cacheLido += corpo.usage?.cache_read_input_tokens ?? 0;
    cacheGravado += corpo.usage?.cache_creation_input_tokens ?? 0;
    tokensEntrada += (corpo.usage?.input_tokens ?? 0) + (corpo.usage?.cache_read_input_tokens ?? 0) + (corpo.usage?.cache_creation_input_tokens ?? 0);
    tokensSaida += corpo.usage?.output_tokens ?? 0;
    const pedidos = corpo.content.filter((b): b is Extract<Bloco, { type: "tool_use" }> => b.type === "tool_use");
    textos.push(corpo.content.filter((b): b is Extract<Bloco, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n"));
    if (corpo.stop_reason !== "tool_use" || !pedidos.length) {
      const texto = juntar();
      return { texto: texto || "Não consegui montar uma resposta agora.", fontes: unicas(fontes), abrir, ferramentas: usadas, tokensEntrada, tokensSaida, cacheLido, cacheGravado, modelo: a.modelo };
    }
    mensagens.push({ role: "assistant", content: corpo.content });
    const resultados = [];
    for (const p of pedidos) {
      const { conteudo, ok } = await executar(p.name, p.input ?? {});
      usadas.push({ nome: p.name, entrada: p.input, ok });
      resultados.push({ type: "tool_result", tool_use_id: p.id, content: conteudo });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  return { texto: "A pergunta pediu consultas demais. Tente uma pergunta mais direta.", fontes: unicas(fontes), abrir, ferramentas: usadas, tokensEntrada, tokensSaida, cacheLido, cacheGravado, modelo: a.modelo };
}

const unicas = (f: Fonte[]) => f.filter((x, i) => f.findIndex((y) => y.link === x.link) === i);
