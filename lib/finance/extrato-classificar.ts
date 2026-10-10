/**
 * Classificação dos lançamentos do extrato bancário, só por regra de texto
 * (nenhum modelo, nenhum serviço externo). Serve a carga do extrato e a tela de
 * conciliação: decide a categoria, tira o beneficiário do texto e, sobretudo,
 * retira o CPF — o CPF de uma pessoa nunca é gravado.
 */

export type CategoriaExtrato =
  | "antecipacao_recebiveis"
  | "fornecedor"
  | "folha"
  | "tributo"
  | "transferencia_interna"
  | "emprestimo"
  | "financiamento"
  | "tarifa_bancaria"
  | "rendimento"
  | "aplicacao"
  | "saque"
  | "recebimento_cliente"
  | "pessoa_fisica"
  | "estorno"
  | "cambio"
  | "exportacao"
  | "finimp"
  | "emprestimo_cambio"
  | "cartao_credito"
  | "outros";

export const ROTULO_CATEGORIA: Record<CategoriaExtrato, string> = {
  antecipacao_recebiveis: "Antecipação de recebíveis",
  fornecedor: "Fornecedor",
  folha: "Folha de pagamento",
  tributo: "Tributos e encargos",
  transferencia_interna: "Transferência interna",
  emprestimo: "Empréstimo (entrada)",
  financiamento: "Financiamento e seguro do crédito",
  tarifa_bancaria: "Tarifas e IOF",
  rendimento: "Rendimento de aplicação",
  aplicacao: "Resgate de aplicação",
  saque: "Saque em cheque",
  recebimento_cliente: "Recebimento de cliente",
  pessoa_fisica: "Pessoa física",
  estorno: "Estorno / devolução",
  // Câmbio no Santander (proprietário, 10/10/2026): entradas são recebimentos de exportação;
  // saídas são parcelas de FINIMP e de empréstimo. O texto do banco não diz qual é qual na
  // saída, então ela chega como "cambio" e é separada depois.
  cambio: "Câmbio (FINIMP ou empréstimo)",
  exportacao: "Recebimento de exportação",
  finimp: "Parcela de FINIMP",
  emprestimo_cambio: "Parcela de empréstimo (câmbio)",
  cartao_credito: "Fatura do cartão de crédito",
  outros: "Outros",
};

export type Classificacao = {
  categoria: CategoriaExtrato;
  /** Texto do banco sem CPF e com espaços normalizados. */
  descricao: string;
  /** Nome do beneficiário/pagador, quando o texto traz. */
  contraparte: string | null;
  /** CNPJ só com dígitos, quando o texto traz. */
  cnpj: string | null;
  /** Código da conta do plano para as categorias que têm conta fixa. */
  contaSugerida: string | null;
  /** Pagamento em lote do banco (SISPAG), sem nome de beneficiário. */
  semBeneficiario: boolean;
};

const CNPJ_PECSIL = "46839106000184";

const CPF_FORMATADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CPF_SEM_PONTOS = /(?<![\d./-])\d{11}(?![\d./-])/g;
const CNPJ_FORMATADO = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const CNPJ_SEM_PONTOS = /(?<!\d)\d{14}(?!\d)/;

const espacos = (texto: string) => texto.replace(/\s+/g, " ").trim();

/** Tira CPF (formatado ou só dígitos) do texto. O CNPJ fica. */
export function limparDescricao(memo: string): string {
  return espacos(memo.replace(CPF_FORMATADO, " ").replace(CPF_SEM_PONTOS, " "));
}

const temCpf = (memo: string) => {
  CPF_FORMATADO.lastIndex = 0;
  CPF_SEM_PONTOS.lastIndex = 0;
  return CPF_FORMATADO.test(memo) || CPF_SEM_PONTOS.test(memo);
};

function cnpjDe(memo: string): string | null {
  const achou = memo.match(CNPJ_FORMATADO) ?? memo.match(CNPJ_SEM_PONTOS);
  return achou ? achou[0].replace(/\D/g, "") : null;
}

const PREFIXOS =
  /^(BOLETO PAGO|PAGTO ELETRON COBRANCA|TRANSF CC PARA CC(?: PJ)?|PIX ENVIADO DES:|PIX RECEBIDO REM:|PIX QR CODE DINAMICO DES:|RECEBIMENTO FORNECEDOR|DEBITO AUTOMATICO|PAGAMENTO DE BOLETO(?: OUTROS BANCOS)?|PAGAMENTOS PIX QR-CODE|PAGAMENTOS TRANSF (?:CC|POUP) ITAU|PAGAMENTOS|PIX ENVIADO|PIX AGENDADO|PIX RECEBIDO(?: PECSIL \d\d\/\d\d)?|PIX DEVOLVIDO|RECEBIMENTOS|DEB AUTOR|TED RECEBIDA(?: [\d.]+)?)\s+/;

/**
 * O Itaú escreve o nome abreviado (12 posições) e logo depois o nome inteiro:
 * "CMBA INDUSTR CMBA INDUSTRIA MECANICA LTDA". Fica só o inteiro.
 */
function semAbreviatura(texto: string): string {
  const t = texto.split(" ");
  for (let i = 1; i < t.length; i++) {
    const cabeca = t.slice(0, i).join(" ");
    const cauda = t.slice(i).join(" ");
    if (cauda.startsWith(cabeca)) return cauda;
  }
  return texto;
}

function contraparteDe(descricao: string): string | null {
  // Bradesco: "TED-TRANSF ELET DISPON REMET.AMBEV S A" (sem espaço depois do ponto).
  const ted = descricao.match(/^TED-TRANSF ELET DISPON REMET\.\s*(.+)$/);
  const achou = ted ? null : descricao.match(PREFIXOS);
  if (!achou && !ted) return null;
  let resto = ted ? ted[1] : descricao.slice(achou![0].length);
  resto = resto.replace(/\s+\d{2}\/\d{2}$/, ""); // "PIX ENVIADO DES: FULANO 01/07"
  resto = resto.replace(CNPJ_FORMATADO, " ").replace(CNPJ_SEM_PONTOS, " ");
  resto = espacos(resto.replace(/^\d[\d./]*\s+/, ""));
  resto = semAbreviatura(resto);
  return resto.length >= 3 ? resto : null;
}

export function classificarLancamento(memo: string, cnpjProprio = CNPJ_PECSIL): Classificacao {
  const descricao = limparDescricao(memo);
  const m = descricao.toUpperCase();
  const cnpj = cnpjDe(descricao);
  const pessoa = temCpf(memo);

  const base = { descricao, contraparte: contraparteDe(descricao), cnpj, contaSugerida: null as string | null, semBeneficiario: false };
  const como = (categoria: CategoriaExtrato, extra: Partial<Classificacao> = {}): Classificacao => ({ ...base, categoria, ...extra });

  if (/^AQUISICAO FORNECEDORES/.test(m)) return como("antecipacao_recebiveis", { contraparte: null });
  if (/^(EMPREST|CONTRATACAO EMPREST)/.test(m)) return como("emprestimo", { contraparte: null, cnpj: null });
  if (/^OPERACAO DE CAMBIO.*CREDITO/.test(m)) return como("exportacao", { contraparte: null });
  if (/^OPERACAO DE CAMBIO/.test(m)) return como("cambio", { contraparte: null });
  if (cnpj === cnpjProprio || /PECSIL MOLDES|PECSIL METALURGICA/.test(m)) return como("transferencia_interna", { contraparte: null });
  if (/^SISPAG SALARIOS/.test(m)) return como("folha", { contraparte: null });
  if (/^SISPAG TRIBUTOS|RECEITA FEDERAL|COORD ADM FINANCEIRA|CEF MATRIZ|INMETRO|^PAGAMENTO DARF|^PGTO TRIBUTOS|^IMPOSTO DE RENDA|^PAGTO ELETRONICO TRIBUTO|^PARCELAMENTO DE DARF/.test(m)) return como("tributo", { contraparte: null });
  if (/^(PARC FINAME|PARCELA GIRO|PARCIAL GIRO|DEBITO SEGURO|PREST\.? DE EMPREST|PRESTACAO CONSORCIO|ENCARGOS C GARANTIDA|MORA CONTA GARANTIDA)/.test(m)) return como("financiamento", { contraparte: null });
  if (/^DEBITO AUT\.? FAT\.?CARTAO|^GASTOS CARTAO DE CREDITO/.test(m)) return como("cartao_credito", { contraparte: null, contaSugerida: "02.14" });
  if (/^IOF/.test(m)) return como("tarifa_bancaria", { contraparte: null, contaSugerida: "02.01.004" });
  if (/^(TAR |TARIFA |EST TRANSF REGULARIZACAO|DOC\/TED INTERNET)/.test(m)) return como("tarifa_bancaria", { contraparte: null, cnpj: null, contaSugerida: "02.01.014" });
  if (/^REND(IMENTOS)?\b.*\bPAGO APLIC|^RENDIMENTO LIQUIDO|^RENTAB\.? ?INVEST/.test(m)) return como("rendimento", { contraparte: null, contaSugerida: "01.02.001" });
  if (/^(RESGATE|INT RESGATE)/.test(m)) return como("aplicacao", { contraparte: null });
  if (/^SAQ DIN|^SAQUE CAIXA|^CHEQUE COMPENSADO/.test(m)) return como("saque", { contraparte: null });
  if (/^RECEBIMENTOS|^RECEBIMENTO FORNECEDOR|^TED-TRANSF ELET DISPON REMET/.test(m)) return como("recebimento_cliente");
  if (/^PIX DEVOLVIDO|^PAGTO ITAU SEGUROS|^PGTO DEVOLV/.test(m)) return como("estorno");
  if (/^(PIX RECEBIDO|TED RECEBIDA)/.test(m) && !pessoa) return como("recebimento_cliente");
  if (/^PAGTO ELETRON COBRANCA|^TRANSF CC PARA CC|^DEBITO AUTOMATICO|^PIX QR CODE/.test(m)) return como("fornecedor");
  if (/^SISPAG FORNECEDORES|^PAGAMENTOS A FORNECEDORES|^PAGAMENTO DE TITULO/.test(m)) return como("fornecedor", { contraparte: null, semBeneficiario: true });
  if (/^PAGAMENTO DE BOLETO|^PAGAMENTO DE CARNES|^CONTA DE (AGUA|LUZ|ENERGIA|TELEFONE)/.test(m)) return como("fornecedor");
  if (pessoa) return como("pessoa_fisica");
  if (cnpj) return como("fornecedor");
  // PIX/TED enviado só com o nome (Santander não traz CPF/CNPJ): é pagamento; a conciliação diz a quem.
  if (/^(PIX ENVIADO|PIX AGENDADO|TED ENVIADA)/.test(m)) return como("fornecedor");
  return como("outros");
}
