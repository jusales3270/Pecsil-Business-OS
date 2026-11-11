/**
 * Sentinela (N-02): extração pelo modelo, só para o que passou na triagem. O modelo LÊ o texto público
 * da fonte e PROPÕE (qual parâmetro ou tese muda, desde quando, o trecho que prova e, se der, o valor no
 * mesmo formato do atual). Uma pessoa confirma. Nada aqui grava nem decide. Uso registrado no Plano do Jev.
 *
 * Proteções: só texto público e já filtrado de dado pessoal; o trecho tem de existir no texto (senão a
 * confiança cai para baixa e o valor some); o valor tem de ter as mesmas chaves do atual; a chave tem de
 * estar entre as candidatas da triagem.
 */
import { semPensar } from "../../sara/base";
import { chamarClaude, entradaDe, type CorpoClaude } from "../../sara/motor/anthropic";

export type Candidato = { chave: string; titulo: string; valor: unknown };
export type TeseCandidata = { id: string; tribunal: string; tema: string; titulo: string; situacao: string; modulacao: string | null };
export type Extracao = {
  mudaRegra: boolean;
  tipo: "parametro" | "tese" | "sinal";
  chave: string | null;
  teseId: string | null;
  resumo: string;
  vigenteDe: string | null;
  norma: string | null;
  trecho: string | null;
  confianca: "alta" | "media" | "baixa";
  valorProposto: unknown | null;
  teseSituacao: string | null;
  teseModulacao: string | null;
  avisos: string[];
};

export const MODELO_SENTINELA = "claude-haiku-5-5";

export const REGRA_EXTRACAO = `Você lê textos públicos de fontes oficiais brasileiras (Diário Oficial, Receita Federal, Comitê Gestor do IBS, tribunais) e diz se o texto MUDA uma regra que a plataforma usa.
- Responda sempre chamando a ferramenta "proposta".
- Nunca invente número, data, norma ou trecho. Se o texto não traz o número novo, deixe valor_proposto vazio.
- "trecho" é uma citação LITERAL do texto (copie as palavras exatas, até 600 caracteres) que prova a mudança.
- valor_proposto, quando houver, usa EXATAMENTE as mesmas chaves do valor atual do parâmetro escolhido, só com os números ou textos que o texto muda.
- vigente_de é a data em que a regra nova passa a valer (AAAA-MM-DD), não a data da notícia.
- Notícia que só explica, lembra prazo já conhecido ou anuncia evento não muda regra: muda_regra = false.
- Tese: use quando o texto é julgamento, súmula ou solução de consulta sobre um dos temas candidatos; diga a situação nova (firmada, firmada_modulacao_pendente, pendente, superada) e a modulação, se o texto disser.`;

const SITUACOES_TESE = ["firmada", "firmada_modulacao_pendente", "pendente", "superada"];

export function ferramentaProposta(chaves: string[], teses: string[]) {
  return {
    name: "proposta",
    description: "Diz se o texto muda uma regra e propõe a mudança para uma pessoa conferir.",
    input_schema: {
      type: "object",
      properties: {
        muda_regra: { type: "boolean" },
        tipo: { type: "string", enum: ["parametro", "tese", "sinal"] },
        chave: { type: "string", enum: [...chaves, ""], description: "Parâmetro que muda (vazio se nenhum)." },
        tese_id: { type: "string", enum: [...teses, ""], description: "Tese que muda (vazio se nenhuma)." },
        resumo: { type: "string", description: "O que muda, em até 3 frases." },
        vigente_de: { type: "string", description: "AAAA-MM-DD ou vazio." },
        norma: { type: "string", description: "Número e data do ato (ex.: Portaria Interministerial MPS/MF 13, de 09/01/2026) ou vazio." },
        trecho: { type: "string", description: "Citação literal do texto que prova a mudança." },
        confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        valor_proposto: { type: "object", description: "Novo valor do parâmetro, com as mesmas chaves do atual. Omitir se o texto não traz os números." },
        tese_situacao: { type: "string", enum: [...SITUACOES_TESE, ""] },
        tese_modulacao: { type: "string" },
      },
      required: ["muda_regra", "tipo", "resumo", "confianca"],
    },
  } as const;
}

export function pedidoDeExtracao(a: { fonte: string; titulo: string; url: string; texto: string; candidatos: Candidato[]; teses: TeseCandidata[] }) {
  const params = a.candidatos.map((c) => `- ${c.chave} (${c.titulo}): valor atual = ${JSON.stringify(c.valor)}`).join("\n") || "(nenhum)";
  const teses = a.teses.map((t) => `- ${t.id}: ${t.tribunal} tema ${t.tema} (${t.titulo}); situação atual ${t.situacao}${t.modulacao ? `; modulação: ${t.modulacao}` : ""}`).join("\n") || "(nenhuma)";
  return `FONTE: ${a.fonte}\nTÍTULO: ${a.titulo}\nLINK: ${a.url}\n\nPARÂMETROS CANDIDATOS:\n${params}\n\nTESES CANDIDATAS:\n${teses}\n\nTEXTO:\n${a.texto.slice(0, 18_000)}`;
}

const normal = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();

/** O trecho existe no texto? (sem acento, caixa e espaços; aceita reticências no meio). */
export function trechoConfere(trecho: string, texto: string) {
  const t = normal(texto);
  const partes = normal(trecho).split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length >= 12);
  return partes.length > 0 && partes.every((p) => t.includes(p));
}

const mesmasChaves = (novo: unknown, atual: unknown) =>
  typeof novo === "object" && novo !== null && !Array.isArray(novo) && typeof atual === "object" && atual !== null && !Array.isArray(atual)
  && Object.keys(novo).length > 0 && Object.keys(novo).every((k) => k in (atual as object));

/** Valida a saída do modelo contra o texto e as candidatas. Puro e testável. */
export function validarExtracao(bruto: unknown, texto: string, candidatos: Candidato[], teses: TeseCandidata[]): Extracao {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const avisos: string[] = [];
  const s = (k: string, max = 2000) => (typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim().slice(0, max) : null);
  const chave = s("chave") && candidatos.some((c) => c.chave === s("chave")) ? s("chave") : null;
  const teseId = s("tese_id") && teses.some((t) => t.id === s("tese_id")) ? s("tese_id") : null;
  let tipo = (["parametro", "tese", "sinal"].includes(String(b.tipo)) ? b.tipo : "sinal") as Extracao["tipo"];
  if (tipo === "parametro" && !chave) { tipo = "sinal"; avisos.push("parâmetro fora das candidatas"); }
  if (tipo === "tese" && !teseId) { tipo = "sinal"; avisos.push("tese fora das candidatas"); }
  let confianca = (["alta", "media", "baixa"].includes(String(b.confianca)) ? b.confianca : "baixa") as Extracao["confianca"];
  const trecho = s("trecho", 600);
  const trechoOk = Boolean(trecho && trechoConfere(trecho, texto));
  if (!trechoOk) { confianca = "baixa"; avisos.push(trecho ? "o trecho citado não está no texto da fonte" : "sem trecho da fonte"); }
  const vig = s("vigente_de");
  const vigenteDe = vig && /^\d{4}-\d{2}-\d{2}$/.test(vig) && !Number.isNaN(Date.parse(vig)) ? vig : null;
  const atual = candidatos.find((c) => c.chave === chave)?.valor;
  let valorProposto: unknown | null = null;
  if (tipo === "parametro" && b.valor_proposto !== undefined && b.valor_proposto !== null) {
    if (!trechoOk) avisos.push("valor descartado: sem trecho que prove");
    else if (!mesmasChaves(b.valor_proposto, atual)) avisos.push("valor descartado: formato diferente do atual");
    else valorProposto = { ...(atual as object), ...(b.valor_proposto as object) };
  }
  const situacao = s("tese_situacao");
  return {
    mudaRegra: b.muda_regra === true,
    tipo, chave, teseId,
    resumo: s("resumo", 800) ?? "",
    vigenteDe, norma: s("norma", 300), trecho: trechoOk ? trecho : null, confianca,
    valorProposto,
    teseSituacao: tipo === "tese" && situacao && SITUACOES_TESE.includes(situacao) ? situacao : null,
    teseModulacao: tipo === "tese" ? s("tese_modulacao", 1000) : null,
    avisos,
  };
}

/** Chama o modelo. Sem chave ou com falha: null (a proposta sai só da regra, como sinal). */
export async function extrair(a: { chave: string; buscar?: typeof fetch; fonte: string; titulo: string; url: string; texto: string; candidatos: Candidato[]; teses: TeseCandidata[] }) {
  if (!a.chave) return null;
  try {
    const r = await chamarClaude({
        model: MODELO_SENTINELA, max_tokens: 1500, thinking: semPensar(MODELO_SENTINELA), system: REGRA_EXTRACAO,
        tools: [ferramentaProposta(a.candidatos.map((c) => c.chave), a.teses.map((t) => t.id))] as unknown as CorpoClaude["tools"], tool_choice: { type: "tool", name: "proposta" },
        messages: [{ role: "user", content: pedidoDeExtracao(a) }],
      }, { chave: a.chave, buscar: a.buscar, timeoutMs: 60_000 });
    if (!r.ok) return null;
    const entrada = entradaDe<unknown>(r.mensagem);
    if (!entrada) return null;
    return { extracao: validarExtracao(entrada, a.texto, a.candidatos, a.teses), modelo: MODELO_SENTINELA, tokensEntrada: Number(r.mensagem.usage?.input_tokens ?? 0), tokensSaida: Number(r.mensagem.usage?.output_tokens ?? 0) };
  } catch { return null; }
}
