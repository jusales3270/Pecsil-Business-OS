/**
 * Balancete (N-04): as analíticas vêm do banco (contabil_balancete) e as sintéticas somam as filhas pelo código
 * superior. Saldo com sinal: devedor positivo, credor negativo. Confere a integridade (débitos = créditos no
 * período e saldo final somando zero) e a natureza: saldo do lado contrário ao saldo normal da conta (D/C do plano)
 * ou, sem ele, ativo com saldo credor e passivo/PL com saldo devedor. Resultado não alerta. Puro.
 */
import type { Natureza } from "./ecd";
import type { Lado } from "./regras";

export type ContaPlano = { id: string; codigo: string; nome: string; natureza: Natureza; tipo: "sintetica" | "analitica"; nivel: number; superior_codigo: string | null; saldo_normal?: Lado | null };
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
    const patrimonial = x.natureza === "ativo" || x.natureza === "passivo" || x.natureza === "pl";
    const normal: Lado = x.saldo_normal ?? (x.natureza === "ativo" ? "D" : "C");
    const contraria = x.tipo === "analitica" && patrimonial && ((normal === "D" && final < 0) || (normal === "C" && final > 0));
    const grupo = x.natureza === "ativo" ? "ativo" : x.natureza === "pl" ? "patrimônio líquido" : "passivo";
    const alerta = !contraria ? null : x.saldo_normal ? `Saldo ${final < 0 ? "credor" : "devedor"} numa conta de saldo ${normal === "D" ? "devedor" : "credor"}.` : `Saldo ${final < 0 ? "credor" : "devedor"} numa conta de ${grupo}.`;
    return { ...x, anterior: r(s.a), debitos: r(s.d), creditos: r(s.k), final: r(final), alerta };
  });
  const analiticas = movimentos.reduce((t, m) => ({ d: t.d + c(Number(m.debitos)), k: t.k + c(Number(m.creditos)), f: t.f + c(Number(m.anterior)) + c(Number(m.debitos)) - c(Number(m.creditos)) }), { d: 0, k: 0, f: 0 });
  return {
    linhas,
    totais: { debitos: r(analiticas.d), creditos: r(analiticas.k), saldoFinal: r(analiticas.f) },
    integro: analiticas.d === analiticas.k && analiticas.f === 0,
  };
}
