/**
 * Setor pelo CONTEÚDO do arquivo (Segundo Cérebro, Etapa 3). Só regras exatas, sem IA: o texto
 * nunca sai do computador (na coleta) nem do servidor. O conteúdo vale mais que o nome quando a
 * regra é forte (chave de acesso de NF-e, holerite). Documento de colaborador não sobe pela
 * coleta: vai pelo RH (LGPD).
 */
import { cpfValido } from "../decisao/guard.ts";

export type PeloConteudo = { setor: string | null; rh?: boolean; motivo: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[ \t]+/g, " ");

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita para a esquerda). */
function dvDaChave(chave43: string): number {
  let soma = 0, peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const dv = 11 - (soma % 11);
  return dv >= 10 ? 0 : dv;
}

/**
 * Chave de acesso de NF-e/CT-e: 44 dígitos (às vezes em grupos de 4, quebrados em duas linhas no
 * DANFE), começando pelo código da UF (11–53) e com o dígito verificador certo.
 */
export function temChaveDeAcesso(texto: string): boolean {
  for (const m of texto.matchAll(/(?<!\d)(?:\d{4}[\s.]{0,3}){10}\d{4}(?!\d)/g)) {
    const d = m[0].replace(/\D/g, "");
    const uf = Number(d.slice(0, 2));
    if (d.length === 44 && uf >= 11 && uf <= 53 && dvDaChave(d.slice(0, 43)) === Number(d[43])) return true;
  }
  return false;
}

/** Quantos CPFs válidos e diferentes aparecem (formatados: 000.000.000-00). */
export function contarCpfs(texto: string): number {
  return new Set([...texto.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g)].map((m) => m[0].replace(/\D/g, "")).filter(cpfValido)).size;
}

const LINHA_DIGITAVEL = /\b\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}\b/;
const BANCOS = /\b(itau|bradesco|santander|banco do brasil|caixa economica|sicoob|sicredi|inter|nubank|btg|safra)\b/;

const REGRAS: { setor: string; teste: (t: string, bruto: string) => boolean; motivo: string }[] = [
  { setor: "fiscal", teste: (t, b) => temChaveDeAcesso(b) || /\b(danfe|nota fiscal eletronica|documento auxiliar da nota fiscal)\b/.test(t), motivo: "nota fiscal, chave de acesso ou DANFE" },
  { setor: "financeiro", teste: (t, b) => /\bsaldo anterior\b/.test(t) || (/\bextrato\b/.test(t) && BANCOS.test(t)) || LINHA_DIGITAVEL.test(b) || /\b(boleto|ficha de compensacao|comprovante de pagamento|comprovante de transferencia)\b/.test(t), motivo: "extrato, boleto ou comprovante" },
  { setor: "compras", teste: (t) => /\b(cotacao n|orcamento|pedido de compra|ordem de compra|proforma|pro forma)\b/.test(t), motivo: "cotação, orçamento ou pedido de compra" },
  { setor: "comercial", teste: (t) => /\b(proposta comercial|pedido de venda|tabela de precos)\b/.test(t), motivo: "proposta ou pedido de venda" },
  { setor: "producao", teste: (t) => /\b(ordem de servico|ordem de producao|desenho tecnico)\b/.test(t), motivo: "ordem de serviço ou de produção" },
  { setor: "fundicao", teste: (t) => /\b(analise quimica|espectrometria|liga metalica)\b/.test(t) || (/\bcorrida\b/.test(t) && /\bforno\b/.test(t)), motivo: "análise química ou corrida de forno" },
  { setor: "almoxarifado", teste: (t) => /\b(inventario de estoque|requisicao de material|entrada de material|ficha de estoque)\b/.test(t), motivo: "estoque ou requisição de material" },
];

const HOLERITE = /\b(holerite|contracheque|contra cheque|demonstrativo de pagamento|recibo de pagamento de salario|aviso de ferias|termo de rescisao|atestado medico|atestado de saude ocupacional)\b/;

export function classificarConteudo(texto: string): PeloConteudo {
  const t = norm(texto);
  if (HOLERITE.test(t) || (/\bproventos\b/.test(t) && /\bdescontos\b/.test(t) && /\b(salario|fgts|inss)\b/.test(t))) {
    return { setor: null, rh: true, motivo: "pelo conteúdo: documento de colaborador" };
  }
  if (contarCpfs(texto) >= 3) return { setor: null, rh: true, motivo: "pelo conteúdo: tem CPF de 3 ou mais pessoas" };
  for (const r of REGRAS) if (r.teste(t, texto)) return { setor: r.setor, motivo: `pelo conteúdo: ${r.motivo}` };
  return { setor: null, motivo: "o conteúdo não diz o setor" };
}
