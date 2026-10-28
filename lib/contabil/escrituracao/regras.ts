/**
 * Escrituração por regra (N-04): um evento do Financeiro (título lançado, baixa) vira partidas de débito e crédito
 * pela regra do evento, que é dado com vigência (tabela contabil_regras). Puro: recebe o evento, a regra e os
 * vínculos (de-para) e devolve as partidas, ou o motivo de não lançar. Sem modelo: escrituração é regra.
 * Desenho em docs/PLANO-CONTABIL-FISCAL.md §3.5.
 */

export type Lado = "D" | "C";
export type EventoTipo = "titulo_pagar" | "titulo_receber" | "baixa_pagar" | "baixa_receber";
/** De onde vem a conta: o rateio do título, o banco da baixa ou um papel (contas_a_pagar, juros_pagos…). */
export type RefConta = "alocacao" | "banco" | `papel:${string}`;
export type RefValor = "valor" | "alocacao" | "principal" | "juros" | "multa" | "desconto" | "caixa";
export type ModeloPartida = { lado: Lado; conta: RefConta; valor: RefValor };
export type Regra = { id: string; organization_id: string | null; evento: EventoTipo; descricao: string; partidas: ModeloPartida[]; vigente_de: string; vigente_ate: string | null };

export type Alocacao = { contaGerencial: string; valor: number };
export type Evento = {
  tipo: EventoTipo;
  origemTipo: "titulo" | "baixa";
  origemId: string;
  data: string; // AAAA-MM-DD
  historico: string;
  valores: { valor: number; principal: number; juros: number; multa: number; desconto: number; caixa: number };
  alocacoes: Alocacao[];
  /** Conta bancária da baixa (ou achada pela conciliação); nula quando ninguém informou. */
  contaBancaria: string | null;
  centroCusto: string | null;
  /** Fornecedor (a pagar) ou cliente (a receber) do título: o escritório pode ter uma conta para cada um. */
  contraparte?: { tipo: "fornecedor" | "cliente"; id: string; nome: string } | null;
};

/** De-para: conta gerencial, conta bancária, papel, fornecedor e cliente → id da conta contábil analítica. */
export type Vinculos = { gerencial: Map<string, string>; bancaria: Map<string, string>; papel: Map<string, string>; fornecedor?: Map<string, string>; cliente?: Map<string, string> };
export type Partida = { conta_id: string; lado: Lado; valor: number; centro_custo_id: string | null };
export type Pendencia = { motivo: "sem_regra" | "sem_vinculo_gerencial" | "sem_vinculo_bancario" | "sem_banco" | "sem_vinculo_papel" | "sem_vinculo_contraparte" | "sem_rateio" | "desequilibrado" | "valor_zero" | "periodo_fechado"; detalhe: string };

export const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;
const centavos = (v: number) => Math.round(v * 100);

/** A regra do evento na data: a da empresa vale mais que a padrão da plataforma; a vigência mais recente primeiro. */
export function regraNaData(regras: readonly Regra[], evento: EventoTipo, data: string): Regra | null {
  return regras
    .filter((r) => r.evento === evento && r.vigente_de <= data && (!r.vigente_ate || data <= r.vigente_ate))
    .sort((a, b) => Number(Boolean(b.organization_id)) - Number(Boolean(a.organization_id)) || b.vigente_de.localeCompare(a.vigente_de))[0] ?? null;
}

/**
 * Aplica a regra. Partida de valor zero sai (juros, multa e desconto quase sempre são zero). Toda conta tem de
 * ter vínculo: nada vai para conta adivinhada. Contas a pagar e a receber vão para a conta do fornecedor ou do
 * cliente quando ele tem vínculo; sem ele, para a conta do papel, se a área escolheu uma. No fim, débitos =
 * créditos ao centavo, senão é pendência.
 */
export function aplicarRegra(evento: Evento, regra: Regra, v: Vinculos): { partidas: Partida[] } | { pendencia: Pendencia } {
  const partidas: Partida[] = [];
  for (const m of regra.partidas) {
    if (m.conta === "alocacao") {
      if (!evento.alocacoes.length) return { pendencia: { motivo: "sem_rateio", detalhe: "O título não tem conta gerencial." } };
      for (const a of evento.alocacoes) {
        const conta = v.gerencial.get(a.contaGerencial);
        if (!conta) return { pendencia: { motivo: "sem_vinculo_gerencial", detalhe: a.contaGerencial } };
        const valor = r2(m.valor === "alocacao" ? a.valor : evento.valores[m.valor]);
        if (valor > 0) partidas.push({ conta_id: conta, lado: m.lado, valor, centro_custo_id: evento.centroCusto });
      }
      continue;
    }
    const valor = r2(m.valor === "alocacao" ? evento.alocacoes.reduce((s, a) => s + a.valor, 0) : evento.valores[m.valor]);
    if (!(valor > 0)) continue;
    let conta: string | undefined;
    if (m.conta === "banco") {
      if (!evento.contaBancaria) return { pendencia: { motivo: "sem_banco", detalhe: "A baixa não diz de que banco saiu ou entrou, nem está conciliada com o extrato." } };
      conta = v.bancaria.get(evento.contaBancaria);
      if (!conta) return { pendencia: { motivo: "sem_vinculo_bancario", detalhe: evento.contaBancaria } };
    } else {
      const papel = m.conta.slice("papel:".length);
      const tipo = papel === "contas_a_pagar" ? "fornecedor" : papel === "contas_a_receber" ? "cliente" : null;
      const quem = tipo && evento.contraparte?.tipo === tipo ? evento.contraparte : null;
      conta = (quem ? v[quem.tipo]?.get(quem.id) : undefined) ?? v.papel.get(papel);
      if (!conta) return { pendencia: quem ? { motivo: "sem_vinculo_contraparte", detalhe: quem.nome } : { motivo: "sem_vinculo_papel", detalhe: papel } };
    }
    partidas.push({ conta_id: conta, lado: m.lado, valor, centro_custo_id: m.conta.startsWith("papel:contas_a_") ? null : evento.centroCusto });
  }
  const d = partidas.filter((p) => p.lado === "D").reduce((s, p) => s + centavos(p.valor), 0);
  const c = partidas.filter((p) => p.lado === "C").reduce((s, p) => s + centavos(p.valor), 0);
  if (!partidas.length || d === 0) return { pendencia: { motivo: "valor_zero", detalhe: "Nada a lançar." } };
  if (d !== c) return { pendencia: { motivo: "desequilibrado", detalhe: `Débitos ${(d / 100).toFixed(2)} e créditos ${(c / 100).toFixed(2)}: o rateio não fecha com o valor do título.` } };
  return { partidas };
}

export const PAPEIS = [
  { papel: "contas_a_pagar", rotulo: "Contas a pagar (fornecedores e outros)", natureza: "passivo" },
  { papel: "contas_a_receber", rotulo: "Contas a receber (clientes e outros)", natureza: "ativo" },
  { papel: "juros_pagos", rotulo: "Juros pagos", natureza: "resultado" },
  { papel: "multas_pagas", rotulo: "Multas pagas", natureza: "resultado" },
  { papel: "descontos_obtidos", rotulo: "Descontos obtidos", natureza: "resultado" },
  { papel: "juros_recebidos", rotulo: "Juros recebidos", natureza: "resultado" },
  { papel: "multas_recebidas", rotulo: "Multas recebidas", natureza: "resultado" },
  { papel: "descontos_concedidos", rotulo: "Descontos concedidos", natureza: "resultado" },
] as const;
