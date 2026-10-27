/**
 * DRE e Balanço (N-05 adiantado), no formato do escritório: saem do plano de contas e dos lançamentos, sem layout
 * à parte. Puro.
 * - DRE: movimento das contas de resultado no período SEM o encerramento (contabil_movimento). Mostra o 1º nível
 *   (RECEITA, CUSTOS, DESPESAS…), o grupo logo acima das contas e cada conta com valor, como a ECD (J150). Valor com
 *   sinal: crédito positivo (receita), débito negativo (custo, despesa). O fim é o lucro ou o prejuízo.
 * - Balanço: saldo das contas patrimoniais na data, em todos os níveis (J100). O resultado ainda não encerrado
 *   (o do período em curso) entra no patrimônio líquido, para o ativo fechar com passivo + PL.
 */
import type { ContaPlano } from "./balancete";

export type Movimento = { conta_id: string; debitos: number; creditos: number };
export type Saldo = { conta_id: string; anterior: number; debitos: number; creditos: number };
export type LinhaDemonstracao = { codigo: string; nome: string; nivel: number; tipo: "grupo" | "conta" | "total"; valor: number };

const c = (v: number) => Math.round(Number(v) * 100);
const ordem = (a: { codigo: string }, b: { codigo: string }) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });

/** Soma cada conta analítica nos superiores (pelo código superior). */
function somarNaArvore(contas: readonly ContaPlano[], valorDe: Map<string, number>) {
  const porCodigo = new Map(contas.map((x) => [x.codigo, x]));
  const soma = new Map<string, number>();
  for (const x of contas) {
    if (x.tipo !== "analitica") continue;
    const v = valorDe.get(x.id) ?? 0;
    if (!v) continue;
    let atual: ContaPlano | undefined = x;
    const visto = new Set<string>();
    while (atual && !visto.has(atual.codigo)) {
      visto.add(atual.codigo);
      soma.set(atual.codigo, (soma.get(atual.codigo) ?? 0) + v);
      atual = atual.superior_codigo ? porCodigo.get(atual.superior_codigo) : undefined;
    }
  }
  return soma;
}

export function montarDre(contas: readonly ContaPlano[], movimentos: readonly Movimento[]) {
  const resultado = contas.filter((x) => x.natureza === "resultado");
  const ids = new Set(resultado.map((x) => x.id));
  const valor = new Map(movimentos.filter((m) => ids.has(m.conta_id)).map((m) => [m.conta_id, c(m.creditos) - c(m.debitos)]));
  const soma = somarNaArvore(resultado, valor);
  // O grupo que aparece é o logo acima das contas (o 4º nível no plano do escritório) e o 1º nível.
  const superioresDeConta = new Set(resultado.filter((x) => x.tipo === "analitica").map((x) => x.superior_codigo).filter(Boolean) as string[]);
  const linhas: LinhaDemonstracao[] = [...resultado].sort(ordem).flatMap<LinhaDemonstracao>((x) => {
    const v = soma.get(x.codigo) ?? 0;
    if (x.tipo === "analitica") return v ? [{ codigo: x.codigo, nome: x.nome, nivel: x.nivel, tipo: "conta" as const, valor: v / 100 }] : [];
    if (x.nivel === 1 || (superioresDeConta.has(x.codigo) && v)) return [{ codigo: x.codigo, nome: x.nome, nivel: x.nivel, tipo: "grupo" as const, valor: v / 100 }];
    return [];
  }).filter((l, k, todas) => l.tipo !== "grupo" || l.nivel !== 1 || l.valor !== 0 || todas.some((o) => o.codigo !== l.codigo && o.codigo.startsWith(l.codigo.split(".")[0] + ".")));
  const liquido = resultado.filter((x) => x.tipo === "analitica").reduce((s, x) => s + (valor.get(x.id) ?? 0), 0);
  linhas.push({ codigo: "", nome: liquido >= 0 ? "= Lucro" : "= Prejuízo", nivel: 0, tipo: "total", valor: liquido / 100 });
  return { linhas, resultado: liquido / 100 };
}

export function montarBalanco(contas: readonly ContaPlano[], saldos: readonly Saldo[]) {
  const final = new Map(saldos.map((s) => [s.conta_id, c(s.anterior) + c(s.debitos) - c(s.creditos)]));
  const patrimoniais = contas.filter((x) => x.natureza === "ativo" || x.natureza === "passivo" || x.natureza === "pl");
  const soma = somarNaArvore(patrimoniais, final);
  const linhas: LinhaDemonstracao[] = [...patrimoniais].sort(ordem).flatMap<LinhaDemonstracao>((x) => {
    const v = soma.get(x.codigo) ?? 0;
    return v ? [{ codigo: x.codigo, nome: x.nome, nivel: x.nivel, tipo: x.tipo === "analitica" ? "conta" as const : "grupo" as const, valor: v / 100 }] : [];
  });
  // Resultado ainda não encerrado (saldo das contas de resultado na data): com sinal de crédito, vai para o PL.
  const naoEncerrado = -contas.filter((x) => x.natureza === "resultado" && x.tipo === "analitica").reduce((s, x) => s + (final.get(x.id) ?? 0), 0);
  const ativo = patrimoniais.filter((x) => x.tipo === "analitica" && x.natureza === "ativo").reduce((s, x) => s + (final.get(x.id) ?? 0), 0);
  const passivoPl = -patrimoniais.filter((x) => x.tipo === "analitica" && x.natureza !== "ativo").reduce((s, x) => s + (final.get(x.id) ?? 0), 0) + naoEncerrado;
  return { linhas, ativo: ativo / 100, passivoPl: passivoPl / 100, resultadoNaoEncerrado: naoEncerrado / 100, fecha: ativo === passivoPl };
}
