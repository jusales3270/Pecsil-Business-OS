/**
 * Conferência da guia contra a apuração (N-07): a guia que o escritório devolve (ou que a empresa envia pelo portal)
 * tem o código da receita, o período e o valor; a plataforma diz se confere e, se não, de onde parece vir a diferença.
 * Puro. Os códigos e o que cada um paga vêm do parâmetro `codigos_darf`.
 */
export type GuiaParaConferir = { valor: number; codigo: string | null; periodo: string | null; vencimento: string | null };
export type Esperado = { valor: number; vencimento?: string | null; alternativas?: { rotulo: string; valor: number }[] };
export type Conferencia = { situacao: "confere" | "diverge" | "sem_base" | "sem_codigo"; tributo: string | null; esperado: number | null; diferenca: number | null; motivos: string[] };

const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;
const money = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** O tributo pela descrição do código nos parâmetros: "IRPJ lucro presumido" → IRPJ. */
export function tributoDoCodigo(codigos: Record<string, string> | null | undefined, codigo: string | null): string | null {
  const d = codigo ? codigos?.[codigo] : null;
  return d ? (d.trim().split(/\s+/)[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "") || null : null;
}

/**
 * `esperado`: o que a apuração diz para o tributo e o período da guia (nulo se o período ainda não tem base completa).
 * `regime`: o do perfil; código de outro regime é divergência mesmo sem base.
 */
export function conferirGuia(guia: GuiaParaConferir, codigos: Record<string, string> | null | undefined, regime: string, esperado: Esperado | null): Conferencia {
  const tributo = tributoDoCodigo(codigos, guia.codigo);
  if (!guia.codigo || !tributo) return { situacao: "sem_codigo", tributo, esperado: null, diferenca: null, motivos: ["A guia não tem o código da receita: classifique para conferir."] };
  const motivos: string[] = [];
  const descricao = (codigos?.[guia.codigo] ?? "").toLowerCase();
  const doReal = /lucro real|estimativa|ajuste anual|não cumulativ/.test(descricao);
  const doPresumido = /lucro presumido/.test(descricao) || (/cumulativ/.test(descricao) && !/não cumulativ/.test(descricao));
  if ((regime === "presumido" && doReal) || (regime === "real" && doPresumido)) motivos.push(`O código ${guia.codigo} (${codigos?.[guia.codigo]}) é de outro regime: a empresa é Lucro ${regime === "presumido" ? "Presumido" : "Real"}.`);
  if (!esperado) return { situacao: motivos.length ? "diverge" : "sem_base", tributo, esperado: null, diferenca: null, motivos: [...motivos, "A apuração deste período ainda não tem base completa (faltam as notas de saída do período)."] };
  const diferenca = r2(guia.valor - esperado.valor);
  if (Math.abs(diferenca) > 0.01) {
    motivos.push(`A guia diz ${money(guia.valor)}; a apuração, ${money(esperado.valor)} (diferença de ${money(Math.abs(diferenca))} ${diferenca > 0 ? "a mais" : "a menos"}).`);
    const parecida = (esperado.alternativas ?? []).find((a) => Math.abs(a.valor - guia.valor) <= 0.01);
    if (parecida) motivos.push(`O valor da guia bate com a apuração ${parecida.rotulo}.`);
  }
  if (esperado.vencimento && guia.vencimento && guia.vencimento !== esperado.vencimento) motivos.push(`Vencimento da guia em ${guia.vencimento.split("-").reverse().join("/")}; o calendário diz ${esperado.vencimento.split("-").reverse().join("/")}.`);
  return { situacao: motivos.length ? "diverge" : "confere", tributo, esperado: esperado.valor, diferenca, motivos };
}
