/**
 * Dados fixos da PecSil que saem nos documentos para fora (ordem de compra).
 * Copiados do modelo de Ordem de Compra do sistema antigo (nº 14805, out/2026).
 * O banco só guarda razão social e CNPJ da organização; endereço, IE e
 * telefones ficam aqui até existir um cadastro da empresa.
 */
export const EMPRESA_PECSIL = {
  razaoSocial: "PECSIL METALÚRGICA E FUNDIÇÃO LTDA",
  cnpj: "46.839.106/0001-84",
  ie: "387.016.885.115",
  endereco: "RUA FRANCISCO FARIA, 243 - VILA PROGRESSO",
  cidade: "ITU / SP - CEP: 13313-531",
  telefones: "(11) 4013-4870 / (11) 4023-2301",
  site: "www.pecsil.com.br",
  emailNfe: "nfe@pecsil.com.br",
} as const;

/** Notas do rodapé da Ordem de Compra, iguais às do modelo. */
export const NOTAS_ORDEM_COMPRA = [
  "Fazer constar o número deste pedido de compra em todas as correspondências, documentos de remessa e fatura relacionados.",
  `Enviar nota fiscal eletrônica e arquivo xml para: ${EMPRESA_PECSIL.emailNfe}`,
  "Horário de recebimento: De segunda a quinta das 7h30 às 11h30 e das 13h00 às 16h30 e sexta das 7h30 às 11h30 e das 13h00 às 15h30",
  "NÃO RECEBEMOS MATERIAIS NOS 3 ÚLTIMOS DIAS ÚTEIS DO MÊS SEM AUTORIZAÇÃO PRÉVIA. QUALQUER EVENTUAL TENTATIVA DE ENTREGA SEM AUTORIZAÇÃO SERÁ RECUSADA.",
] as const;
