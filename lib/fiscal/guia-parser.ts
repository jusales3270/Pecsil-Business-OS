/**
 * Leitura de guia de imposto (F-09 · Portal do escritório, Entrega B): do texto do PDF saem o tipo
 * (DARF, DCTFWeb, DAS, GARE, FGTS, ISS), o valor, o vencimento, a competência e a linha digitável.
 * Só regra, sem IA. O escritório confere os campos antes de enviar; o valor também é conferido
 * contra o código de barras de arrecadação (que traz o valor dentro dele).
 */

export type TipoGuia = "DARF" | "DCTFWeb" | "DAS" | "GARE" | "FGTS" | "ISS" | "Outra";
export const TIPOS_GUIA: TipoGuia[] = ["DARF", "DCTFWeb", "DAS", "GARE", "FGTS", "ISS", "Outra"];

/** Quem recebe cada guia (vira o "fornecedor" da conta a pagar). */
export const CREDOR_GUIA: Record<TipoGuia, string> = {
  DARF: "Receita Federal (DARF)",
  DCTFWeb: "Receita Federal (DCTFWeb · INSS)",
  DAS: "Simples Nacional (DAS)",
  GARE: "Secretaria da Fazenda (GARE · ICMS)",
  FGTS: "FGTS Digital (Caixa)",
  ISS: "Prefeitura (ISS)",
  Outra: "Guia de recolhimento",
};

export type GuiaLida = { tipo: TipoGuia | null; valor: number | null; vencimento: string | null; competencia: string | null; linhaDigitavel: string | null; valorDoCodigo: number | null; avisos: string[] };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const dataIso = (d: string) => { const [dd, mm, aa] = d.split("/"); return `${aa}-${mm}-${dd}`; };
const reais = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Tipo pela cara do documento (a ordem importa: DCTFWeb e DAS também dizem "Receita Federal"). */
export function tipoDaGuia(texto: string): TipoGuia | null {
  const t = semAcento(texto).toUpperCase();
  if (/FGTS/.test(t)) return "FGTS";
  if (/DCTF\s*WEB|DCTFWEB/.test(t)) return "DCTFWeb";
  if (/SIMPLES NACIONAL|DOCUMENTO DE ARRECADACAO DO SIMPLES|\bDAS\b/.test(t)) return "DAS";
  if (/\bGARE\b|GUIA DE ARRECADACAO ESTADUAL/.test(t)) return "GARE";
  if (/\bISS\b|ISSQN|IMPOSTO SOBRE SERVICOS/.test(t)) return "ISS";
  if (/\bDARF\b|DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS/.test(t)) return "DARF";
  return null;
}

/** Linha digitável de arrecadação (48 dígitos, começa com 8), com ou sem espaços e traços. */
export function linhaDigitavelDe(texto: string): string | null {
  for (const m of texto.matchAll(/8\d{10}[\s.-]*\d(?:[\s.-]*\d{11}[\s.-]*\d){3}/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length === 48) return d;
  }
  return null;
}

/**
 * Valor dentro do código de barras de arrecadação: tira os 4 dígitos verificadores da linha
 * digitável (44 dígitos) e, quando o 3º dígito diz que é valor real (6 ou 8), os dígitos 5 a 15 são
 * o valor em centavos.
 */
export function valorDoCodigo(linha: string | null): number | null {
  if (!linha || linha.length !== 48) return null;
  const barras = [0, 1, 2, 3].map((i) => linha.slice(i * 12, i * 12 + 11)).join("");
  if (barras[2] !== "6" && barras[2] !== "8") return null;
  const centavos = Number(barras.slice(4, 15));
  return Number.isFinite(centavos) && centavos > 0 ? centavos / 100 : null;
}

/** Valor digitado por quem confere: "1.234,56", "1234,56" ou "1234.56" → 1234.56; inválido → NaN. */
export function valorDigitado(s: string): number {
  const t = s.trim().replace(/^R\$\s*/i, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(t)) return NaN;
  // Ponto em grupos de 3 sem vírgula ("1.234") é milhar, não centavo.
  return Number(t.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t);
}

const ROTULO_VALOR = /(?:valor\s+total(?:\s+do\s+documento)?|total\s+a\s+(?:recolher|pagar)|valor\s+a\s+(?:recolher|pagar)|valor\s+do\s+documento|valor\s+cobrado)\D{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
const ROTULO_VENCIMENTO = /(?:data\s+de\s+vencimento|vencimento|pagar\s+(?:este\s+documento\s+)?ate|data\s+limite(?:\s+para\s+pagamento)?|validade\s+para\s+pagamento)\D{0,30}?(\d{2}\/\d{2}\/\d{4})/i;
const ROTULO_COMPETENCIA = /(?:periodo\s+de\s+apuracao|competencia|mes\s+de\s+referencia|referencia)\D{0,20}?(?:(\d{2}\/\d{2}\/\d{4})|(\d{2}\/\d{4}))/i;

export function lerGuia(texto: string): GuiaLida {
  const t = semAcento(texto);
  const avisos: string[] = [];
  const linha = linhaDigitavelDe(texto);
  const doCodigo = valorDoCodigo(linha);
  const v = t.match(ROTULO_VALOR)?.[1];
  let valor = v ? reais(v) : null;
  if (valor === null && doCodigo !== null) valor = doCodigo;
  if (valor !== null && doCodigo !== null && Math.abs(valor - doCodigo) > 0.009) avisos.push(`O valor do texto (R$ ${valor.toFixed(2)}) é diferente do código de barras (R$ ${doCodigo.toFixed(2)}): confira.`);
  const venc = t.match(ROTULO_VENCIMENTO)?.[1];
  const comp = t.match(ROTULO_COMPETENCIA);
  const competencia = comp ? (comp[1] ? dataIso(comp[1]).slice(0, 7) : `${comp[2]!.slice(3)}-${comp[2]!.slice(0, 2)}`) : null;
  if (!linha) avisos.push("Não encontrei a linha digitável: digite ou confira no PDF.");
  if (!venc) avisos.push("Não encontrei o vencimento: digite a data.");
  return { tipo: tipoDaGuia(texto), valor, vencimento: venc ? dataIso(venc) : null, competencia, linhaDigitavel: linha, valorDoCodigo: doCodigo, avisos };
}
