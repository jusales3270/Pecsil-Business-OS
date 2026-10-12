/**
 * Termo de confidencialidade do Portal do contador. Quem é do escritório aceita antes do primeiro
 * uso; o aceite (pessoa, versão, data) fica gravado e vai para a auditoria. Mudou o texto, muda a
 * versão — e a função `fiscal_portal_exigir` no banco passa a exigir a nova.
 * O nome da empresa vem da organização (multiempresa), nunca fixo.
 */
export const TERMO_VERSAO = "v1-2026-10";

export function termoDoPortal(empresa: string): string[] {
  return [
    `Este acesso é pessoal e intransferível e serve só para prestar os serviços contábeis contratados por ${empresa}.`,
    "Os documentos e as informações do portal são confidenciais. Usá-los só para esse fim, sem compartilhar com terceiros nem guardar além do necessário ou do prazo legal.",
    `Pela Lei Geral de Proteção de Dados (Lei 13.709/2018), o escritório trata esses dados como operador, em nome de ${empresa}, que é a controladora.`,
    "Tudo o que é aberto, baixado e enviado no portal fica registrado, com pessoa, data e hora.",
    "Em caso de perda, vazamento ou acesso indevido, avisar a empresa imediatamente.",
    "A empresa pode suspender o acesso ou definir uma data de validade a qualquer momento.",
  ];
}
