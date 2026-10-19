/**
 * Auditoria central: o código técnico de cada registro vira uma frase para quem lê
 * ("finance_titles.update" → "Alterou título"). Puro e testável; o que não tiver rótulo aparece
 * com o código mesmo, nunca some.
 */

const OBJETOS: Record<string, string> = {
  finance_titles: "título", finance_settlements: "baixa de título", finance_reconciliations: "conciliação bancária",
  finance_approval_requests: "pedido de aprovação", finance_bank_entries: "lançamento de extrato",
  rh_absences: "afastamento", rh_absence_clinical: "dado clínico de afastamento", rh_ppe_deliveries: "entrega de EPI",
  rh_sst_records: "registro de SST", rh_holidays: "férias", rh_benefit_enrollments: "benefício", rh_benefit_requests: "pedido de benefício",
  products: "produto", product_groups: "grupo de produto", sales_quotes: "orçamento", production_entries: "entrada de produção", customers: "cliente",
  profiles: "usuário", user_roles: "papel de usuário",
};
const VERBOS: Record<string, string> = { insert: "Criou", update: "Alterou", delete: "Excluiu" };

const FIXOS: Record<string, string> = {
  "login.login": "Entrou no sistema",
  "login.logout": "Saiu do sistema",
  "login.user_recovery_requested": "Pediu para recuperar a senha",
  "login.user_modified": "Alterou a própria conta (senha ou e-mail)",
  "acesso.tela": "Abriu a tela",
  "core.access.user.grants_change": "Mudou as permissões de um usuário",
  "core.access.profiles.insert": "Criou usuário",
  "core.access.profiles.update": "Alterou usuário",
  "fiscal_nfe.criada": "Montou nota fiscal (rascunho)",
  "fiscal_nfe.criada_do_orcamento": "Gerou nota fiscal a partir do orçamento",
  "fiscal_nfe.validada": "Validou nota fiscal",
  "fiscal_nfe.enviada": "Enviou nota fiscal para aprovação",
  "fiscal_nfe.devolvida": "Devolveu nota fiscal para correção",
  "fiscal_nfe.autorizada_treino": "Aprovou e transmitiu nota fiscal (treino)",
  "fiscal_nfe.cancelada": "Cancelou nota fiscal",
  "fiscal_nfe.carta": "Registrou carta de correção",
  "fiscal_nfe.descartada": "Descartou nota fiscal",
  "fiscal_nfe.inutilizacao": "Inutilizou numeração de nota",
  "fiscal_nfe.treino_limpo": "Limpou o treino de notas",
  "fiscal_portal.aceite": "Aceitou o termo do Portal do contador",
  "fiscal_portal.acesso": "Abriu o Portal do contador",
  "fiscal_portal.download": "Baixou arquivo do Portal do contador",
  "fiscal_portal.malote_recebido": "Confirmou o recebimento do malote",
  "fiscal_portal.resposta": "Respondeu pendência no Portal do contador",
  "fiscal_portal.situacao": "Mudou a situação da competência",
};

export const FONTES: Record<string, string> = { acao: "Ação", evento: "Evento", login: "Entrada no sistema", tela: "Tela aberta" };

export const MODULOS: Record<string, string> = {
  acesso: "Acessos", core: "Plataforma", "core.access": "Acessos", financeiro: "Financeiro", rh: "Recursos Humanos", fiscal: "Fiscal",
  comercial: "Comercial", compras: "Compras", producao: "Produção", almoxarifado: "Almoxarifado", portaria: "Portaria", cadastros: "Cadastros",
  fundicao: "Fundição", fundacao: "Fundação", plataforma: "Plataforma", ti: "TI",
};

export function rotuloAcao(acao: string): string {
  if (FIXOS[acao]) return FIXOS[acao];
  const [tabela, op] = acao.split(".");
  if (OBJETOS[tabela] && VERBOS[op]) return `${VERBOS[op]} ${OBJETOS[tabela]}`;
  return acao;
}

/** "campo: antes → depois" das alterações gravadas pela auditoria com o que mudou. */
export function oQueMudou(detalhes: Record<string, unknown> | null | undefined, max = 6): string[] {
  const mudou = (detalhes?.mudou ?? null) as Record<string, [unknown, unknown]> | null;
  if (!mudou) return [];
  const vazio = (v: unknown) => (v === null || v === undefined || v === "" ? "(vazio)" : String(v));
  return Object.entries(mudou).slice(0, max).map(([campo, [antes, depois]]) => `${campo.replace(/_/g, " ")}: ${vazio(antes)} → ${vazio(depois)}`);
}
