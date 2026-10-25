/**
 * INSS do empregado e IRRF mensal, a partir dos parâmetros vigentes (nunca de números fixos no
 * código). Funções puras com memória de cálculo: cada passo diz o valor e de qual parâmetro veio.
 * Na Pecsil a folha fica com o escritório; aqui servem para conferir e para a SARA explicar.
 */
import { exigir, type Excecao, type Parametro, type Vigencia } from "./parametros";

export type Passo = { passo: string; valor: number; chave?: string };
export type Resultado<T> = { resultado: T; memoria: Passo[]; usados: Vigencia[]; aConferir: Vigencia[] };

type FaixaInss = { ate: number; aliquota: number };
type TabelaInss = { faixas: FaixaInss[]; teto_salario_contribuicao: number };
type FaixaIrrf = { ate: number | null; aliquota: number; deduzir: number };
type TabelaIrrf = { faixas: FaixaIrrf[]; deducao_dependente: number; desconto_simplificado_mensal: number };
type ReducaoIrrf = { isencao_ate: number; reducao_maxima: number; parcial_ate: number; parcial_constante: number; parcial_coeficiente: number };

/** Arredonda ao centavo (meio para cima) sem o erro do ponto flutuante: 121,575 vira 121,58. */
const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;
const fechar = <T>(resultado: T, memoria: Passo[], usados: Vigencia[]): Resultado<T> => ({ resultado, memoria, usados, aConferir: usados.filter((u) => u.aConferir) });

/** INSS do segurado, progressivo por faixa, limitado ao teto. */
export function inssSegurado(parametros: readonly Parametro[], data: string, salarioContribuicao: number, excecoes: readonly Excecao[] = []): Resultado<{ inss: number; aliquotaEfetiva: number }> {
  const t = exigir<TabelaInss>(parametros, "inss_segurado_tabela", data, {}, excecoes);
  const base = Math.min(Math.max(0, salarioContribuicao), t.valor.teto_salario_contribuicao);
  const memoria: Passo[] = [{ passo: "Base de contribuição (limitada ao teto)", valor: r2(base), chave: t.chave }];
  let anterior = 0;
  let total = 0;
  for (const f of t.valor.faixas) {
    if (base <= anterior) break;
    const parcela = (Math.min(base, f.ate) - anterior) * f.aliquota;
    memoria.push({ passo: `${(f.aliquota * 100).toLocaleString("pt-BR")}% sobre a faixa até R$ ${f.ate.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, valor: r2(parcela), chave: t.chave });
    total += parcela;
    anterior = f.ate;
  }
  const inss = r2(total);
  memoria.push({ passo: "INSS do segurado", valor: inss });
  return fechar({ inss, aliquotaEfetiva: base ? inss / base : 0 }, memoria, [t]);
}

function impostoDaTabela(tabela: TabelaIrrf, base: number) {
  const faixa = tabela.faixas.find((f) => f.ate === null || base <= f.ate) ?? tabela.faixas[tabela.faixas.length - 1];
  return { faixa, imposto: Math.max(0, base * faixa.aliquota - faixa.deduzir) };
}

/**
 * IRRF mensal da fonte pagadora. Compara as deduções legais (INSS, dependentes, pensão) com o
 * desconto simplificado e usa o que der menos imposto; depois aplica a redução da Lei 15.270/2025
 * sobre o rendimento tributável bruto, limitada ao imposto.
 */
export function irrfMensal(
  parametros: readonly Parametro[],
  data: string,
  entrada: { rendimentoTributavel: number; inss: number; dependentes?: number; pensao?: number },
  excecoes: readonly Excecao[] = [],
): Resultado<{ imposto: number; impostoDaTabela: number; reducao: number; base: number; modelo: "deducoes" | "simplificado" }> {
  const t = exigir<TabelaIrrf>(parametros, "irrf_tabela_mensal", data, {}, excecoes);
  const red = parametros.some((p) => p.chave === "irrf_reducao_lei_15270") ? exigirSeVigente<ReducaoIrrf>(parametros, "irrf_reducao_lei_15270", data, excecoes) : null;
  const rendimento = Math.max(0, entrada.rendimentoTributavel);
  const deducoes = entrada.inss + (entrada.dependentes ?? 0) * t.valor.deducao_dependente + (entrada.pensao ?? 0);
  const simplificado = t.valor.desconto_simplificado_mensal;
  const porDeducoes = impostoDaTabela(t.valor, Math.max(0, rendimento - deducoes));
  const porSimplificado = impostoDaTabela(t.valor, Math.max(0, rendimento - simplificado));
  const modelo = porSimplificado.imposto < porDeducoes.imposto ? "simplificado" : "deducoes";
  const escolhido = modelo === "simplificado" ? porSimplificado : porDeducoes;
  const base = Math.max(0, rendimento - (modelo === "simplificado" ? simplificado : deducoes));
  const memoria: Passo[] = [
    { passo: "Rendimento tributável", valor: r2(rendimento) },
    { passo: modelo === "simplificado" ? "Desconto simplificado (menor imposto)" : "Deduções legais: INSS, dependentes e pensão (menor imposto)", valor: r2(modelo === "simplificado" ? simplificado : deducoes), chave: t.chave },
    { passo: "Base de cálculo", valor: r2(base) },
    { passo: `Tabela: ${(escolhido.faixa.aliquota * 100).toLocaleString("pt-BR")}% menos R$ ${escolhido.faixa.deduzir.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, valor: r2(escolhido.imposto), chave: t.chave },
  ];
  let reducao = 0;
  if (red) {
    const v = red.valor;
    const bruta = rendimento <= v.isencao_ate ? v.reducao_maxima : rendimento <= v.parcial_ate ? v.parcial_constante - v.parcial_coeficiente * rendimento : 0;
    reducao = Math.min(Math.max(0, bruta), escolhido.imposto);
    memoria.push({ passo: "Redução da Lei 15.270/2025 (limitada ao imposto)", valor: -r2(reducao), chave: red.chave });
  }
  const imposto = r2(Math.max(0, escolhido.imposto - reducao));
  memoria.push({ passo: "IRRF a reter", valor: imposto });
  return fechar({ imposto, impostoDaTabela: r2(escolhido.imposto), reducao: r2(reducao), base: r2(base), modelo }, memoria, red ? [t, red] : [t]);
}

/** A redução só existe a partir de 2026: antes da vigência, não há o que aplicar. */
function exigirSeVigente<T>(parametros: readonly Parametro[], chave: string, data: string, excecoes: readonly Excecao[]) {
  try { return exigir<T>(parametros, chave, data, {}, excecoes); } catch { return null; }
}
