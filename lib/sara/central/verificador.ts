/**
 * Verificador da SARA central (E7, J1): todo número da resposta final tem de estar no que as SARAs dos
 * módulos devolveram (ou numa conta da ferramenta calcular). É uma etapa da plataforma, não do modelo:
 * o número que não bate é apontado na resposta ("sem fonte conferida"), para ninguém usá-lo como apurado.
 * Datas, horas, anos e números de 1 dígito ficam de fora (não são valores apurados).
 */

/** Um valor lido do texto: o número e como ele apareceu. */
export type Lido = { valor: number; como: string };

const DATA = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const HORA = /\b\d{1,2}[:h]\d{2}\b/g;
const MULTIPLO: Record<string, number> = { mil: 1e3, milhao: 1e6, milhoes: 1e6, milhão: 1e6, milhões: 1e6, bi: 1e9, bilhao: 1e9, bilhão: 1e9, bilhoes: 1e9, bilhões: 1e9 };

/** "1.234,56" → 1234.56; "12,5" → 12.5; "1234" → 1234; "1,2 milhão" → 1200000. */
function paraNumero(bruto: string, multiplo?: string): number | null {
  let t = bruto.replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(t)) t = t.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return multiplo ? n * (MULTIPLO[multiplo.toLowerCase()] ?? 1) : n;
}

/** Números de um texto (valores, quantidades, percentuais), sem datas, horas e anos. */
export function numerosDoTexto(texto: string): Lido[] {
  const limpo = texto.replace(DATA, " ").replace(HORA, " ");
  const saida: Lido[] = [];
  for (const m of limpo.matchAll(/(R\$\s?)?(\d[\d.,]*\d|\d)(?:\s?(mil|milh[aã]o|milh[oõ]es|bi|bilh[aã]o|bilh[oõ]es)\b)?(\s?%)?/gi)) {
    const valor = paraNumero(m[2], m[3]);
    if (valor == null) continue;
    const temMoeda = Boolean(m[1]), pct = Boolean(m[4]);
    // Ano (2020–2035) solto e número de 1 dígito sem moeda/percentual não são valores apurados.
    if (!temMoeda && !pct && Number.isInteger(valor) && valor >= 2000 && valor <= 2035 && !m[2].includes(".") && !m[2].includes(",")) continue;
    if (!temMoeda && !pct && valor < 10 && Number.isInteger(valor)) continue;
    saida.push({ valor, como: m[0].trim() });
  }
  return saida;
}

/** Os números de qualquer estrutura (o que as consultas devolveram), lidos dos textos e dos campos numéricos. */
export function numerosDasFontes(fontes: unknown[]): number[] {
  const nums: number[] = [];
  const visitar = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    else if (typeof v === "string") nums.push(...numerosDoTexto(v).map((x) => x.valor));
    else if (Array.isArray(v)) v.forEach(visitar);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(visitar);
  };
  fontes.forEach(visitar);
  return nums;
}

/** Bate se é o mesmo número, ou o mesmo arredondado (R$ 1,2 milhão de 1.234.567; 12% de 12,4%). */
function bate(valor: number, fonte: number): boolean {
  if (valor === fonte) return true;
  const tol = Math.max(Math.abs(valor), Math.abs(fonte)) * 0.005;
  if (Math.abs(valor - fonte) <= tol) return true;
  // Arredondado na casa que a resposta usou: inteiro, milhar ou milhão, com 0 ou 1 casa decimal
  // (12 de 12,4; 1.235 mil de 1.234.567; 1,2 milhão de 1.234.567).
  for (const unidade of [1, 1e3, 1e6]) {
    if (Math.abs(fonte) < unidade) continue;
    for (const casas of [0, 1]) {
      const f = 10 ** casas;
      if (Math.abs(Math.round((fonte / unidade) * f) / f * unidade - valor) < 1e-6 * Math.max(1, Math.abs(valor))) return true;
    }
  }
  return false;
}

export type Conferencia = { conferidos: number; semFonte: string[] };

/** Confere cada número da resposta com os números das fontes. */
export function conferirNumeros(resposta: string, fontes: unknown[]): Conferencia {
  const base = numerosDasFontes(fontes);
  const lidos = numerosDoTexto(resposta);
  const semFonte = [...new Set(lidos.filter((l) => !base.some((f) => bate(l.valor, f))).map((l) => l.como))];
  return { conferidos: lidos.length - semFonte.length, semFonte };
}

/** A resposta com o aviso dos números que não bateram (no fim, para não quebrar o texto). */
export function marcarSemFonte(resposta: string, c: Conferencia): string {
  if (!c.semFonte.length) return resposta;
  return `${resposta}\n\n⚠️ Sem fonte conferida: ${c.semFonte.slice(0, 8).join(", ")}. Confira antes de usar esse${c.semFonte.length > 1 ? "s números" : " número"}.`;
}
