import { mesmoProblema, type Envio, type Impacto } from "./vigia.ts";

/**
 * J5 da SARA central (docs/PLANO-MINDMASTER.md §4e): ela aprende com as respostas e o efeito.
 *   - Pelo histórico da vigia (regra da plataforma, sem modelo): por tipo de achado, quantas vezes apareceu,
 *     o que a área respondeu, quantos saíram dos avisos (e depois de quem disse "Vou tratar"), em quantos
 *     dias e se volta. Recorrente sobe de impacto; "Não é problema" repetido vira pergunta à área: parar de
 *     avisar?
 *   - Pelo que as pessoas ensinam: lições propostas na conversa, aprovadas pela área (sara_licoes).
 * Lição é contexto, nunca dado: os números continuam vindo das consultas. Regras puras, testadas em
 * tests/sara-aprendizado.test.mjs; o banco fica na vigia (vigia-executar.ts) e em licoes.ts.
 */

export const APRENDIZADO = {
  /** O histórico que conta. */
  janelaDias: 90,
  /** Recorrente: resolvido N vezes (ou mais) dentro destes dias e de volta. */
  recorrenteDias: 60, recorrenteMin: 2,
  /** Parar de avisar: "Não é problema" em N das últimas M vezes que a área respondeu. */
  silencioDe: 4, silencioMin: 3,
  /** O que vai para o texto da central. */
  maxLicoes: 30, maxTipos: 12,
} as const;

export type LinhaHistorico = {
  tipo: string; modulo: string; area: string; titulo: string; situacao: string; envios: Envio[];
  created_at: string; resolvido_em: string | null;
};

export type AprendidoTipo = {
  tipo: string; modulo: string; area: string; titulo: string;
  vezes: number; respondidas: number; naoEProblema: number; resolvidos: number; resolvidosDepoisDeTratar: number;
  /** Mediana de dias entre o achado e a saída dos avisos (null sem resolvidos). */
  diasParaResolver: number | null;
  /** Resolvidos nos últimos `recorrenteDias` (quantas vezes já saiu e voltou). */
  resolvidosRecentes: number;
  recorrente: boolean;
  /** As últimas respostas da área dizem "Não é problema": a vigia pergunta se pode parar de avisar. */
  propoeSilencio: boolean;
  ultimaVez: string;
};

const DIA = 86_400_000;

/** A resposta da área a um achado: "Não é problema", "Vou tratar", "Preciso de ajuda" ou nenhuma. */
export function respostaDaArea(l: Pick<LinhaHistorico, "situacao" | "envios">): string | null {
  const r = l.envios.map((e) => e.resposta).filter((x): x is string => Boolean(x));
  if (l.situacao === "nao_e_problema" || (r.length && r.every((x) => x === "Não é problema"))) return "Não é problema";
  if (r.includes("Preciso de ajuda")) return "Preciso de ajuda";
  if (r.includes("Vou tratar")) return "Vou tratar";
  return r[0] ?? null;
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

/** O que a vigia aprendeu, por tipo de achado, nos últimos 90 dias (mais frequentes primeiro). */
export function aprendizadoDaVigia(linhas: LinhaHistorico[], agora: Date = new Date()): AprendidoTipo[] {
  const desde = agora.getTime() - APRENDIZADO.janelaDias * DIA;
  const recente = agora.getTime() - APRENDIZADO.recorrenteDias * DIA;
  const grupos = new Map<string, LinhaHistorico[]>();
  for (const l of linhas) {
    if (Date.parse(l.created_at) < desde) continue;
    grupos.set(l.tipo, [...(grupos.get(l.tipo) ?? []), l]);
  }
  const saida: AprendidoTipo[] = [];
  for (const [tipo, ls] of grupos) {
    const ordem = [...ls].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ultima = ordem[ordem.length - 1];
    const respostas = ordem.map(respostaDaArea);
    const resolvidos = ordem.filter((l) => l.situacao === "resolvido" && l.resolvido_em);
    const respondidas = respostas.filter(Boolean) as string[];
    const ultimas = respondidas.slice(-APRENDIZADO.silencioDe);
    const resolvidosRecentes = resolvidos.filter((l) => Date.parse(l.resolvido_em!) >= recente).length;
    saida.push({
      tipo, modulo: ultima.modulo, area: ultima.area, titulo: ultima.titulo,
      vezes: ordem.length, respondidas: respondidas.length,
      naoEProblema: respostas.filter((r) => r === "Não é problema").length,
      resolvidos: resolvidos.length,
      resolvidosDepoisDeTratar: resolvidos.filter((l) => respostaDaArea(l) === "Vou tratar").length,
      diasParaResolver: mediana(resolvidos.map((l) => Math.max(0, Math.round((Date.parse(l.resolvido_em!) - Date.parse(l.created_at)) / DIA)))),
      resolvidosRecentes,
      recorrente: resolvidosRecentes >= APRENDIZADO.recorrenteMin,
      propoeSilencio: ultimas.filter((r) => r === "Não é problema").length >= APRENDIZADO.silencioMin,
      ultimaVez: ultima.created_at,
    });
  }
  return saida.sort((a, b) => b.vezes - a.vezes || b.ultimaVez.localeCompare(a.ultimaVez));
}

/** Os tipos aprendidos que tratam do mesmo problema de um achado novo (mesma área e metade dos sinais em comum). */
export function doMesmoProblema(aprendido: AprendidoTipo[], novo: { modulo: string; tipos: string[] }): AprendidoTipo[] {
  return aprendido.filter((t) => mesmoProblema(novo, { id: t.tipo, tipo: t.tipo, modulo: t.modulo, titulo: t.titulo, sinais: [], situacao: "resolvido" }));
}

const SOBE: Record<Impacto, Impacto> = { baixo: "medio", medio: "alto", alto: "alto" };
const ordinal = (n: number) => `${n}ª`;

/**
 * Achado de um problema recorrente: sobe um nível de impacto e o "por que" começa dizendo quantas vezes já
 * voltou (texto da plataforma, com os números do histórico).
 */
export function comRecorrencia<T extends { impacto: Impacto; por_que: string }>(a: T, relacionados: AprendidoTipo[]): T & { recorrente: boolean } {
  const vezes = Math.max(0, ...relacionados.filter((t) => t.recorrente).map((t) => t.resolvidosRecentes));
  if (!vezes) return { ...a, recorrente: false };
  const prefixo = `Recorrente: é a ${ordinal(vezes + 1)} vez em ${APRENDIZADO.recorrenteDias} dias (já saiu dos avisos ${vezes} vezes e voltou).`;
  return { ...a, impacto: SOBE[a.impacto], por_que: `${prefixo} ${a.por_que}`.slice(0, 1200), recorrente: true };
}

/** A pergunta à área quando ela diz "Não é problema" sempre ao mesmo aviso (o texto da lição de silêncio). */
export function textoDoSilencio(t: AprendidoTipo): string {
  return `A área respondeu "Não é problema" em ${t.naoEProblema} das ${t.respondidas} vezes que respondeu ao aviso "${t.titulo}" (${t.area}), inclusive nas últimas. Aprovando, a vigia deixa de mandar este aviso.`.slice(0, 500);
}

const CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;
/** A lição que a SARA central propõe: uma regra do negócio, curta, sem dado pessoal. */
export function validarLicao(texto: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 10) return { ok: false, erro: "Escreva a lição em uma frase completa (pelo menos 10 caracteres)." };
  if (t.length > 500) return { ok: false, erro: "A lição passou de 500 caracteres: deixe só a regra." };
  if (CPF.test(t) || /\b(cpf|pis|rg)\b\s*:?\s*\d/i.test(t)) return { ok: false, erro: "A lição não pode ter CPF, PIS ou documento de pessoa." };
  return { ok: true, texto: t };
}

export type LicaoAtiva = { modulo: string; area: string; texto: string; ensinada_por_nome: string | null; decidida_por_nome: string | null; efeito: string };

/** Uma linha do que a vigia aprendeu, para o texto da central (os números são do histórico). */
export function linhaDoTipo(t: AprendidoTipo): string {
  const partes = [`${t.vezes} ${t.vezes === 1 ? "vez" : "vezes"} em ${APRENDIZADO.janelaDias} dias`];
  if (t.resolvidos) partes.push(`${t.resolvidos} ${t.resolvidos === 1 ? "saiu" : "saíram"} dos avisos${t.resolvidosDepoisDeTratar ? ` (${t.resolvidosDepoisDeTratar} depois de "Vou tratar")` : ""}${t.diasParaResolver !== null ? `, em ${String(t.diasParaResolver).replace(".", ",")} ${t.diasParaResolver === 1 ? "dia" : "dias"} (mediana)` : ""}`);
  if (t.naoEProblema) partes.push(`"Não é problema" ${t.naoEProblema} ${t.naoEProblema === 1 ? "vez" : "vezes"}`);
  if (t.recorrente) partes.push("recorrente");
  return `- [${t.area}] "${t.titulo}": ${partes.join("; ")}.`;
}

/** O bloco de memória que entra no texto da SARA (as lições aprovadas e, na central, o que a vigia aprendeu). */
export function blocoDeAprendizado(licoes: LicaoAtiva[], tipos: AprendidoTipo[] = []): string {
  const contexto = licoes.filter((l) => l.efeito === "contexto").slice(0, APRENDIZADO.maxLicoes);
  const partes: string[] = [];
  if (contexto.length)
    partes.push(`O QUE A EMPRESA JÁ ENSINOU (lições aprovadas pela área; são contexto para entender e explicar, NUNCA fonte de número):\n${contexto.map((l) => `- [${l.area}] ${l.texto} (ensinou: ${l.ensinada_por_nome ?? "alguém da empresa"}; aprovou: ${l.decidida_por_nome ?? "a área"})`).join("\n")}`);
  const ts = tipos.slice(0, APRENDIZADO.maxTipos);
  if (ts.length)
    partes.push(`O QUE A VIGIA APRENDEU (histórico dos achados, calculado pela plataforma; pode citar estes números):\n${ts.map(linhaDoTipo).join("\n")}`);
  return partes.join("\n\n");
}
