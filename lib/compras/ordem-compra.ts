/**
 * Ordem de Compra a partir da cotação aprovada (sem React, sem banco): só os
 * itens aprovados, os totais no modelo do sistema antigo e os dados do
 * fornecedor. O número da OC é o número da cotação (decisão do dono, 09/10/2026).
 *
 * Preço unitário é "c/ ICMS s/IPI": o ICMS já está no preço (aparece só como
 * informação) e o IPI soma por cima. Total do pedido = itens + IPI + frete +
 * seguro + outras despesas.
 */

export type FreteTipo = "CIF" | "FOB" | "SEM";

export const FRETE_TEXTO: Record<FreteTipo, string> = {
  CIF: "0-Contratação do Frete por Conta do Remetente (CIF)",
  FOB: "1-Contratação do Frete por Conta do Destinatário (FOB)",
  SEM: "9-Sem Ocorrência de Transporte",
};

export type CabecalhoCotacao = {
  id: number;
  status: string;
  fornecedor: string;
  aprovadoPor: string | null;
  dataDecisao: string | null;
  freteTipo: FreteTipo;
  freteValor: number;
  seguroValor: number;
  outrasDespesas: number;
  prazoEntrega: string | null;
  observacao: string | null;
  /** Compra direta: sem cotação, autorizada fora da plataforma (aprovadoPor = quem autorizou). */
  direta?: boolean;
};

export type ItemCotacao = {
  produto: string;
  quantidade: number;
  unidade: string;
  valorUnit: number;
  icms: number;
  ipi: number;
  prazo: string | null;
  status: string | null;
};

export type FornecedorOrdem = {
  nome: string;
  cnpj: string | null;
  ie: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  prazoPagamento: string | null;
};

export type LinhaOrdem = { item: number; descricao: string; quantidade: number; unidade: string; icms: number; ipi: number; precoUnit: number; total: number };

export type OrdemCompra = {
  numero: number;
  emissao: string | null;
  fornecedor: FornecedorOrdem;
  itens: LinhaOrdem[];
  totais: { itens: number; frete: number; seguro: number; outras: number; icms: number; ipi: number; pedido: number };
  frete: { tipo: FreteTipo; texto: string };
  formaPagamento: string;
  prazoEntrega: string | null;
  observacao: string | null;
  aprovadoPor: string | null;
  direta: boolean;
  solicitante: string;
  /** Algum item da cotação ficou de fora (rejeitado ou ainda pendente). */
  parcial: boolean;
  avisos: string[];
};

export class OrdemIndisponivel extends Error {}

const centavos = (v: number) => Math.round(v * 100) / 100;

/** Despesas do pedido além dos itens (frete, seguro, outras). */
export function despesasDoPedido(c: { freteValor?: number | null; seguroValor?: number | null; outrasDespesas?: number | null }): number {
  return centavos((Number(c.freteValor) || 0) + (Number(c.seguroValor) || 0) + (Number(c.outrasDespesas) || 0));
}

/**
 * Itens que entram na OC: os aprovados. Cotação antiga sem status por item
 * (aprovada ou comprada inteira) leva todos.
 */
export function itensDaOrdem(cab: Pick<CabecalhoCotacao, "status">, itens: ItemCotacao[]): ItemCotacao[] {
  const comStatus = itens.some((i) => i.status);
  if (!comStatus) return cab.status === "APROVADO" || cab.status === "COMPRADO" ? itens : [];
  return itens.filter((i) => i.status === "APROVADO");
}

export function montarOrdemCompra(cab: CabecalhoCotacao, itens: ItemCotacao[], fornecedor: FornecedorOrdem, solicitante: string | null): OrdemCompra {
  const aprovados = itensDaOrdem(cab, itens);
  if (!aprovados.length) throw new OrdemIndisponivel("A ordem de compra sai depois que a cotação (ou algum item dela) é aprovada.");

  let somaItens = 0, somaIcms = 0, somaIpi = 0;
  const linhas: LinhaOrdem[] = aprovados.map((i, idx) => {
    const bruto = i.valorUnit * i.quantidade;
    somaItens += bruto;
    somaIcms += bruto * (i.icms / 100);
    somaIpi += bruto * (i.ipi / 100);
    return { item: idx + 1, descricao: i.produto, quantidade: i.quantidade, unidade: i.unidade, icms: i.icms, ipi: i.ipi, precoUnit: i.valorUnit, total: centavos(bruto) };
  });
  const totais = {
    itens: centavos(somaItens),
    frete: centavos(Number(cab.freteValor) || 0),
    seguro: centavos(Number(cab.seguroValor) || 0),
    outras: centavos(Number(cab.outrasDespesas) || 0),
    icms: centavos(somaIcms),
    ipi: centavos(somaIpi),
    pedido: 0,
  };
  totais.pedido = centavos(totais.itens + totais.ipi + totais.frete + totais.seguro + totais.outras);

  const prazos = [...new Set(aprovados.map((i) => (i.prazo ?? "").trim()).filter(Boolean))];
  const avisos: string[] = [];
  if (!fornecedor.cnpj) avisos.push("O fornecedor está sem CNPJ no cadastro.");
  if (!fornecedor.endereco || !fornecedor.cidade) avisos.push("O fornecedor está sem endereço completo no cadastro.");

  return {
    numero: cab.id,
    emissao: cab.dataDecisao,
    fornecedor,
    itens: linhas,
    totais,
    frete: { tipo: cab.freteTipo, texto: FRETE_TEXTO[cab.freteTipo] ?? FRETE_TEXTO.CIF },
    formaPagamento: prazos.join(" / ") || fornecedor.prazoPagamento || "",
    prazoEntrega: cab.prazoEntrega,
    observacao: cab.observacao?.trim() || null,
    aprovadoPor: cab.aprovadoPor,
    direta: Boolean(cab.direta),
    solicitante: solicitante?.trim() || "COMPRAS",
    parcial: aprovados.length < itens.length,
    avisos,
  };
}

// ---------------- Emitente (quem compra) ----------------

/** Cabeçalho da OC: a empresa que compra, vinda da configuração da organização (nunca fixa no código). */
export type EmitenteOrdem = {
  razaoSocial: string;
  endereco: string;
  cidade: string;
  telefones: string;
  cnpj: string;
  ie: string;
  site: string;
  /** Uma nota por linha; cada linha em trechos normais e em negrito (**texto**). */
  notas: { negrito: boolean; texto: string }[][];
};

const soDigitos = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");
const limpo = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const formatarCnpj = (v: string) => (/^\d{14}$/.test(v) ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : v);
const formatarCep = (v: string) => (/^\d{8}$/.test(v) ? v.replace(/^(\d{5})(\d{3})$/, "$1-$2") : v);
/** IE com 12 dígitos (padrão de SP) sai em grupos de 3; as outras ficam como estão. */
const formatarIe = (v: string) => (/^\d{12}$/.test(v) ? v.replace(/^(\d{3})(\d{3})(\d{3})(\d{3})$/, "$1.$2.$3.$4") : v);
const formatarTelefone = (v: string) =>
  /^\d{10,11}$/.test(v) ? v.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : v;

/** "a **b** c" → trechos normais e em negrito. */
export function trechosDaNota(linha: string): { negrito: boolean; texto: string }[] {
  return linha.split("**").map((texto, i) => ({ negrito: i % 2 === 1, texto })).filter((t) => t.texto);
}

/** Monta o cabeçalho a partir de empresa_documento_compra() (campos crus do banco). */
export function montarEmitente(d: Record<string, unknown> | null): EmitenteOrdem {
  const r = d ?? {};
  const endereco = [limpo(r.logradouro), limpo(r.numero)].filter(Boolean).join(", ");
  const bairro = limpo(r.bairro);
  const cidade = [limpo(r.municipio), limpo(r.uf)].filter(Boolean).join(" / ");
  const cep = formatarCep(soDigitos(r.cep));
  const ie = limpo(r.ie);
  return {
    razaoSocial: limpo(r.razao_social),
    endereco: [endereco + (limpo(r.complemento) ? ` ${limpo(r.complemento)}` : ""), bairro].filter(Boolean).join(" - "),
    cidade: [cidade, cep ? `CEP: ${cep}` : ""].filter(Boolean).join(" - "),
    telefones: limpo(r.telefones) || formatarTelefone(soDigitos(r.telefone)),
    cnpj: formatarCnpj(soDigitos(r.cnpj)),
    ie: ie.toUpperCase() === "ISENTO" ? "ISENTO" : formatarIe(soDigitos(ie)),
    site: limpo(r.site),
    notas: limpo(r.notas_ordem_compra).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(trechosDaNota),
  };
}
