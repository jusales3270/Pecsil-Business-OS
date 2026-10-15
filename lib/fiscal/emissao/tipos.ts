/**
 * Emissão de NF-e (modelo 55) — Entrega 2, começando pelo ambiente de TREINO (13/10/2026).
 *
 * A nota segue sempre o mesmo caminho; muda só o ambiente: treino (só na plataforma, sem SEFAZ,
 * sem nenhuma obrigação fiscal) → homologação (teste oficial da SEFAZ) → produção.
 * Impostos por item no treino: ICMS, IPI, PIS e COFINS (decisão do proprietário). ST, DIFAL e
 * IBS/CBS entram depois, pelo material do Jefferson.
 */

export type AmbienteNfe = "treino" | "homologacao" | "producao";

export type SituacaoNfe = "rascunho" | "validada" | "aguardando_aprovacao" | "autorizada" | "rejeitada" | "cancelada";

export type Destinatario = {
  documento: string; // CNPJ ou CPF, só dígitos
  nome: string;
  /** 1 contribuinte do ICMS; 2 isento; 9 não contribuinte. */
  indIE: 1 | 2 | 9;
  ie: string;
  email: string;
  logradouro: string; numero: string; complemento: string; bairro: string;
  codigoMunicipio: string; municipio: string; uf: string; cep: string; fone: string;
  /** Exterior: código do país (BACEN) e nome; vazio = Brasil. */
  pais?: string;
};

export type ItemNfe = {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  /** 0 nacional; 1 estrangeira importação direta; 2 estrangeira adquirida no mercado interno… */
  origem: number;
  /** CST (regime normal) ou CSOSN (Simples). */
  icmsCst: string;
  icmsAliquota: number;
  icmsReducaoBase: number; // %
  ipiCst: string;
  ipiAliquota: number;
  pisCst: string;
  pisAliquota: number;
  cofinsCst: string;
  cofinsAliquota: number;
  /** Enquadramento legal do IPI (cEnq): 999 tributação normal; 108 suspensão… Sem: 999. */
  ipiEnquadramento?: string;
  /** IBS/CBS (reforma, 2026): CST, classificação tributária e alíquotas (IBS da UF e CBS). Sem CST: o grupo não vai. */
  ibsCbsCst?: string;
  cClassTrib?: string;
  ibsAliquota?: number;
  cbsAliquota?: number;
  /** Base do PIS/COFINS sem o ICMS (opção da máscara; o contador decide). */
  pisCofinsExcluiIcms?: boolean;
  /** Código da máscara de impostos que preencheu o item (Fiscal › Máscaras de impostos). */
  mascara?: string;
  /** Item do orçamento que esta linha fatura (o teto do pedido é conferido no banco). */
  itemOrcamento?: string;
  /** Pedido de compra do cliente e o nº do item nele (xPed/nItemPed; o GRV leva os dois). */
  pedidoCompra?: string;
  itemPedido?: string;
};

export type Duplicata = { numero: string; vencimento: string; valor: number };

export type NotaNfe = {
  natureza: string;
  /** 1 normal; 2 complementar; 3 ajuste; 4 devolução. */
  finalidade: 1 | 2 | 3 | 4;
  /** 0 entrada; 1 saída. */
  tipo: 0 | 1;
  consumidorFinal: boolean;
  /** indPres: 0 não se aplica; 1 presencial; 2 internet; 9 outros. */
  presenca: 0 | 1 | 2 | 9;
  destinatario: Destinatario;
  itens: ItemNfe[];
  frete: { modalidade: 0 | 1 | 2 | 9; valor: number; transportadora?: { documento: string; nome: string; ie: string; uf: string } | null; volumes?: { quantidade: number; especie: string; pesoLiquido: number; pesoBruto: number } | null };
  seguro: number;
  outrasDespesas: number;
  /** tPag: 01 dinheiro; 15 boleto; 17 PIX; 18 transferência; 90 sem pagamento; 99 outros. */
  pagamento: { forma: string; duplicatas: Duplicata[] };
  infoComplementar: string;
  /** Chave da NF-e referenciada (devolução, complementar). */
  referencia?: string;
};

export type Emitente = {
  cnpj: string; razaoSocial: string; fantasia: string | null; ie: string; im: string | null; cnae: string | null; crt: number;
  logradouro: string; numero: string; complemento: string | null; bairro: string; codigoMunicipio: string; municipio: string; uf: string; cep: string; telefone: string | null;
};

export type TotaisItem = { vProd: number; vDesc: number; vBC: number; vICMS: number; vIPI: number; vBCIPI: number; vBCPisCofins: number; vPIS: number; vCOFINS: number; vBCIBSCBS: number; vIBS: number; vCBS: number; vFrete: number; vSeg: number; vOutro: number };
export type Totais = {
  vProd: number; vDesc: number; vBC: number; vICMS: number; vIPI: number; vPIS: number; vCOFINS: number;
  vBCIBSCBS: number; vIBS: number; vCBS: number;
  vFrete: number; vSeg: number; vOutro: number; vNF: number;
};
