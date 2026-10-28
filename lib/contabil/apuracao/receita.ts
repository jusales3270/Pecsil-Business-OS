/**
 * Receita bruta do Lucro Presumido a partir das NF-e lidas (N-07), pelo regime de competência (data de emissão). Puro.
 * Pelo CFOP de cada item:
 * - venda e industrialização (x1yy: 5101, 6102, 7101, 5124…) → indústria e comércio; exportação = 7xxx (fora do
 *   PIS/COFINS, dentro do IRPJ/CSLL);
 * - prestação de serviço tributada pelo ISS (x933) → serviços;
 * - devolução de venda recebida (1201, 1202, 2201, 2202, 3201, 3202) → sai da receita do mês;
 * - remessas, retornos, transferências e o resto (x9yy, x5yy, x6yy…) não são receita.
 * Os valores são produto menos desconto: o IPI e o ICMS-ST não entram (são cobrados por fora, do cliente).
 * Se o escritório apura pelo regime de caixa, a base é outra (os recebimentos): a tela avisa até o método ser confirmado.
 */
export type NotaParaReceita = { lado: "entrada" | "saida" | "outra"; competencia: string | null; receita: { porCfop: Record<string, number> } | null };
export type ReceitaMes = { competencia: string; industria: number; servicos: number; exportacao: number; devolucoes: number; notas: number };

const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;
const DEVOLUCAO_VENDA = /^[123]20[12]$/;

export function classificarCfop(cfop: string): "industria" | "servicos" | null {
  if (!/^[567]\d{3}$/.test(cfop)) return null;
  if (cfop.slice(1) === "933") return "servicos";
  return cfop[1] === "1" ? "industria" : null;
}

export function receitaPorMes(notas: readonly NotaParaReceita[]): ReceitaMes[] {
  const meses = new Map<string, ReceitaMes>();
  const mes = (c: string) => meses.get(c) ?? meses.set(c, { competencia: c, industria: 0, servicos: 0, exportacao: 0, devolucoes: 0, notas: 0 }).get(c)!;
  for (const n of notas) {
    if (!n.competencia || !n.receita) continue;
    const cfops = Object.entries(n.receita.porCfop);
    if (n.lado === "saida") {
      let conta = false;
      for (const [cfop, valor] of cfops) {
        const grupo = classificarCfop(cfop);
        if (!grupo) continue;
        const m = mes(n.competencia);
        m[grupo] += valor;
        if (cfop.startsWith("7")) m.exportacao += valor;
        conta = true;
      }
      if (conta) mes(n.competencia).notas++;
    } else if (n.lado === "entrada") {
      const dev = cfops.filter(([cfop]) => DEVOLUCAO_VENDA.test(cfop)).reduce((s, [, v]) => s + v, 0);
      if (dev) mes(n.competencia).devolucoes += dev;
    }
  }
  return [...meses.values()].sort((a, b) => a.competencia.localeCompare(b.competencia))
    .map((m) => ({ ...m, industria: r2(m.industria), servicos: r2(m.servicos), exportacao: r2(m.exportacao), devolucoes: r2(m.devolucoes) }));
}
