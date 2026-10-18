import { filtrarEstado } from "../decisao/guard.ts";
import { semPensar, type Ferramenta } from "./base.ts";

/**
 * Habilidades da SARA (proprietário, 18/10/2026): rotinas com nome que combinam consultas que a SARA do
 * módulo já tem, propostas quando ela percebe trabalho repetitivo. Duas origens:
 *   - na conversa: a SARA chama propor_habilidade quando a pessoa diz que faz aquilo com frequência;
 *   - na análise: o proprietário pede, em "O que a SARA aprendeu", e um modelo lê as perguntas recentes
 *     do módulo (já filtradas de dado pessoal) e propõe rotinas para os pedidos que se repetem.
 * Só o proprietário ativa. Ativa, a habilidade vira atalho e instrução da SARA do módulo, e só roda com
 * as consultas que a pessoa pode usar. Nunca grava nada nem cria consulta nova.
 */

export type Passo = { ferramenta: string; para_que: string; entrada?: Record<string, unknown> };
export type Proposta = { nome: string; descricao: string; gatilhos: string[]; passos: Passo[]; formato: string | null; vezes?: number; exemplos?: string[] };
export type HabilidadeAtiva = { id: string; nome: string; descricao: string; gatilhos: string[]; passos: Passo[]; formato: string | null };

const ESQUEMA_PROPOSTA = {
  type: "object",
  properties: {
    nome: { type: "string", description: "Nome curto da rotina (ex.: \"Resumo da semana do caixa\")." },
    descricao: { type: "string", description: "Para que serve, em uma frase." },
    gatilhos: { type: "array", items: { type: "string" }, description: "1 a 3 jeitos de a pessoa pedir isso (frases)." },
    passos: {
      type: "array", description: "As consultas, em ordem. SÓ consultas que você tem.",
      items: { type: "object", properties: { ferramenta: { type: "string" }, para_que: { type: "string" }, entrada: { type: "object" } }, required: ["ferramenta", "para_que"] },
    },
    formato: { type: "string", description: "Como apresentar o resultado (ex.: \"tabela por dia com total\")." },
  },
  required: ["nome", "descricao", "gatilhos", "passos"],
};

/** Ferramenta da SARA para propor uma habilidade no meio da conversa (a rota registra a proposta). */
export const PROPOR_HABILIDADE: Ferramenta = {
  nome: "propor_habilidade", rotulo: "propôs uma habilidade", exige: [],
  descricao: "Propõe uma habilidade (rotina com nome) quando a pessoa diz que faz esse trabalho com frequência (toda semana, todo mês, sempre) ou pede a mesma combinação de consultas de novo. Use só as suas consultas. A proposta vai para aprovação do proprietário: diga isso à pessoa.",
  esquema: ESQUEMA_PROPOSTA,
  rodar: async (_sb, e) => ({ dados: { proposta: String(e.nome ?? "").slice(0, 80), situacao: "enviada para aprovação do proprietário" }, fontes: [] }),
};

/** Fica só o que é válido: passos com consultas que a SARA do módulo tem; ao menos um passo. */
export function validarProposta(p: unknown, permitidas: string[]): Proposta | null {
  const x = (p ?? {}) as Partial<Proposta>;
  const nome = String(x.nome ?? "").trim().slice(0, 80), descricao = String(x.descricao ?? "").trim().slice(0, 600);
  if (nome.length < 3 || descricao.length < 3) return null;
  const passos = (Array.isArray(x.passos) ? x.passos : []).filter((s): s is Passo => Boolean(s) && permitidas.includes(String((s as Passo).ferramenta)))
    .slice(0, 6).map((s) => ({ ferramenta: s.ferramenta, para_que: String(s.para_que ?? "").slice(0, 200), ...(s.entrada && typeof s.entrada === "object" ? { entrada: s.entrada } : {}) }));
  if (!passos.length) return null;
  const gatilhos = (Array.isArray(x.gatilhos) ? x.gatilhos : []).map((g) => String(g).trim().slice(0, 160)).filter((g) => g.length >= 3).slice(0, 3);
  return { nome, descricao, gatilhos: gatilhos.length ? gatilhos : [nome], passos, formato: x.formato ? String(x.formato).slice(0, 600) : null,
    vezes: Number.isFinite(Number(x.vezes)) ? Number(x.vezes) : undefined, exemplos: Array.isArray(x.exemplos) ? x.exemplos.map((e) => String(e).slice(0, 200)).slice(0, 4) : undefined };
}

/** Só as habilidades que a pessoa consegue rodar (todas as consultas dela disponíveis). */
export const habilidadesQuePode = (h: HabilidadeAtiva[], disponiveis: string[]) => h.filter((x) => x.passos.length && x.passos.every((p) => disponiveis.includes(p.ferramenta)));

/** Instruções das habilidades ativas para o prompt da SARA. */
export function instrucoesDeHabilidades(h: HabilidadeAtiva[]): string {
  if (!h.length) return "";
  return `Habilidades aprovadas neste módulo (quando o pedido combinar, siga os passos e apresente no formato pedido):\n${h.map((x) =>
    `- ${x.nome}: ${x.descricao} Pedidos: ${x.gatilhos.map((g) => `"${g}"`).join(", ")}. Passos: ${x.passos.map((p, i) => `${i + 1}) ${p.ferramenta}${p.entrada ? ` ${JSON.stringify(p.entrada)}` : ""} — ${p.para_que}`).join("; ")}.${x.formato ? ` Apresente: ${x.formato}.` : ""}`).join("\n")}`;
}

/**
 * Análise das perguntas recentes de um módulo: um modelo procura pedidos que se repetem e propõe
 * habilidades só com as consultas do módulo. Pergunta com dado pessoal fica de fora.
 */
export async function analisarConversas(a: {
  chave: string; buscar?: typeof fetch; modelo?: string; empresa: string; rotulo: string; perguntas: string[]; ferramentas: { nome: string; descricao: string }[];
}): Promise<{ propostas: Proposta[]; usadas: number; tokens: number }> {
  const perguntas = [...new Set(a.perguntas.map((p) => p.trim()).filter((p) => p.length >= 6 && filtrarEstado(p).ok))].slice(0, 250);
  if (perguntas.length < 4) return { propostas: [], usadas: perguntas.length, tokens: 0 };
  const corpo = {
    // Haiku: aceita forçar a resposta pela ferramenta (saída estruturada); o Sonnet 5.5 não aceita.
    model: a.modelo ?? "claude-haiku-5-5", max_tokens: 3000, thinking: semPensar(a.modelo ?? "claude-haiku-5-5"),
    system: `Você analisa como as pessoas da ${a.empresa} usam o assistente do módulo ${a.rotulo}. Ache TRABALHOS REPETITIVOS: o mesmo pedido (ou a mesma combinação de pedidos) que aparece várias vezes. Para cada um que se repete ao menos 3 vezes, proponha uma habilidade: uma rotina com nome, só com as consultas listadas abaixo. Vale a pena quando a rotina junta duas ou mais consultas, ou sempre usa o mesmo filtro e o mesmo jeito de apresentar (ex.: "toda segunda: o que vence na semana + como fica o caixa, em tabela"). Uma pergunta simples, que o assistente já responde direto com uma consulta, NÃO vira habilidade. Não invente consulta. Se nada assim se repete, não proponha nada.\nConsultas do módulo:\n${a.ferramentas.map((f) => `- ${f.nome}: ${f.descricao}`).join("\n")}`,
    messages: [{ role: "user", content: `Perguntas feitas ao assistente nos últimos dias (uma por linha):\n${perguntas.map((p) => `- ${p.slice(0, 300)}`).join("\n")}` }],
    tools: [{ name: "propor_habilidades", description: "Registra as habilidades propostas.", input_schema: { type: "object", properties: {
      habilidades: { type: "array", items: { ...ESQUEMA_PROPOSTA, properties: { ...ESQUEMA_PROPOSTA.properties, vezes: { type: "integer", description: "Quantas vezes o pedido apareceu." }, exemplos: { type: "array", items: { type: "string" } } } } },
    }, required: ["habilidades"] } }],
    tool_choice: { type: "tool", name: "propor_habilidades" },
  };
  const r = await (a.buscar ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "content-type": "application/json", "x-api-key": a.chave, "anthropic-version": "2023-06-01" }, body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => null) as { content?: { type: string; input?: { habilidades?: unknown[] } }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } } | null;
  if (!r.ok || !j?.content) throw new Error(`Análise indisponível: ${r.status} ${j?.error?.message ?? ""}`.trim());
  const bruto = j.content.find((b) => b.type === "tool_use")?.input?.habilidades ?? [];
  const permitidas = a.ferramentas.map((f) => f.nome);
  // Só o que se repete (3+) e vale a rotina: duas ou mais consultas, ou filtro e formato fixos.
  const vale = (p: Proposta) => p.passos.length >= 2 || (Boolean(p.formato) && p.passos.some((x) => x.entrada && Object.keys(x.entrada).length));
  const propostas = bruto.map((p) => validarProposta(p, permitidas)).filter((p): p is Proposta => Boolean(p) && (p!.vezes ?? 3) >= 3 && vale(p!));
  return { propostas, usadas: perguntas.length, tokens: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0) };
}

/**
 * Rede de segurança da colheita (o modelo nem sempre lembra de chamar registrar_lacuna ou
 * propor_habilidade): a plataforma reconhece a resposta "não consigo" (que não seja falta de permissão)
 * e o pedido recorrente ("toda segunda…", "todo mês…").
 */
export const pareceLacuna = (texto: string) =>
  /ainda não tenho (uma )?consulta/i.test(texto) || (
    /(não (consigo|tenho como|tenho uma consulta|há uma consulta|é possível (calcular|saber|levantar|responder))|não existe uma consulta|sem uma consulta que|não tenho acesso a esse (cálculo|calculo|dado|número|numero|levantamento)|i'?m not able|i can'?t|i cannot)/i.test(texto)
    && !/(permiss|não está liberad)/i.test(texto));
export const pedidoRecorrente = (pergunta: string) =>
  /\b(tod[ao]s? (as |os )?(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|semana|dia|m[eê]s|manhã|manha|in[ií]cio|come[cç]o|fim|final)s?|sempre que|toda vez que|semanalmente|mensalmente|diariamente|todo fechamento|a cada (semana|m[eê]s|dia))/i.test(pergunta);

/** Nome, descrição e formato de uma habilidade montada a partir das consultas que a SARA de fato usou. */
export async function nomearHabilidade(a: { chave: string; buscar?: typeof fetch; rotulo: string; pergunta: string; passos: Passo[] }): Promise<Proposta> {
  const reserva: Proposta = { nome: a.pergunta.replace(/\s+/g, " ").trim().slice(0, 60), descricao: a.pergunta.slice(0, 300), gatilhos: [a.pergunta.slice(0, 160)], passos: a.passos, formato: null };
  try {
    const r = await (a.buscar ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", "x-api-key": a.chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-5-5", max_tokens: 400, thinking: semPensar("claude-haiku-5-5"),
        system: `Dê nome a uma rotina do assistente do módulo ${a.rotulo}. Em português do Brasil, curto e claro.`,
        messages: [{ role: "user", content: `Pedido recorrente da pessoa: "${a.pergunta.slice(0, 500)}"\nConsultas usadas: ${a.passos.map((p) => p.ferramenta).join(", ")}` }],
        tools: [{ name: "nomear", description: "Nome, descrição e formato da rotina.", input_schema: { type: "object", properties: {
          nome: { type: "string", description: "Até 6 palavras (ex.: \"Resumo da semana do caixa\")." }, descricao: { type: "string" }, gatilho: { type: "string", description: "Um jeito curto de pedir." }, formato: { type: "string" },
          para_que: { type: "array", items: { type: "string" }, description: "Para que serve cada consulta, na mesma ordem (curto)." },
        }, required: ["nome", "descricao", "gatilho"] } }],
        tool_choice: { type: "tool", name: "nomear" },
      }),
    });
    const j = await r.json().catch(() => null) as { content?: { type: string; input?: { nome?: string; descricao?: string; gatilho?: string; formato?: string } }[] } | null;
    const x = j?.content?.find((b) => b.type === "tool_use")?.input as { nome?: string; descricao?: string; gatilho?: string; formato?: string; para_que?: string[] } | undefined;
    if (!r.ok || !x?.nome) return reserva;
    const passos = a.passos.map((p, i) => (x.para_que?.[i] ? { ...p, para_que: String(x.para_que[i]).slice(0, 200) } : p));
    return { nome: x.nome.slice(0, 80), descricao: (x.descricao ?? reserva.descricao).slice(0, 600), gatilhos: [x.gatilho ?? reserva.gatilhos[0]].map((g) => g.slice(0, 160)), passos, formato: x.formato?.slice(0, 600) ?? null };
  } catch { return reserva; }
}
