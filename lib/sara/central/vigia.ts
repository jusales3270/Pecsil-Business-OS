import { semPensar } from "../base.ts";
import { QUEM_DECIDE } from "./sara.ts";
import { conferirNumeros } from "./verificador.ts";

/**
 * Vigia da SARA central (E7, J3 — docs/PLANO-MINDMASTER.md). Todo dia, de segunda a sábado, ela varre os
 * SINAIS da empresa (os avisos calculados de cada módulo e os Parados), liga uma área à outra, ordena pelo
 * impacto e transforma o que pesa em ACHADOS: o gargalo, a evidência, o impacto, 1 a 3 ações de contenção e
 * quem decide. Cada achado vai ao responsável da área como "Decisão para você"; sem resposta, ela cobra;
 * quando a situação sai dos sinais, ela registra o efeito. Aqui ficam as regras puras (sem banco), testadas
 * em tests/sara-vigia.test.mjs; a execução fica em vigia-executar.ts.
 */

export const VIGIA = {
  dias: [1, 2, 3, 4, 5, 6], hora: "06:30", ate: "10:00",
  /** Achados novos por rodada e por pessoa por dia (sem ruído). */
  maxAchados: 8, maxPorPessoaDia: 3,
  /** Sem resposta há N dias, ela lembra (no máximo M vezes). */
  cobrarDias: 2, maxCobrancas: 3,
  /** "Não é problema": aquele tipo de achado fica em silêncio para a área por N dias. */
  silencioDias: 30,
  modelo: "claude-sonnet-5-5",
  opcoes: ["Vou tratar", "Não é problema", "Preciso de ajuda"],
} as const;

export type Sinal = { id: string; chave: string; tipo: string; modulo: string; area: string; nivel: "urgente" | "aviso"; titulo: string; detalhe?: string; origem: "aviso" | "parado" };
export type Impacto = "alto" | "medio" | "baixo";
export type Achado = {
  modulo: string; area: string; titulo: string; por_que: string; sinais: string[]; impacto: Impacto; ligacoes: string[]; contencao: string[];
  confianca: "alta" | "media" | "baixa"; origem: "modelo" | "plataforma"; mesmo_que?: string | null;
};
export type AchadoAberto = { id: string; tipo: string; modulo: string; titulo: string; sinais: string[]; situacao: string };
export type Envio = { profile_id: string; nome: string; decisao_id: string; enviado_em: string; resposta?: string | null; cobrancas?: number; cobrado_em?: string | null };

/** Áreas dos Parados (A-11) → módulo da SARA. */
export const AREA_DO_PARADO: Record<string, string> = { Compras: "compras", Almoxarifado: "almoxarifado", "Produção": "producao", Comercial: "comercial", Fiscal: "fiscal", Financeiro: "financeiro" };

/** O "tipo" de uma chave de aviso: a parte antes da impressão da situação ("financeiro.vencidas:394" → "financeiro.vencidas"). */
export const tipoDaChave = (chave: string) => chave.split(":")[0];

/** Hash curto e estável (FNV-1a), para a chave não crescer com a lista de referências. */
export function impressao(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

type Aviso = { chave: string; nivel: "urgente" | "aviso"; titulo: string; detalhe?: string };
export type Parado = { tipo: string; area: string; titulo: string; detalhe?: string | null; dias: number; ref?: string | null };

/**
 * Os sinais da rodada: os avisos de cada módulo (sem as novidades) e os Parados agrupados por tipo (um sinal
 * por tipo, com a quantidade e o mais antigo). Parado há 7 dias ou mais é urgente.
 */
export function sinaisDe(avisos: { modulo: string; area: string; avisos: Aviso[] }[], parados: Parado[]): Sinal[] {
  const saida: Omit<Sinal, "id">[] = [];
  for (const m of avisos) for (const a of m.avisos) {
    if (a.chave.includes(".novidades:")) continue;
    saida.push({ chave: a.chave, tipo: tipoDaChave(a.chave), modulo: m.modulo, area: m.area, nivel: a.nivel, titulo: a.titulo, detalhe: a.detalhe, origem: "aviso" });
  }
  const grupos = new Map<string, Parado[]>();
  for (const p of parados) { const k = p.tipo; grupos.set(k, [...(grupos.get(k) ?? []), p]); }
  for (const [tipo, lista] of grupos) {
    const modulo = AREA_DO_PARADO[lista[0].area];
    if (!modulo) continue;
    const ordem = [...lista].sort((a, b) => b.dias - a.dias);
    const maior = ordem[0].dias;
    saida.push({
      chave: `parado.${tipo}:${impressao(ordem.map((x) => x.ref ?? x.titulo).sort().join("|"))}`, tipo: `parado.${tipo}`, modulo, area: lista[0].area,
      nivel: maior >= 7 ? "urgente" : "aviso",
      titulo: `${lista.length} ${lista.length === 1 ? "item parado" : "itens parados"} (${tipo.replace(/_/g, " ")}), o mais antigo há ${maior} dias`,
      detalhe: ordem.slice(0, 3).map((x) => `${x.titulo} (${x.dias} dias)`).join(" · "), origem: "parado",
    });
  }
  return saida.map((s, i) => ({ ...s, id: `s${i + 1}` }));
}

/** Tipo do achado: o módulo e os tipos dos sinais de origem (estável enquanto o problema for o mesmo). */
export function tipoDoAchado(modulo: string, sinais: Sinal[]): string {
  return `${modulo}:${[...new Set(sinais.map((s) => s.tipo))].sort().join("+")}`.slice(0, 120);
}

/** O achado novo é o mesmo problema de um aberto? Mesmo módulo e metade (ou mais) dos tipos de sinal em comum. */
export function mesmoProblema(novo: { modulo: string; tipos: string[] }, aberto: AchadoAberto): boolean {
  if (novo.modulo !== aberto.modulo) return false;
  const deles = new Set(aberto.tipo.split(":").slice(1).join(":").split("+"));
  const comuns = novo.tipos.filter((t) => deles.has(t)).length;
  return comuns > 0 && comuns * 2 >= Math.min(novo.tipos.length, deles.size);
}

/** Sem o modelo (falta a chave, falhou ou passou do teto): cada sinal urgente vira um achado da própria área. */
export function achadosDaPlataforma(sinais: Sinal[]): Achado[] {
  return sinais.filter((s) => s.nivel === "urgente").map((s) => ({
    modulo: s.modulo, area: s.area, titulo: s.titulo.slice(0, 160), por_que: s.detalhe ?? s.titulo, sinais: [s.id], impacto: "alto" as const,
    ligacoes: [], contencao: [], confianca: "alta" as const, origem: "plataforma" as const,
  }));
}

const PESO: Record<Impacto, number> = { alto: 0, medio: 1, baixo: 2 };
/** Impacto alto primeiro; no empate, o que tem mais sinais urgentes, depois o que liga mais áreas. */
export function ordenarPorImpacto(achados: Achado[], sinais: Sinal[]): Achado[] {
  const urg = (a: Achado) => a.sinais.filter((id) => sinais.find((s) => s.id === id)?.nivel === "urgente").length;
  return [...achados].sort((a, b) => PESO[a.impacto] - PESO[b.impacto] || urg(b) - urg(a) || b.ligacoes.length - a.ligacoes.length);
}

const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Confere o que o modelo devolveu: sinais que existem, módulo válido, até 3 contenções e TODO número com
 * fonte nos sinais (o mesmo verificador da central). O que não passa é descartado (com o motivo).
 */
export function validarAchados(bruto: unknown, sinais: Sinal[], modulos: string[], rotulo: (m: string) => string): { achados: Achado[]; descartados: string[]; sinaisDescartados: string[] } {
  const lista = Array.isArray((bruto as { achados?: unknown })?.achados) ? (bruto as { achados: unknown[] }).achados : [];
  const fontes = sinais.map((s) => `${s.titulo}. ${s.detalhe ?? ""}`);
  const achados: Achado[] = [], descartados: string[] = [], sinaisDescartados: string[] = [];
  for (const x of lista.slice(0, 12) as Record<string, unknown>[]) {
    const ids = (Array.isArray(x.sinais) ? x.sinais : []).map(String).filter((id) => sinais.some((s) => s.id === id));
    const titulo = texto(x.titulo, 160);
    if (!ids.length || titulo.length < 3) { descartados.push(`${titulo || "(sem título)"}: sem sinal de origem`); continue; }
    const doSinal = sinais.find((s) => s.id === ids[0])!.modulo;
    const modulo = modulos.includes(String(x.modulo)) ? String(x.modulo) : doSinal;
    const a: Achado = {
      modulo, area: rotulo(modulo), titulo, por_que: texto(x.por_que, 1200), sinais: ids,
      impacto: (["alto", "medio", "baixo"] as const).find((i) => i === x.impacto) ?? "medio",
      ligacoes: [...new Set((Array.isArray(x.ligacoes) ? x.ligacoes : []).map(String).filter((m) => modulos.includes(m) && m !== modulo))].slice(0, 4),
      contencao: (Array.isArray(x.contencao) ? x.contencao : []).map((c) => texto(c, 240)).filter((c) => c.length >= 3).slice(0, 3),
      confianca: (["alta", "media", "baixa"] as const).find((c) => c === x.confianca) ?? "media", origem: "modelo",
      mesmo_que: typeof x.mesmo_que === "string" && x.mesmo_que ? x.mesmo_que : null,
    };
    const c = conferirNumeros([a.titulo, a.por_que, ...a.contencao].join(" "), fontes);
    if (c.semFonte.length) { descartados.push(`${titulo}: número sem fonte (${c.semFonte.join(", ")})`); sinaisDescartados.push(...ids); continue; }
    achados.push(a);
  }
  return { achados, descartados, sinaisDescartados: [...new Set(sinaisDescartados)].filter((id) => !achados.some((a) => a.sinais.includes(id))) };
}

/**
 * O achado do modelo foi descartado (número sem fonte), mas o problema continua: os sinais URGENTES dele que
 * nenhum outro achado cobre viram achados da plataforma, só com o que os avisos dizem.
 */
export function resgatarDescartados(ids: string[], sinais: Sinal[]): Achado[] {
  return achadosDaPlataforma(sinais.filter((s) => ids.includes(s.id)));
}

/** Situação do achado pelas respostas: ajuda > vou tratar > todos "não é problema" > esperando. */
export function situacaoPelasRespostas(envios: Envio[]): "enviado" | "tratando" | "ajuda" | "nao_e_problema" {
  const r = envios.map((e) => e.resposta ?? null);
  if (r.includes("Preciso de ajuda")) return "ajuda";
  if (r.includes("Vou tratar")) return "tratando";
  if (r.length && r.every((x) => x === "Não é problema")) return "nao_e_problema";
  return "enviado";
}

/** Hora de lembrar quem não respondeu? */
export function precisaCobrar(e: Envio, agora: Date = new Date(), regra: { cobrarDias: number; maxCobrancas: number } = VIGIA): boolean {
  if (e.resposta) return false;
  if ((e.cobrancas ?? 0) >= regra.maxCobrancas) return false;
  const desde = Date.parse(e.cobrado_em ?? e.enviado_em);
  return Number.isFinite(desde) && agora.getTime() - desde >= regra.cobrarDias * 86_400_000;
}

const NOME_IMPACTO: Record<Impacto, string> = { alto: "alto", medio: "médio", baixo: "baixo" };
const NOME_CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" } as const;

/** O achado como "Decisão para você": evidência, contenção, ligações e a marca de opinião da IA. */
export function decisaoDoAchado(a: Achado, sinais: Sinal[], rotulo: (m: string) => string): { assunto: string; pergunta: string; detalhes: string[] } {
  const ev = a.sinais.map((id) => sinais.find((s) => s.id === id)).filter(Boolean) as Sinal[];
  // Até 5 evidências (as outras ficam no quadro da War Room); a marca de quem analisou nunca sai.
  const detalhes = [
    ...ev.slice(0, 5).map((s) => `Evidência (${s.area}): ${s.titulo}${s.detalhe ? `. ${s.detalhe}` : ""}`.slice(0, 400)),
    ...(ev.length > 5 ? [`E mais ${ev.length - 5} evidências no quadro da vigia.`] : []),
    ...a.contencao.map((c, i) => `Para conter${a.contencao.length > 1 ? ` (${i + 1})` : ""}: ${c}`),
    ...(a.ligacoes.length ? [`Afeta também: ${a.ligacoes.map(rotulo).join(", ")}`] : []),
    `Impacto ${NOME_IMPACTO[a.impacto]} · ${a.origem === "modelo" ? `análise da SARA (IA), confiança ${NOME_CONFIANCA[a.confianca]}` : "levantado pela plataforma nos avisos"}`,
  ];
  return {
    assunto: `Vigia da SARA: ${a.titulo}`.slice(0, 160),
    pergunta: `${a.por_que || a.titulo}\n\nA decisão é sua. O que você vai fazer?`.slice(0, 1000),
    detalhes,
  };
}

export const REGRA_VIGIA = `Você é a vigia da SARA central: todo dia você lê os SINAIS da empresa (avisos calculados de cada módulo e o que está parado) e aponta os GARGALOS que pesam: estruturais, financeiros ou de pessoal.
- Junte sinais que são o mesmo problema ou que se ligam (ex.: compra atrasada no Almoxarifado trava a Produção, que atrasa o faturamento e aperta o caixa). Diga a ligação em "por_que" e as áreas afetadas em "ligacoes".
- Cada achado é de UMA área responsável ("modulo"), a que precisa agir. Quem decide em cada área: ${QUEM_DECIDE}.
- "sinais": os ids dos sinais que provam o achado. Sem sinal, sem achado.
- Use SÓ números que estão nos sinais, do jeito que estão. Não some, não estime, não arredonde. Um verificador confere.
- "contencao": 1 a 3 ações práticas e imediatas para conter, que a própria área pode fazer na plataforma ou na rotina. Não decida pela área.
- "impacto": alto (dinheiro relevante, prazo de cliente, operação parada), medio ou baixo. "confianca": o quanto você está segura da ligação.
- Se um ACHADO ABERTO (lista abaixo) já cobre o mesmo problema, devolva o id dele em "mesmo_que" (não crie outro).
- No máximo 8 achados, os mais importantes. Sinal pequeno e isolado não precisa virar achado.
- Português do Brasil, frases curtas e diretas.
- Responda SEMPRE chamando registrar_achados (uma vez, com todos os achados e o resumo), sem texto fora dela. Sem gargalo relevante: achados vazio.`;

export const FERRAMENTA_ACHADOS = {
  name: "registrar_achados",
  description: "Registra os achados da vigia (gargalos), com os sinais que os provam.",
  input_schema: {
    type: "object",
    properties: {
      achados: {
        type: "array", maxItems: 8,
        items: {
          type: "object",
          properties: {
            modulo: { type: "string", description: "Código da área responsável (financeiro, compras, almoxarifado, fundicao, comercial, fiscal, rh, portaria, producao, ti)." },
            titulo: { type: "string", description: "O gargalo em até 12 palavras." },
            por_que: { type: "string", description: "O que está acontecendo, a ligação entre as áreas e o risco (até 4 frases)." },
            sinais: { type: "array", items: { type: "string" }, description: "Ids dos sinais (s1, s2…)." },
            impacto: { type: "string", enum: ["alto", "medio", "baixo"] },
            ligacoes: { type: "array", items: { type: "string" }, description: "Outras áreas afetadas (códigos)." },
            contencao: { type: "array", items: { type: "string" }, maxItems: 3 },
            confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            mesmo_que: { type: "string", description: "Id do achado aberto que já cobre este problema, se houver." },
          },
          required: ["modulo", "titulo", "por_que", "sinais", "impacto", "contencao", "confianca"],
        },
      },
      resumo: { type: "string", description: "Uma frase: como a empresa amanheceu." },
    },
    required: ["achados", "resumo"],
  },
} as const;

export type Analise = { bruto: unknown; resumo: string; modelo: string; tokensEntrada: number; tokensSaida: number };

/** A análise do dia pelo modelo (Sonnet). Falhou: null (a rodada segue com os achados da plataforma). */
export async function analisarSinais(a: { chave: string; buscar?: typeof fetch; hoje: string; sinais: Sinal[]; abertos: AchadoAberto[] }): Promise<Analise | null> {
  if (!a.chave || !a.sinais.length) return null;
  const linhas = a.sinais.map((s) => `${s.id} [${s.nivel === "urgente" ? "URGENTE" : "aviso"}] ${s.area} (${s.modulo}): ${s.titulo}${s.detalhe ? `. ${s.detalhe}` : ""}`).join("\n");
  const abertos = a.abertos.length ? a.abertos.map((x) => `${x.id} · ${x.modulo} · ${x.situacao}: ${x.titulo}`).join("\n") : "(nenhum)";
  try {
    const r = await (a.buscar ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { "content-type": "application/json", "x-api-key": a.chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: VIGIA.modelo, max_tokens: 4000, thinking: semPensar(VIGIA.modelo), system: REGRA_VIGIA,
        // O Sonnet 5.5 não aceita forçar a ferramenta (tool_choice "tool"/"any"): fica no automático e a regra pede a chamada.
        tools: [FERRAMENTA_ACHADOS], tool_choice: { type: "auto" },
        messages: [{ role: "user", content: `Hoje: ${a.hoje}\n\nSINAIS:\n${linhas}\n\nACHADOS ABERTOS:\n${abertos}` }],
      }),
    });
    const j = await r.json().catch(() => null) as { content?: { type: string; input?: { achados?: unknown[]; resumo?: string } }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null;
    const uso = { tokensEntrada: Number(j?.usage?.input_tokens ?? 0), tokensSaida: Number(j?.usage?.output_tokens ?? 0) };
    const entrada = j?.content?.find((b) => b.type === "tool_use")?.input;
    if (!r.ok || !entrada) return null;
    return { bruto: entrada, resumo: texto(entrada.resumo, 600), modelo: VIGIA.modelo, ...uso };
  } catch { return null; }
}
