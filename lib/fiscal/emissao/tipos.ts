/**
 * Emissão de NF-e (modelo 55) — Entrega 2, começando pelo ambiente de TREINO (13/10/2026).
 *
 * A nota segue sempre o mesmo caminho; muda só o ambiente: treino (só na plataforma, sem SEFAZ,
 * sem nenhuma obrigação fiscal) → homologação (teste oficial da SEFAZ) → produção.
 * Impostos por item no treino: ICMS, IPI, PIS e COFINS (decisão do proprietário). ST, DIFAL e
 * IBS/CBS entram depois, pelo material do Jefferson.
 */

export type AmbienteNfe = "treino" | "homologacao" | "producao";

export type SituacaoNfe = "rascunho" | "validada" | "aguardando_aprovacao" | "transmitindo" | "autorizada" | "rejeitada" | "cancelada";

export type Destinatario = {
  documento: string; // CNPJ ou CPF, só dígitos
  nome: string;
  /** 1 contribuinte do ICMS; 2 isento; 9 não contribuinte. */
  indIE: 1 | 2 | 9;
  ie: string;
  email: string;
  logradouro: string; numero: string; complemento: string; bairro: string;
  codigoMunicipio: string; municipio: string; uf: string; cep: string; fone: string;
  /** Exterior: código do país (BACEN) e nome; vazio = Brasil. No exterior, `documento` é a identificação estrangeira (pode ir vazia). */
  pais?: string;
  nomePais?: string;
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
  /**
   * Devolução (finalidade 4): a nota e o item devolvidos (grupo DFeReferenciado; a SEFAZ exige por item e proíbe o
   * refNFe na devolução desde 03/11/2026, NT 2025.002 v1.52, RV VC02-14). Sem chave no item, vale a chave da nota.
   */
  dfeReferenciado?: { chave?: string; nItem: number };
  /** IPI (e IPI devolvido) dentro da base do ICMS fora da venda a consumidor final (ex.: retorno de demonstração). Vem da máscara. */
  ipiNaBaseIcms?: boolean;
  /** Devolução: percentual devolvido e o IPI devolvido (grupo impostoDevol). */
  ipiDevolvido?: { percentual: number; valor: number };
  /** ICMS calculado por dentro: base = valor ÷ (1 − alíquota) (ex.: sucata, art. 392 do RICMS/SP). Vem da máscara. */
  icmsPorDentro?: boolean;
  /** Modalidade da base do ICMS (modBC): 0 margem; 1 pauta; 2 preço tabelado; 3 valor da operação (padrão). */
  icmsModBC?: 0 | 1 | 2 | 3;
  /** Código de benefício fiscal da UF (cBenef; SP: SP020120, SP070050…), vindo da máscara. */
  cBenef?: string;
  /** Valor total do item quando o preço tem mais casas que a conta quantidade × unitário (o GRV leva assim). */
  valorTotal?: number;
  /** Unidade, quantidade e valor unitário tributáveis, quando diferentes dos comerciais. */
  tributavel?: { unidade: string; quantidade: number; valorUnitario: number };
  /** Texto do item (infAdProd). Sem ele, a plataforma escreve o pedido de compra. */
  infoAdicional?: string;
  /**
   * Valores informados (importação pela DI, nota de ajuste como o crédito do CIAP): entram como vieram e
   * substituem a conta da plataforma. Campo ausente continua calculado.
   */
  informado?: { vBC?: number; vICMS?: number; vBCIPI?: number; vIPI?: number; vBCPisCofins?: number; vPIS?: number; vBCCofins?: number; vCOFINS?: number; vBCIBSCBS?: number; vIBS?: number; vCBS?: number };
  /** PIS/COFINS de "outras operações" (CST 49 a 99) só informativo: base e valor zero (escolha da máscara, como o GRV faz nas remessas). */
  pisCofinsSemBase?: boolean;
  /** Imposto de importação (grupo II). */
  ii?: { vBC: number; vDespAdu: number; vII: number; vIOF: number };
  /** Declaração de importação (grupo DI). */
  di?: DeclaracaoImportacao[];
  /** Exportação do item (detExport): drawback e, na exportação indireta, a nota de remessa com fim de exportação. */
  exportacao?: { drawback?: string; indireta?: { registro: string; chave: string; quantidade: number } }[];
};

export type DeclaracaoImportacao = {
  numero: string; data: string; localDesembaraco: string; ufDesembaraco: string; dataDesembaraco: string;
  /** tpViaTransp: 1 marítima; 4 aérea; 7 rodoviária… */
  viaTransporte: number; vAFRMM?: number;
  /** tpIntermedio: 1 por conta própria; 2 por conta e ordem; 3 encomenda. */
  intermedio: number; documentoAdquirente?: string; ufTerceiro?: string; exportador: string;
  adicoes: { numero: number; sequencial: number; fabricante: string; desconto?: number; drawback?: string }[];
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
  /** modFrete: 0 emitente; 1 destinatário; 2 terceiros; 3 próprio do emitente; 4 próprio do destinatário; 9 sem frete. */
  frete: {
    modalidade: 0 | 1 | 2 | 3 | 4 | 9; valor: number;
    transportadora?: { documento: string; nome: string; ie: string; uf: string; endereco?: string; municipio?: string } | null;
    veiculo?: { placa: string; uf: string; rntc?: string } | null;
    volumes?: { quantidade: number; especie: string; pesoLiquido: number; pesoBruto: number; marca?: string; numeracao?: string } | null;
  };
  seguro: number;
  outrasDespesas: number;
  /** tPag: 01 dinheiro; 15 boleto; 17 PIX; 18 transferência; 90 sem pagamento; 99 outros. */
  pagamento: {
    forma: string; duplicatas: Duplicata[];
    /** Pagamento em mais de uma parte (detPag): a soma tem de fechar o total. Sem isto, uma parte só, na forma acima. */
    partes?: { forma: string; valor: number }[];
  };
  infoComplementar: string;
  /** Chave da NF-e referenciada (devolução, complementar). */
  referencia?: string;
  /** Outras notas referenciadas (retorno de conserto, exportação indireta, ajuste): vão junto com `referencia`. */
  referencias?: string[];
  /** Texto de interesse do fisco (infAdFisco): o fundamento legal da máscara (redução de base, suspensão…). */
  infoFisco?: string;
  /** Data e hora da saída ou entrada da mercadoria (dhSaiEnt), quando diferente da emissão. */
  saidaEntrada?: string;
  /** Exportação: UF e local de embarque (grupo exporta). */
  exportacao?: { ufSaida: string; localExportacao: string; localDespacho?: string };
  /** Total da nota informado (importação, quando a DI soma tributos e despesas aduaneiras ao total). */
  valorTotalInformado?: number;
};

export type Emitente = {
  cnpj: string; razaoSocial: string; fantasia: string | null; ie: string; im: string | null; cnae: string | null; crt: number;
  logradouro: string; numero: string; complemento: string | null; bairro: string; codigoMunicipio: string; municipio: string; uf: string; cep: string; telefone: string | null;
};

export type TotaisItem = { vProd: number; vDesc: number; vBC: number; vICMS: number; vIPI: number; vBCIPI: number; vBCPisCofins: number; vPIS: number; vBCCofins: number; vCOFINS: number; vBCIBSCBS: number; vIBS: number; vCBS: number; vFrete: number; vSeg: number; vOutro: number; vII: number; vIPIDevol: number };
export type Totais = {
  vProd: number; vDesc: number; vBC: number; vICMS: number; vIPI: number; vPIS: number; vCOFINS: number;
  vBCIBSCBS: number; vIBS: number; vCBS: number;
  vFrete: number; vSeg: number; vOutro: number; vII: number; vIPIDevol: number; vNF: number;
  /** Total com os tributos por fora (IBS, CBS e IS): vNFTot. */
  vNFTot: number;
};
