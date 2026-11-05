/**
 * Peso das peças pelo STEP do cliente (ROADMAP C-19). O medidor 3D (services/medidor-3d) devolve cada
 * corpo com volume, área das pontas e das demais faces; aqui a plataforma:
 *   1. sugere o tipo de cada corpo (Forma, Bloco, Fundo, Platô, Funil; a garrafa, a pré-forma e a
 *      ferragem ficam fora do peso). O Rafael corrige o que vier errado;
 *   2. calcula o peso acabado (volume × densidade) e o bruto, com o sobremetal seguindo o contorno:
 *      as pontas (faces planas perpendiculares ao eixo) crescem metade do sobremetal do comprimento e as
 *      demais faces metade do sobremetal do diâmetro (regra do Rafael, 05/11: 2 mm no Ø e 4 mm no
 *      comprimento, só em Fundo e Platô; nas demais só em Bronze — fica em tabela, não aqui).
 * Conferência do método num cilindro de resposta exata (Ø197 × 112): −0,08% no bruto.
 */

export type Vetor = [number, number, number];
export type CorpoMedido = {
  nome: string;
  componente: string | null;
  ocorrencias: number;
  fechado: boolean;
  volume_mm3: number;
  volume_negativo?: boolean;
  area_mm2: number;
  bbox: { min: Vetor; max: Vetor } | null;
  centro?: Vetor | null;
  faces?: number;
  eixo: Vetor | null;
  area_pontas_mm2: number;
  area_demais_mm2: number;
};

export const TIPOS_PECA = ["forma", "bloco", "fundo", "plato", "funil", "outro", "garrafa", "ferragem"] as const;
export type TipoPeca = (typeof TIPOS_PECA)[number];
export const ROTULO_TIPO: Record<TipoPeca, string> = {
  forma: "Forma", bloco: "Bloco", fundo: "Fundo", plato: "Platô", funil: "Funil", outro: "Outra peça",
  garrafa: "Garrafa ou pré-forma (fora do peso)", ferragem: "Ferragem (fora do peso)",
};
/** Tipos que pesam no orçamento (os outros dois ficam de fora). */
export const ehPeca = (t: TipoPeca) => t !== "garrafa" && t !== "ferragem";

export type Liga = { id: string; nome: string; densidade_g_cm3: number; padrao?: boolean };
export type RegraSobremetal = { tipo_peca: string; liga_id: string | null; mm_diametro: number; mm_comprimento: number };

/** Abaixo disso (cm³) é parafuso, pino, chaveta solta. */
const VOLUME_FERRAGEM_CM3 = 30;

const PADROES: { tipo: TipoPeca; re: RegExp }[] = [
  { tipo: "ferragem", re: /screw|parafuso|\bdin\b|\biso\s?\d|\bpino\b|_pino\b|porca|arruela|washer|\bnut\b|bolt|mola|spring/i },
  { tipo: "garrafa", re: /garrafa|bottle|parison|pr[eé][-_ ]?forma|\bdg-\d/i },
  { tipo: "funil", re: /funnel|funil/i },
  { tipo: "plato", re: /baffle|plat[oô]/i },
  { tipo: "fundo", re: /^bp\b|^bp[_ -]|bottom|fundo/i },
  { tipo: "bloco", re: /blank|bloco/i },
  { tipo: "forma", re: /blow|forma\b|mould|mold\b/i },
];

const dentro = (a: CorpoMedido["bbox"], b: CorpoMedido["bbox"], tol = 0.5) =>
  Boolean(a && b) && [0, 1, 2].every((i) => a!.min[i] >= b!.min[i] - tol && a!.max[i] <= b!.max[i] + tol);

const uniao = (bs: CorpoMedido["bbox"][]): CorpoMedido["bbox"] => {
  const v = bs.filter(Boolean) as { min: Vetor; max: Vetor }[];
  if (!v.length) return null;
  return { min: [0, 1, 2].map((i) => Math.min(...v.map((b) => b.min[i]))) as Vetor, max: [0, 1, 2].map((i) => Math.max(...v.map((b) => b.max[i]))) as Vetor };
};

/** Sugestão de tipo para cada corpo, com o motivo (mostrado ao Rafael). */
export function classificar(corpos: CorpoMedido[]): Map<string, { tipo: TipoPeca; motivo: string }> {
  const r = new Map<string, { tipo: TipoPeca; motivo: string }>();
  const peloNome = new Map(corpos.map((c) => [c.nome, PADROES.find((p) => p.re.test(c.componente || c.nome) || p.re.test(c.nome)) ?? null]));
  // Onde a garrafa ou a pré-forma se esconde: dentro de um corpo maior ou entre as metades da Forma ou do Bloco.
  const hospedeiros: { nome: string; volume: number; bbox: CorpoMedido["bbox"] }[] = corpos.map((o) => ({ nome: o.componente || o.nome, volume: o.volume_mm3, bbox: o.bbox }));
  for (const t of ["forma", "bloco"] as const) {
    const metades = corpos.filter((o) => peloNome.get(o.nome)?.tipo === t);
    if (metades.length >= 2) hospedeiros.push({ nome: ROTULO_TIPO[t], volume: metades.reduce((a, o) => a + o.volume_mm3, 0), bbox: uniao(metades.map((o) => o.bbox)) });
  }
  for (const c of corpos) {
    const nome = c.componente || c.nome;
    const pelo = peloNome.get(c.nome);
    const cm3 = c.volume_mm3 / 1000;
    if (pelo?.tipo === "ferragem" || (pelo?.tipo === "garrafa")) { r.set(c.nome, { tipo: pelo.tipo, motivo: `pelo nome "${nome}"` }); continue; }
    // Corpo inteiro dentro de outro maior, sem nome de peça: a garrafa ou a pré-forma no lugar da cavidade.
    const hospedeiro = hospedeiros.find((o) => o.bbox !== c.bbox && o.volume > c.volume_mm3 && dentro(c.bbox, o.bbox));
    if (hospedeiro && !pelo) { r.set(c.nome, { tipo: "garrafa", motivo: `fica dentro de ${hospedeiro.nome}` }); continue; }
    if (cm3 < VOLUME_FERRAGEM_CM3 && !pelo) { r.set(c.nome, { tipo: "ferragem", motivo: `pequeno (${cm3.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} cm³)` }); continue; }
    if (pelo) { r.set(c.nome, { tipo: pelo.tipo, motivo: `pelo nome "${nome}"` }); continue; }
    r.set(c.nome, { tipo: "outro", motivo: "sem nome conhecido: confira" });
  }
  return r;
}

/** Regra da liga específica, senão a geral do tipo; sem regra, sem sobremetal. */
export function regraDe(regras: RegraSobremetal[], tipo: TipoPeca, ligaId: string | null): RegraSobremetal | null {
  return regras.find((x) => x.tipo_peca === tipo && x.liga_id && x.liga_id === ligaId)
    ?? regras.find((x) => x.tipo_peca === tipo && !x.liga_id) ?? null;
}

/** Volume do bruto (mm³) seguindo o contorno: pontas + metade do sobremetal do comprimento, resto + metade do do diâmetro. */
export function volumeBruto(c: Pick<CorpoMedido, "volume_mm3" | "area_pontas_mm2" | "area_demais_mm2" | "eixo">, mmDiametro: number, mmComprimento: number): number {
  const pontas = c.eixo ? c.area_pontas_mm2 : 0;
  const demais = c.eixo ? c.area_demais_mm2 : c.area_pontas_mm2 + c.area_demais_mm2;
  return c.volume_mm3 + (mmComprimento / 2) * pontas + (mmDiametro / 2) * demais;
}

export type Pesagem = {
  acabado_kg: number;
  bruto_kg: number;
  sobremetal: { mm_diametro: number; mm_comprimento: number } | null;
};

export function pesar(c: CorpoMedido, tipo: TipoPeca, liga: Liga | null, regras: RegraSobremetal[]): Pesagem | null {
  if (!liga || !ehPeca(tipo)) return null;
  const kg = (mm3: number) => Math.round(mm3 * liga.densidade_g_cm3 * 1e-3) / 1000;
  const regra = regraDe(regras, tipo, liga.id);
  const sobra = regra && (regra.mm_diametro > 0 || regra.mm_comprimento > 0) ? { mm_diametro: Number(regra.mm_diametro), mm_comprimento: Number(regra.mm_comprimento) } : null;
  return {
    acabado_kg: kg(c.volume_mm3),
    bruto_kg: kg(sobra ? volumeBruto(c, sobra.mm_diametro, sobra.mm_comprimento) : c.volume_mm3),
    sobremetal: sobra,
  };
}

/** Diâmetro e comprimento pelo eixo (quando o eixo é X, Y ou Z); senão as três medidas externas. */
export function medidas(c: Pick<CorpoMedido, "bbox" | "eixo">): { diametro: number; comprimento: number } | { lados: Vetor } | null {
  if (!c.bbox) return null;
  const d = [0, 1, 2].map((i) => c.bbox!.max[i] - c.bbox!.min[i]) as Vetor;
  const k = c.eixo ? c.eixo.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-6) : -1;
  if (k < 0) return { lados: d };
  return { comprimento: d[k], diametro: Math.max(...d.filter((_, i) => i !== k)) };
}

export type LinhaPeca = { corpo: CorpoMedido; tipo: TipoPeca; motivo: string; ajustado: boolean; liga: Liga | null; peso: Pesagem | null };

/** Linhas da tela: tipo sugerido ou o que o Rafael escolheu, liga da linha ou a da medição. */
export function linhas(
  corpos: CorpoMedido[],
  ajustes: Record<string, { tipo?: string; liga_id?: string | null }>,
  ligas: Liga[],
  ligaDaMedicao: string | null,
  regras: RegraSobremetal[],
): LinhaPeca[] {
  const sugestao = classificar(corpos);
  const padrao = ligas.find((l) => l.id === ligaDaMedicao) ?? ligas.find((l) => l.padrao) ?? ligas[0] ?? null;
  return [...corpos]
    .sort((a, b) => b.volume_mm3 - a.volume_mm3)
    .map((corpo) => {
      const a = ajustes[corpo.nome] ?? {};
      const tipo = (TIPOS_PECA as readonly string[]).includes(a.tipo ?? "") ? (a.tipo as TipoPeca) : sugestao.get(corpo.nome)!.tipo;
      const liga = (a.liga_id && ligas.find((l) => l.id === a.liga_id)) || padrao;
      return { corpo, tipo, motivo: a.tipo ? "escolhido no orçamento" : sugestao.get(corpo.nome)!.motivo, ajustado: Boolean(a.tipo), liga, peso: pesar(corpo, tipo, liga, regras) };
    });
}

/** Soma por tipo (as duas metades da Forma viram uma Forma). Conta cada corpo uma vez, não as ocorrências. */
export function resumoPorTipo(ls: LinhaPeca[]): { tipo: TipoPeca; corpos: number; acabado_kg: number; bruto_kg: number }[] {
  const m = new Map<TipoPeca, { tipo: TipoPeca; corpos: number; acabado_kg: number; bruto_kg: number }>();
  for (const l of ls) {
    if (!l.peso) continue;
    const t = m.get(l.tipo) ?? { tipo: l.tipo, corpos: 0, acabado_kg: 0, bruto_kg: 0 };
    t.corpos += 1;
    t.acabado_kg = Math.round((t.acabado_kg + l.peso.acabado_kg) * 1000) / 1000;
    t.bruto_kg = Math.round((t.bruto_kg + l.peso.bruto_kg) * 1000) / 1000;
    m.set(l.tipo, t);
  }
  const ordem: TipoPeca[] = ["forma", "fundo", "bloco", "plato", "funil", "outro"];
  return [...m.values()].sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo));
}
