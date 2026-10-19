/**
 * O tema de cada SARA (proprietário, 19/10/2026): além dos dados da plataforma, ela responde dúvidas
 * do assunto do módulo com o conhecimento do modelo (conceitos, legislação, cálculos, boas práticas)
 * e pode pesquisar na internet — mas SÓ no tema do módulo e SÓ nas fontes listadas aqui (órgãos
 * oficiais e entidades do setor). A lista fechada de sites é o que mantém a pesquisa no assunto:
 * fora dela, a busca não acontece.
 */
export type Tema = {
  /** O assunto, em uma linha, para o prompt e para o verificador de escopo. */
  assunto: string;
  /** Exemplos de dúvidas do tema (ajudam o verificador a não recusar o que é do trabalho). */
  exemplos: string;
  /** Sites onde a pesquisa pode buscar (subdomínios incluídos). */
  dominios: string[];
};

const GOV = ["gov.br", "planalto.gov.br"];

export const TEMAS: Record<string, Tema> = {
  financeiro: {
    assunto: "finanças da empresa: contas a pagar e a receber, fluxo de caixa, conciliação bancária, crédito e financiamentos (FINAME, BNDES, capital de giro), juros, câmbio, cobrança, tributos retidos e guias (DARF, GPS), indicadores financeiros e contabilidade gerencial",
    exemplos: "diferença entre juros simples e compostos; como funciona o FINAME; o que é capital de giro; como calcular o custo efetivo de um empréstimo; o que é DRE e EBITDA; o que é a taxa Selic",
    dominios: [...GOV, "bcb.gov.br", "bndes.gov.br", "febraban.org.br", "ibge.gov.br", "cvm.gov.br", "b3.com.br"],
  },
  fiscal: {
    assunto: "tributos e obrigações fiscais da indústria: ICMS, IPI, PIS/COFINS, DIFAL, substituição tributária, reforma tributária (IBS/CBS), NF-e e NFS-e, CFOP, NCM, SPED/EFD, escrituração e o fechamento com o escritório contábil",
    exemplos: "o que é DIFAL e quando se aplica; diferença entre CFOP 5101 e 6101; como funciona a substituição tributária; o que muda com IBS e CBS; prazo de cancelamento de NF-e; o que é carta de correção",
    dominios: [...GOV, "fazenda.sp.gov.br", "confaz.fazenda.gov.br", "nfe.fazenda.gov.br", "sped.rfb.gov.br", "receita.fazenda.gov.br"],
  },
  rh: {
    assunto: "legislação trabalhista e gestão de pessoas: CLT, férias, 13º, rescisão, jornada e banco de horas, afastamentos e INSS, FGTS, eSocial, benefícios, saúde e segurança do trabalho (NRs, PCMSO, PGR, ASO, EPI e CA), terceirização",
    exemplos: "prazo para pagar a rescisão; como funciona o fracionamento de férias; o que é aviso prévio indenizado; quando o ASO periódico é obrigatório; validade do CA de um EPI; regras da NR-6",
    // Só lei e governo: decisão antiga de tribunal cita regra revogada (ex.: prazo da rescisão antes de 2017).
    dominios: [...GOV, "esocial.gov.br", "caixa.gov.br"],
  },
  compras: {
    assunto: "compras industriais: cotação e negociação com fornecedores, condições de pagamento, frete (CIF e FOB), impostos na compra (ICMS, IPI, crédito), importação, avaliação e homologação de fornecedores",
    exemplos: "diferença entre frete CIF e FOB; quando o IPI gera crédito na compra; como montar um mapa de cotação; o que é lead time; o que é saving",
    dominios: [...GOV, "fazenda.sp.gov.br", "sebrae.com.br", "siscomex.gov.br"],
  },
  almoxarifado: {
    assunto: "gestão de estoque e almoxarifado: recebimento e conferência de notas, inventário, curva ABC, estoque mínimo e ponto de pedido, custo médio, armazenagem e movimentação (NR-11), unidades de medida",
    exemplos: "como calcular o ponto de pedido; o que é curva ABC; diferença entre custo médio e PEPS; como fazer inventário rotativo; o que conferir no recebimento de uma nota",
    dominios: [...GOV, "sebrae.com.br"],
  },
  comercial: {
    assunto: "vendas industriais B2B: orçamento e formação de preço, margem e markup, condições comerciais, crédito ao cliente, pedidos e prazos, funil comercial, exportação e câmbio",
    exemplos: "diferença entre margem e markup; como formar preço de uma peça usinada; o que é Incoterm; como funciona uma exportação; o que é um funil de vendas",
    dominios: [...GOV, "sebrae.com.br", "apexbrasil.com.br", "bcb.gov.br", "siscomex.gov.br"],
  },
  producao: {
    assunto: "produção industrial de moldes: PCP, ordens de serviço, roteiros, tempos e capacidade, OEE, usinagem CNC, metalização, qualidade e inspeção, manutenção e segurança de máquinas (NR-12)",
    exemplos: "como se calcula o OEE; o que é setup e como reduzir; diferença entre manutenção preventiva e preditiva; o que exige a NR-12; o que é um gargalo no PCP",
    dominios: [...GOV, "abimaq.org.br", "sebrae.com.br"],
  },
  fundicao: {
    assunto: "fundição: ligas de ferro fundido e bronze, areia de moldagem, machos, vazamento, inoculação e escorificação, tratamento térmico, defeitos de fundição, segurança no forno",
    exemplos: "para que serve o inoculante; o que causa porosidade numa peça fundida; diferença entre ferro fundido cinzento e nodular; o que é escorificante; como se controla a umidade da areia",
    dominios: [...GOV, "abifa.org.br", "sebrae.com.br"],
  },
  portaria: {
    assunto: "portaria e segurança patrimonial: controle de acesso de visitantes e terceiros, integração de segurança, frota e transporte (documentos, notas na saída), recebimento de cargas, NRs aplicáveis a prestadores",
    exemplos: "que documentos um terceiro precisa para entrar; o que conferir na saída de um veículo com nota fiscal; o que é integração de segurança; regras de transporte de carga",
    dominios: [...GOV, "antt.gov.br", "detran.sp.gov.br"],
  },
};

export const temaDe = (modulo: string): Tema | null => TEMAS[modulo] ?? null;
