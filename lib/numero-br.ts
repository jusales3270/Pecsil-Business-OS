/**
 * Número digitado no formato brasileiro: "1.234,56", "1.200" (mil e duzentos), "120,5", "120.5".
 * Com vírgula, a vírgula é o decimal e os pontos são de milhar. Sem vírgula, pontos em grupos de
 * três ("1.200", "1.000.000") são de milhar; senão, o ponto é o decimal ("120.5").
 * Vazio ou inválido devolve `padrao`.
 */
export function lerNumeroBr(v: unknown, padrao = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : padrao;
  const s = String(v ?? "").trim().replace(/[R$\s%]/g, "");
  if (!s) return padrao;
  let limpo: string;
  if (s.includes(",")) limpo = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) limpo = s.replace(/\./g, "");
  else limpo = s;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : padrao;
}
