/**
 * Balancete (N-04): as analíticas vêm do banco (contabil_balancete) e as sintéticas somam as filhas pelo código
 * superior. Saldo com sinal: devedor positivo, credor negativo. Confere a integridade (débitos = créditos no
 * período e saldo final somando zero) e a natureza (ativo com saldo credor, passivo/PL com saldo devedor). Puro.
 */
import type { Natureza } from "./ecd";

export type ContaPlano = { id: string; codigo: string; nome: string; natureza: Natureza; tipo: "sintetica" | "analitica"; nivel: number; superior_codigo: string | null };
export type Movimento = { conta_id: string; anterior: number; debitos: number; creditos: number };
export type LinhaBalancete = ContaPlano & { anterior: number; debitos: number; creditos: number; final: number; alerta: string | null };

const c = (v: number) => Math.round(v * 100);
const r = (centavos: number) => centavos / 100;

export function montarBalancete(contas: readonly ContaPlano[], movimentos: readonly Movimento[]) {
  const porId = new Map(contas.map((x) => [x.id, x]));
  const porCodigo = new Map(contas.map((x) => [x.codigo, x]));
  const soma = new Map<string, { a: number; d: number; k: number }>(contas.map((x) => [x.codigo, { a: 0, d: 0, k: 0 }]));
  for (const m of movimentos) {
    let conta = porId.get(m.conta_id);
    const visto = new Set<string>();
    while (conta && !visto.has(conta.codigo)) {
      visto.add(conta.codigo);
      const s = soma.get(conta.codigo)!;
      s.a += c(Number(m.anterior)); s.d += c(Number(m.debitos)); s.k += c(Number(m.creditos));
      conta = conta.superior_codigo ? porCodigo.get(conta.superior_codigo) : undefined;
    }
  }
  const linhas: LinhaBalancete[] = [...contas].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })).map((x) => {
    const s = soma.get(x.codigo)!;
    const final = s.a + s.d - s.k;
    const contraria = x.tipo === "analitica" && ((x.natureza === "ativo" && final < 0) || ((x.natureza === "passivo" || x.natureza === "pl") && final > 0));
    return { ...x, anterior: r(s.a), debitos: r(s.d), creditos: r(s.k), final: r(final), alerta: contraria ? `Saldo ${final < 0 ? "credor" : "devedor"} numa conta de ${x.natureza === "ativo" ? "ativo" : x.natureza === "pl" ? "patrimônio líquido" : "passivo"}.` : null };
  });
  const analiticas = movimentos.reduce((t, m) => ({ d: t.d + c(Number(m.debitos)), k: t.k + c(Number(m.creditos)), f: t.f + c(Number(m.anterior)) + c(Number(m.debitos)) - c(Number(m.creditos)) }), { d: 0, k: 0, f: 0 });
  return {
    linhas,
    totais: { debitos: r(analiticas.d), creditos: r(analiticas.k), saldoFinal: r(analiticas.f) },
    integro: analiticas.d === analiticas.k && analiticas.f === 0,
  };
}
