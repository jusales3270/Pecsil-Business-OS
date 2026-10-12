/**
 * Contrato do transmissor de NF-e (Fiscal, 12/10/2026).
 *
 * A plataforma é a dona da nota (rascunho, regras, aprovação, guarda, ligações); a conversa com a
 * SEFAZ é uma peça trocável atrás desta interface. Hoje: o serviço separado `services/transmissor-nfe`
 * (biblioteca gratuita, GPL, isolada num programa à parte). Amanhã, se for o caso: uma API paga.
 * Trocar = escrever outra implementação de `Transmissor` e apontar `index.ts` para ela; nada mais
 * na plataforma muda.
 *
 * Tudo que identifica a empresa (UF, CNPJ, ambiente, certificado) vai A CADA chamada: o transmissor
 * não guarda nada, e cada organização usa o próprio emitente e certificado (multiempresa).
 */

export type AmbienteFiscal = "homologacao" | "producao";

export const UFS: readonly string[] = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

/** Certificado A1: o .pfx em base64 e a senha. Só existe em memória, do Vault até o transmissor. */
export type CertificadoA1 = { pfx: string; senha: string };

/** Dados públicos do certificado (o servidor guarda estes; o arquivo e a senha vão para o cofre). */
export type DadosCertificado = { titular: string | null; cnpj: string | null; validade: string; inicio: string; emissor: string | null };

/** Quem fala com a SEFAZ nesta chamada. */
export type Credenciais = { uf: string; cnpj: string; ambiente: AmbienteFiscal; certificado: CertificadoA1 };

/** Resposta da SEFAZ com o código e o motivo à vista; `bruto` é o retorno completo, para guardar. */
export type RespostaSefaz = { cStat: string | null; motivo: string | null; bruto: unknown };

export type ResultadoValidacao = {
  success: boolean;
  message?: string;
  errors?: { raw?: string; humanized?: string; message?: string }[];
};

export type EventoNFe =
  | { tipo: "cancelamento"; chave: string; protocolo: string; justificativa: string }
  | { tipo: "carta"; chave: string; correcao: string; sequencia: number }
  | { tipo: "ciencia"; chave: string };

export type FaixaInutilizar = { ano: number; serie: number; inicio: number; fim: number; justificativa: string };

/** Um documento da distribuição (nota de terceiro contra o nosso CNPJ), como veio da SEFAZ. */
export type DocumentoDistribuido = { nsu: string | null; schema: string | null; xml: string };

export type ResultadoDistribuicao = {
  /** 138 = há documentos; 137 = nenhum documento novo (esperar 1 hora para consultar de novo). */
  cStat: string;
  motivo: string | null;
  ultimoNsu: string | null;
  maxNsu: string | null;
  documentos: DocumentoDistribuido[];
};

export interface Transmissor {
  /** Nome da implementação, para registro (ex.: "servico-nfewizard"). */
  readonly nome: string;
  status(c: Credenciais): Promise<RespostaSefaz>;
  /** Abre o .pfx com a senha (confere a senha) e devolve titular, CNPJ e validade. */
  certificado(certificado: CertificadoA1): Promise<DadosCertificado>;
  /** Esquema oficial (sem certificado). */
  validar(xml: string): Promise<ResultadoValidacao>;
  autorizar(c: Credenciais, xml: string): Promise<RespostaSefaz>;
  consultar(c: Credenciais, chave: string): Promise<RespostaSefaz>;
  evento(c: Credenciais, evento: EventoNFe): Promise<RespostaSefaz>;
  inutilizar(c: Credenciais, faixa: FaixaInutilizar): Promise<RespostaSefaz>;
  distribuicao(c: Credenciais, pedido: { ultimoNsu: string } | { chave: string }): Promise<ResultadoDistribuicao>;
  /** Cadastro de contribuinte na SEFAZ (IE, endereço) pelo CNPJ. */
  cadastro(c: Credenciais, consulta: { cnpj: string; uf: string }): Promise<RespostaSefaz>;
  /** XML autorizado → PDF do DANFE (sem certificado). */
  danfe(xml: string): Promise<Buffer>;
}

/** Códigos de erro do transmissor que a plataforma trata de forma própria. */
export type CodigoErroTransmissor =
  | "NAO_CONFIGURADO" // falta TRANSMISSOR_URL ou o segredo
  | "INDISPONIVEL" // rede caiu ou o serviço não respondeu
  | "NAO_AUTORIZADO" // segredo errado
  | "CONSUMO_INDEVIDO" // SEFAZ bloqueou por excesso de consultas: recuar 1 hora
  | "PEDIDO_INVALIDO" // dado faltando ou errado no pedido
  | "FALHA"; // a SEFAZ ou a biblioteca recusou

export class ErroTransmissor extends Error {
  readonly codigo: CodigoErroTransmissor;
  readonly detalhe?: string;
  constructor(codigo: CodigoErroTransmissor, mensagem: string, detalhe?: string) {
    super(mensagem);
    this.name = "ErroTransmissor";
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}
