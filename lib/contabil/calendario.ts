/**
 * Calendário fiscal da empresa (N-06). As obrigações e os prazos vêm dos parâmetros legais (calendario_obrigacoes,
 * camada legal e da UF), com a regra de cada uma: o dia, a referência (mês seguinte, 2º mês seguinte, ano
 * seguinte) e o que fazer quando o dia não é útil (antecipa, prorroga ou mantém). Dia útil = de segunda a sexta,
 * fora dos feriados dos parâmetros. Puro: recebe a lista e os feriados e devolve as datas, com a memória do ajuste.
 * Nenhum prazo fica no código: a regra é dado, com vigência e fonte.
 */

export type Ajuste = "antecipa" | "prorroga" | "mantem" | "a_conferir";
export type Obrigacao = {
  codigo: string;
  nome: string;
  tipo: "guia" | "declaracao";
  periodicidade: "mensal" | "trimestral" | "anual";
  /** Mês do vencimento em relação à competência: 1 = mês seguinte, 2 = 2º mês seguinte; anual: ano seguinte. */
  meses_depois?: number;
  /** Dia do vencimento: número, "ultimo_util", "util:N" (N-ésimo dia útil) ou "definir" (depende de dado da empresa). */
  dia: number | "ultimo_util" | `util:${number}` | "definir";
  /** Anual: mês do vencimento no ano seguinte. */
  mes?: number;
  ajuste: Ajuste;
  /** Regimes a que se aplica; sem a lista, vale para todos. */
  regimes?: ("presumido" | "real")[];
  /** Quem costuma fazer no modo escritório externo. */
  quem: "empresa" | "escritorio";
  /** Parâmetro com o prazo por extenso e a norma. */
  parametro: string;
  observacao?: string;
};
export type Ocorrencia = {
  codigo: string; nome: string; tipo: Obrigacao["tipo"]; quem: Obrigacao["quem"]; competencia: string;
  vencimento: string | null; original: string | null; ajuste: string | null;
  dependeRegime: boolean; aDefinir: boolean; ajusteAConferir: boolean; parametro: string; observacao: string | null;
};

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dataUtc = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia));
const somaDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

export function calendarioUtil(feriados: Iterable<{ data: string; nome: string }>) {
  const mapa = new Map<string, string>();
  for (const f of feriados) mapa.set(f.data, f.nome);
  const util = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !mapa.has(iso(d));
  const porQue = (d: Date) => mapa.get(iso(d)) ?? DIA_SEMANA[d.getUTCDay()];
  const ultimoUtil = (ano: number, mes: number) => { let d = dataUtc(ano, mes + 1, 0); while (!util(d)) d = somaDias(d, -1); return d; };
  const nEsimoUtil = (ano: number, mes: number, n: number) => { let d = dataUtc(ano, mes, 1), k = util(d) ? 1 : 0; while (k < n) { d = somaDias(d, 1); if (util(d)) k++; } return d; };
  return { util, porQue, ultimoUtil, nEsimoUtil };
}

/** Vencimento de uma competência (AAAA-MM; trimestral: o mês que fecha o trimestre; anual: AAAA-12). */
export function vencimento(o: Obrigacao, competencia: string, cal: ReturnType<typeof calendarioUtil>) {
  if (o.dia === "definir") return { vencimento: null, original: null, ajuste: null };
  const [a, m] = competencia.split("-").map(Number);
  const alvo = o.periodicidade === "anual" ? { ano: a + 1, mes: o.mes ?? 12 } : (() => { const t = a * 12 + (m - 1) + (o.meses_depois ?? 1); return { ano: Math.floor(t / 12), mes: (t % 12) + 1 }; })();
  if (o.dia === "ultimo_util") { const d = cal.ultimoUtil(alvo.ano, alvo.mes); return { vencimento: iso(d), original: iso(d), ajuste: null }; }
  if (typeof o.dia === "string") { const d = cal.nEsimoUtil(alvo.ano, alvo.mes, Number(o.dia.slice(5))); return { vencimento: iso(d), original: iso(d), ajuste: null }; }
  const original = dataUtc(alvo.ano, alvo.mes, Math.min(o.dia, new Date(Date.UTC(alvo.ano, alvo.mes, 0)).getUTCDate()));
  if (cal.util(original) || o.ajuste === "mantem" || o.ajuste === "a_conferir") return { vencimento: iso(original), original: iso(original), ajuste: null };
  const passo = o.ajuste === "antecipa" ? -1 : 1;
  let d = original;
  while (!cal.util(d)) d = somaDias(d, passo);
  return { vencimento: iso(d), original: iso(original), ajuste: `${o.ajuste === "antecipa" ? "Antecipado" : "Prorrogado"}: dia ${original.getUTCDate()} cai em ${cal.porQue(original)}` };
}

/** Rótulo da competência: "out/2026", "3º tri/2026", "ano 2025". */
export const rotuloCompetencia = (o: Pick<Obrigacao, "periodicidade">, c: string) =>
  o.periodicidade === "anual" ? `ano ${c.slice(0, 4)}` : o.periodicidade === "trimestral" ? `${Math.ceil(Number(c.slice(5)) / 3)}º tri/${c.slice(0, 4)}` : `${MESES_CURTOS[Number(c.slice(5)) - 1]}/${c.slice(0, 4)}`;

/**
 * As ocorrências com vencimento entre `de` e `ate` (AAAA-MM-DD). As que dependem de dado da empresa ("definir")
 * aparecem uma vez, sem data. Obrigação de outro regime sai; com o regime ainda a definir, fica marcada.
 */
export function ocorrencias(obrigacoes: readonly Obrigacao[], ctx: { feriados: Iterable<{ data: string; nome: string }>; regime: "presumido" | "real" | "a_definir"; de: string; ate: string; ajustesConferidos?: boolean }): Ocorrencia[] {
  const cal = calendarioUtil(ctx.feriados);
  const saida: Ocorrencia[] = [];
  const [ai, mi] = ctx.de.split("-").map(Number);
  const [af, mf] = ctx.ate.split("-").map(Number);
  for (const o of obrigacoes) {
    if (o.regimes && ctx.regime !== "a_definir" && !o.regimes.includes(ctx.regime)) continue;
    const base = { codigo: o.codigo, nome: o.nome, tipo: o.tipo, quem: o.quem, dependeRegime: Boolean(o.regimes) && ctx.regime === "a_definir", ajusteAConferir: o.ajuste === "a_conferir", parametro: o.parametro, observacao: o.observacao ?? null };
    if (o.dia === "definir") { saida.push({ ...base, competencia: "", vencimento: null, original: null, ajuste: null, aDefinir: true }); continue; }
    const competencias: string[] = [];
    if (o.periodicidade === "anual") for (let a = ai - 2; a <= af; a++) competencias.push(`${a}-12`);
    else for (let t = ai * 12 + mi - 1 - 4; t <= af * 12 + mf - 1; t++) {
      const c = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
      if (o.periodicidade === "mensal" || [3, 6, 9, 12].includes((t % 12) + 1)) competencias.push(c);
    }
    for (const c of competencias) {
      const v = vencimento(o, c, cal);
      if (v.vencimento && v.vencimento >= ctx.de && v.vencimento <= ctx.ate) saida.push({ ...base, competencia: rotuloCompetencia(o, c), ...v, aDefinir: false });
    }
  }
  return saida.sort((a, b) => (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999") || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Dias corridos entre hoje e o vencimento (negativo = vencido). */
export const diasAte = (hoje: string, data: string) => Math.round((Date.parse(`${data}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86400_000);

/** O que a função fiscal_calendario_dados devolve. */
export type DadosCalendario = {
  uf: string | null; codigo_municipio: string | null; perfil: { modo: string; regime: string } | null;
  obrigacoes: { escopo: "legal" | "uf" | "municipio"; uf: string | null; valor: { obrigacoes?: Obrigacao[] }; situacao: string; vigente_de: string; vigente_ate: string | null; fonte: { norma?: string } | null }[];
  feriados: { data: string; nome: string }[];
};

/**
 * Monta o calendário da empresa: em cada camada vale a versão vigente na data (a conferida antes do rascunho);
 * a obrigação da UF ou do município com o mesmo código substitui a legal. `aConferir` = alguma camada usada ainda
 * em rascunho (o contador não conferiu).
 */
export function montarCalendario(d: DadosCalendario, periodo: { de: string; ate: string; hoje: string }) {
  const PESO = { legal: 1, uf: 2, municipio: 3 } as const;
  const vigentes = [...d.obrigacoes]
    .filter((r) => r.vigente_de <= periodo.hoje && (!r.vigente_ate || r.vigente_ate >= periodo.hoje))
    .sort((a, b) => PESO[a.escopo] - PESO[b.escopo] || Number(a.situacao === "conferido") - Number(b.situacao === "conferido") || a.vigente_de.localeCompare(b.vigente_de));
  const porCodigo = new Map<string, Obrigacao>();
  const camadas = new Map<string, { situacao: string; norma: string | null }>();
  for (const r of vigentes) {
    camadas.set(r.escopo, { situacao: r.situacao, norma: r.fonte?.norma ?? null });
    for (const o of r.valor.obrigacoes ?? []) porCodigo.set(o.codigo, o);
  }
  const regime = d.perfil?.regime === "presumido" || d.perfil?.regime === "real" ? d.perfil.regime : "a_definir";
  return {
    ocorrencias: ocorrencias([...porCodigo.values()], { feriados: d.feriados, regime, de: periodo.de, ate: periodo.ate }),
    regime, modo: d.perfil?.modo ?? null, uf: d.uf,
    aConferir: [...camadas.values()].some((c) => c.situacao !== "conferido"),
    normas: [...camadas.values()].map((c) => c.norma).filter(Boolean) as string[],
  };
}
