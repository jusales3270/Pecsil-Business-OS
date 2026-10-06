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
  /^(BOLETO PAGO|PAGAMENTOS PIX QR-CODE|PAGAMENTOS TRANSF (?:CC|POUP) ITAU|PAGAMENTOS|PIX ENVIADO|PIX RECEBIDO(?: PECSIL \d\d\/\d\d)?|PIX DEVOLVIDO|RECEBIMENTOS|DEB AUTOR|TED RECEBIDA [\d.]+)\s+/;

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
  const achou = descricao.match(PREFIXOS);
  if (!achou) return null;
  let resto = descricao.slice(achou[0].length);
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
  if (/^EMPREST/.test(m)) return como("emprestimo", { contraparte: null, cnpj: null });
  if (cnpj === cnpjProprio || /PECSIL MOLDES|PECSIL METALURGICA E FUNDICAO/.test(m)) return como("transferencia_interna", { contraparte: null });
  if (/^SISPAG SALARIOS/.test(m)) return como("folha", { contraparte: null });
  if (/^SISPAG TRIBUTOS|RECEITA FEDERAL|COORD ADM FINANCEIRA|CEF MATRIZ|INMETRO/.test(m)) return como("tributo");
  if (/^(PARC FINAME|PARCELA GIRO|PARCIAL GIRO|DEBITO SEGURO)/.test(m)) return como("financiamento", { contraparte: null });
  if (/^IOF/.test(m)) return como("tarifa_bancaria", { contraparte: null, contaSugerida: "02.01.004" });
  if (/^(TAR |EST TRANSF REGULARIZACAO)/.test(m)) return como("tarifa_bancaria", { contraparte: null, cnpj: null, contaSugerida: "02.01.014" });
  if (/^REND(IMENTOS)?\b.*\bPAGO APLIC/.test(m)) return como("rendimento", { contraparte: null, contaSugerida: "01.02.001" });
  if (/^(RESGATE|INT RESGATE)/.test(m)) return como("aplicacao", { contraparte: null });
  if (/^SAQ DIN/.test(m)) return como("saque", { contraparte: null });
  if (/^RECEBIMENTOS/.test(m)) return como("recebimento_cliente");
  if (/^PIX DEVOLVIDO|^PAGTO ITAU SEGUROS/.test(m)) return como("estorno");
  if (/^SISPAG FORNECEDORES|^PAGAMENTOS A FORNECEDORES/.test(m)) return como("fornecedor", { contraparte: null, semBeneficiario: true });
  if (pessoa) return como("pessoa_fisica");
  if (cnpj) return como("fornecedor");
  return como("outros");
}
