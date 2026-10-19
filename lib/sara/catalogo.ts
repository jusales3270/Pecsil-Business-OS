import { link, type Fonte } from "./base.ts";
import { LEITORES_MATERIAIS } from "./agentes/almoxarifado.ts";

/**
 * Catálogo da consulta genérica da SARA (consultar_dados): as tabelas de cada módulo,
 * com as colunas que podem ser lidas, filtradas e somadas. É o que dá à SARA acesso ao
 * módulo inteiro, e não só às perguntas que alguém previu numa consulta pronta.
 *
 * Regras:
 *  - cada tabela exige uma das funcionalidades da tela dela (nível "ver"); o RLS do banco
 *    confere de novo, com as permissões de quem pergunta;
 *  - ficam FORA as colunas de dado pessoal ou sensível (CPF/CNPJ, contato, documento, XML,
 *    linha digitável, foto, dado clínico) — e o filtro de dado pessoal roda no resultado;
 *  - `rel` troca um id por um nome legível (via chave estrangeira).
 */

export type TipoColuna = "texto" | "numero" | "data" | "logico";
export type Relacao = { tabela: string; fk: string; campo: string };
export type TabelaCatalogo = {
  tabela: string;
  modulo: string;
  rotulo: string;
  descricao: string;
  exige: string[];
  /** Coluna de data usada no "período" quando o pedido não diz outra. */
  data?: string;
  colunas: Record<string, TipoColuna>;
  rel?: Record<string, Relacao>;
  /** Colunas de lista fechada: código → nome da tela. A saída vem com o nome; o filtro aceita os dois. */
  opcoes?: Record<string, Record<string, string>>;
  /** Filtro que sempre vale (ex.: só o que não é sigiloso). */
  fixo?: { campo: string; op: "igual" | "vazio"; valor?: string | boolean }[];
  fonte: Fonte;
};

const AUSENCIA = { vacation: "Férias", time_bank: "Banco de horas", medical_certificate: "Atestado médico", leave: "Licença", attendance_statement: "Consulta ou exame (declaração de comparecimento)", family_care: "Acompanhamento de familiar", occupational_exam: "Exame ocupacional", legal_leave: "Ausência legal", justified_absence: "Ausência justificada", inss_leave: "Afastamento INSS", work_accident: "Acidente de trabalho", maternity_leave: "Licença-maternidade" };
const SITUACAO_AUSENCIA = { pending: "Pendente", under_review: "Em análise", approved: "Aprovada", rejected: "Recusada", registered: "Registrada" };
const SST = { category: { exam: "Exame", training: "Treinamento", ppe: "EPI", incident: "Ocorrência" }, status: { compliant: "Conforme", due_soon: "A vencer", overdue: "Vencido", scheduled: "Programado", under_review: "Em análise" }, risk: { critical: "Crítico", attention: "Atenção", regular: "Regular" } };
const DIRECAO = { payable: "A pagar", receivable: "A receber" };
const PARCELA = { pending: "Em aberto", partially_settled: "Paga em parte", settled: "Quitada", overdue: "Vencida", cancelled: "Cancelada" };
const TITULO = { draft: "Rascunho", pending_approval: "Em aprovação", approved: "Em aberto", partially_settled: "Pago em parte", settled: "Quitado", overdue: "Vencido", cancelled: "Cancelado" };

const f = (modulo: string, rotuloModulo: string, secao: string): Fonte => ({ rotulo: `${rotuloModulo} › ${secao}`, link: link(modulo, secao) });

export const CATALOGO: TabelaCatalogo[] = [
  // ---------------- RH ----------------
  {
    tabela: "employees", modulo: "rh", rotulo: "colaboradores (CLT)", descricao: "Colaboradores CLT: setor, função, admissão, desligamento, ativo.",
    exige: ["rh.colaboradores", "rh.relatorios"], data: "admission_date",
    colunas: { full_name: "texto", employee_number: "texto", admission_date: "data", termination_date: "data", active: "logico" },
    rel: { setor: { tabela: "departments", fk: "department_id", campo: "name" }, funcao: { tabela: "positions", fk: "position_id", campo: "name" } },
    fonte: f("rh", "RH", "Colaboradores"),
  },
  {
    tabela: "rh_absences", modulo: "rh", rotulo: "férias e ausências", descricao: "Férias, faltas, atestados e afastamentos por colaborador (início, fim, dias, horas, situação). Sem o motivo clínico.",
    exige: ["rh.ferias"], data: "start_date",
    colunas: { absence_type: "texto", start_date: "data", end_date: "data", days: "numero", hours: "numero", status: "texto", day_part: "texto" },
    rel: { colaborador: { tabela: "employees", fk: "employee_id", campo: "full_name" }, setor: { tabela: "departments", fk: "department_id", campo: "name" } },
    opcoes: { absence_type: AUSENCIA, status: SITUACAO_AUSENCIA },
    fonte: f("rh", "RH", "Férias e ausências"),
  },
  {
    tabela: "rh_vacation_balances", modulo: "rh", rotulo: "saldos de férias", descricao: "Períodos aquisitivos: dias de direito, gozados, programados, vendidos e o vencimento.",
    exige: ["rh.ferias"], data: "expires_at",
    colunas: { acquisition_start: "data", acquisition_end: "data", entitled_days: "numero", taken_days: "numero", scheduled_days: "numero", pecuniary_days: "numero", expires_at: "data" },
    rel: { colaborador: { tabela: "employees", fk: "employee_id", campo: "full_name" } },
    fonte: f("rh", "RH", "Férias e ausências"),
  },
  {
    tabela: "rh_sst_records", modulo: "rh", rotulo: "exames e treinamentos (SST)", descricao: "Exames, treinamentos e ocorrências de saúde e segurança: vencimento, conclusão, situação, risco. Só os não sigilosos.",
    exige: ["rh.sst"], data: "due_date",
    colunas: { category: "texto", title: "texto", due_date: "data", completed_at: "data", status: "texto", risk: "texto" },
    rel: { colaborador: { tabela: "employees", fk: "employee_id", campo: "full_name" }, setor: { tabela: "departments", fk: "department_id", campo: "name" } },
    opcoes: SST,
    fixo: [{ campo: "clinical_confidential", op: "igual", valor: false }],
    fonte: f("rh", "RH", "Saúde e segurança"),
  },
  {
    tabela: "rh_ppe_deliveries", modulo: "rh", rotulo: "entregas de EPI", descricao: "Entregas de EPI: item, quantidade, data de entrega e assinatura, por colaborador.",
    exige: ["rh.sst"], data: "delivered_on",
    colunas: { quantity: "numero", delivered_on: "data", signed_on: "data" },
    rel: { colaborador: { tabela: "employees", fk: "employee_id", campo: "full_name" }, epi: { tabela: "rh_ppe_items", fk: "item_id", campo: "name" } },
    fonte: f("rh", "RH", "Saúde e segurança"),
  },
  {
    tabela: "rh_holidays", modulo: "rh", rotulo: "feriados", descricao: "Feriados e pontos facultativos (data, nome, abrangência, folga).",
    exige: ["rh.feriados", "rh.colaboradores", "rh.ferias"], data: "holiday_date",
    colunas: { holiday_date: "data", name: "texto", scope: "texto", location: "texto", day_off: "logico" },
    fonte: f("rh", "RH", "Feriados"),
  },
  {
    tabela: "terceiros_quadro", modulo: "rh", rotulo: "quadro de terceiros", descricao: "Prestadores (terceiros) no quadro: nome, ativo, quando entrou e saiu do quadro.",
    exige: ["rh.terceiros", "portaria.terceiros"], data: "incluido_em",
    colunas: { nome: "texto", ativo: "logico", incluido_em: "data", removido_em: "data" },
    fonte: f("rh", "RH", "Colaboradores"),
  },
  // ---------------- Portaria ----------------
  {
    tabela: "terceiros", modulo: "portaria", rotulo: "entradas e saídas de terceiros", descricao: "Cada entrada/saída de terceiro pela Portaria: data, hora de entrada e de saída e minutos trabalhados (0 enquanto não saiu). Para horas, some minutos_trabalhados e divida por 60.",
    exige: ["portaria.terceiros", "rh.terceiros"], data: "data",
    colunas: { nome: "texto", data: "data", hora_entrada: "texto", hora_saida: "texto", minutos_trabalhados: "numero" },
    fonte: f("portaria", "Portaria", "terceiros"),
  },
  {
    tabela: "visitas", modulo: "portaria", rotulo: "visitas", descricao: "Visitas: data, empresa, visitante, responsável, entrada, saída, tipo, nota fiscal e valor (sem documento nem contato).",
    exige: ["portaria.visitas"], data: "data",
    colunas: { data: "data", empresa: "texto", visitante: "texto", responsavel: "texto", horario_entrada: "texto", horario_saida: "texto", descricao: "texto", placa_veiculo: "texto", nota_fiscal: "texto", valor_nfe: "numero" },
    fonte: f("portaria", "Portaria", "visitas"),
  },
  {
    tabela: "frota", modulo: "portaria", rotulo: "frota", descricao: "Saídas e retornos dos veículos: responsável, veículo, destino, km rodados, nota fiscal e valor.",
    exige: ["portaria.veiculos"], data: "data",
    colunas: { data: "data", responsavel: "texto", veiculo: "texto", horario_saida: "texto", data_retorno: "data", horario_retorno: "texto", km_rodados: "numero", destino: "texto", nota_fiscal: "texto", valor_nfe: "numero" },
    fonte: f("portaria", "Portaria", "veiculos"),
  },
  // ---------------- Financeiro ----------------
  {
    tabela: "finance_installments", modulo: "financeiro", rotulo: "parcelas a pagar e a receber", descricao: "Parcelas dos títulos: vencimento, valor, valor baixado, situação. Use o filtro direcao (payable = a pagar, receivable = a receber).",
    exige: ["financeiro.pagar", "financeiro.receber"], data: "due_date",
    colunas: { installment_number: "numero", due_date: "data", amount: "numero", settled_amount: "numero", status: "texto" },
    rel: { fornecedor_cliente: { tabela: "finance_titles", fk: "title_id", campo: "counterparty_name" }, direcao: { tabela: "finance_titles", fk: "title_id", campo: "direction" }, descricao: { tabela: "finance_titles", fk: "title_id", campo: "description" } },
    opcoes: { status: PARCELA, direcao: DIRECAO },
    fonte: f("financeiro", "Financeiro", "Contas a pagar"),
  },
  {
    tabela: "finance_titles", modulo: "financeiro", rotulo: "títulos", descricao: "Títulos a pagar (direction=payable) e a receber (receivable): fornecedor/cliente, documento, descrição, emissão, competência, valor, situação, conta e centro de custo.",
    exige: ["financeiro.pagar", "financeiro.receber", "financeiro.fluxo", "financeiro.relatorios", "financeiro.bancos"], data: "issue_date",
    colunas: { direction: "texto", counterparty_name: "texto", counterparty_group: "texto", document_number: "texto", description: "texto", issue_date: "data", competence_date: "data", original_amount: "numero", status: "texto", is_forecast: "logico", is_historical: "logico" },
    rel: { conta: { tabela: "finance_chart_accounts", fk: "chart_account_id", campo: "name" }, centro_de_custo: { tabela: "finance_cost_centers", fk: "cost_center_id", campo: "name" } },
    opcoes: { direction: DIRECAO, status: TITULO },
    fonte: f("financeiro", "Financeiro", "Contas a pagar"),
  },
  {
    tabela: "finance_settlements", modulo: "financeiro", rotulo: "baixas (pagamentos e recebimentos)", descricao: "Baixas: data, valor, desconto, juros, multa, forma de pagamento (estornadas têm reversed_at).",
    exige: ["financeiro.pagar", "financeiro.bancos"], data: "settlement_date",
    colunas: { settlement_date: "data", amount: "numero", discount: "numero", interest: "numero", penalty: "numero", payment_method: "texto", reversed_at: "data" },
    rel: { banco: { tabela: "finance_bank_accounts", fk: "bank_account_id", campo: "bank_name" } },
    fonte: f("financeiro", "Financeiro", "Contas a pagar"),
  },
  {
    tabela: "finance_bank_entries", modulo: "financeiro", rotulo: "lançamentos do extrato", descricao: "Lançamentos dos extratos bancários: data, entrada/saída, valor, histórico, contraparte, conciliação.",
    exige: ["financeiro.bancos"], data: "booking_date",
    colunas: { booking_date: "data", direction: "texto", amount: "numero", description: "texto", counterparty_name: "texto", category: "texto", reconciliation_status: "texto" },
    opcoes: { direction: { credit: "Entrada", debit: "Saída" }, reconciliation_status: { pending: "Pendente", matched: "Conciliado", partial: "Parcial", ignored: "Ignorado" } },
    rel: { banco: { tabela: "finance_bank_accounts", fk: "bank_account_id", campo: "bank_name" } },
    fonte: f("financeiro", "Financeiro", "Bancos e conciliação"),
  },
  // ---------------- Compras ----------------
  {
    tabela: "cotacoes", modulo: "compras", rotulo: "cotações e ordens de compra", descricao: "Cotações (e OCs aprovadas): fornecedor, produto, quantidade, valor unitário, situação, divisão, decisão, prazo, frete, origem.",
    exige: ["compras.cotacoes", "compras.aprovacoes", "compras.realizadas"], data: "created_at",
    colunas: { id: "numero", fornecedor: "texto", produto: "texto", quantidade: "numero", unidade: "texto", valor_unit: "numero", status: "texto", divisao: "texto", aprovado_por: "texto", data_decisao: "data", prazo_entrega: "data", frete_valor: "numero", origem: "texto", created_at: "data" },
    fixo: [{ campo: "deleted_at", op: "vazio" }],
    fonte: f("compras", "Compras", "cotacoes"),
  },
  {
    tabela: "compras", modulo: "compras", rotulo: "compras realizadas", descricao: "Compras realizadas: fornecedor, produto, quantidade, valor unitário, total, nota fiscal, data da compra.",
    exige: ["compras.realizadas", "compras.cotacoes"], data: "data_compra",
    colunas: { cotacao_id: "numero", fornecedor: "texto", produto: "texto", quantidade: "numero", unidade: "texto", valor_unit: "numero", total: "numero", nf: "texto", data_compra: "data" },
    rel: { centro_de_custo: { tabela: "finance_cost_centers", fk: "cost_center_id", campo: "name" } },
    fonte: f("compras", "Compras", "realizadas"),
  },
  {
    tabela: "suppliers", modulo: "compras", rotulo: "fornecedores", descricao: "Cadastro de fornecedores: nome, razão social, fantasia, cidade, UF, categoria, condição de pagamento, ativo (sem CNPJ nem contato).",
    exige: ["compras.fornecedores", "compras.cotacoes"], colunas: { name: "texto", legal_name: "texto", trade_name: "texto", city: "texto", state: "texto", category: "texto", payment_terms: "texto", active: "logico" },
    fonte: f("compras", "Compras", "fornecedores"),
  },
  // ---------------- Almoxarifado ----------------
  {
    tabela: "receipts", modulo: "almoxarifado", rotulo: "recebimentos (notas de entrada)", descricao: "Recebimentos de material: fornecedor, número da nota, emissão, recebido em, valor, ICMS, IPI, divisão, divergência.",
    exige: ["almoxarifado.recebimento", "almoxarifado.solicitacoes", "financeiro.pagar", "fiscal.icms"], data: "recebido_em",
    colunas: { numero: "numero", fornecedor: "texto", nf_numero: "texto", emissao: "data", recebido_em: "data", valor_total: "numero", icms: "numero", ipi: "numero", divisao: "texto", divergencia: "logico", divergencia_motivo: "texto", received_by_name: "texto" },
    fonte: f("almoxarifado", "Almoxarifado", "recebimento"),
  },
  {
    tabela: "material_requests", modulo: "almoxarifado", rotulo: "pedidos de material", descricao: "Pedidos de material: número, divisão, urgência, situação, origem (almoxarifado/fundição), quem pediu, precisa até.",
    exige: ["almoxarifado.solicitacoes", "almoxarifado.recebimento", "fundicao.pedidos", "compras.cotacoes", "compras.aprovacoes"], data: "created_at",
    colunas: { numero: "numero", divisao: "texto", urgencia: "texto", status: "texto", origem: "texto", requested_by_name: "texto", precisa_ate: "data", created_at: "data" },
    fonte: f("almoxarifado", "Almoxarifado", "solicitacoes"),
  },
  {
    tabela: "materials", modulo: "almoxarifado", rotulo: "catálogo de materiais", descricao: "Catálogo de materiais: código, descrição, família, grupo, unidade, NCM, custo de referência, ativo.",
    exige: LEITORES_MATERIAIS, colunas: { codigo: "texto", descricao: "texto", familia: "texto", grupo_nome: "texto", subgrupo: "texto", unidade: "texto", ncm: "texto", custo_referencia: "numero", controla_estoque: "logico", ativo: "logico" },
    fonte: f("almoxarifado", "Almoxarifado", "materiais"),
  },
  // ---------------- Fiscal ----------------
  {
    tabela: "fiscal_icms_entries", modulo: "fiscal", rotulo: "notas de entrada (ICMS)", descricao: "Notas de entrada do controle de ICMS: competência, emissão, fornecedor, número, valor, base, ICMS, IPI, área (fundição/usinagem/administrativo).",
    exige: ["fiscal.icms"], data: "competencia",
    colunas: { competencia: "data", emitida: "data", recebida: "data", fornecedor: "texto", nfe: "texto", valor: "numero", base_icms: "numero", icms: "numero", ipi: "numero", tipo: "texto", fundicao: "logico", usinagem: "logico", administrativo: "logico", lancado: "logico" },
    fonte: f("fiscal", "Fiscal", "ICMS"),
  },
  {
    tabela: "fiscal_nfe", modulo: "fiscal", rotulo: "notas fiscais emitidas", descricao: "NF-e emitidas: ambiente, situação, série, número, emissão, natureza, destinatário, valor.",
    exige: ["fiscal.nfe"], data: "emissao",
    colunas: { ambiente: "texto", situacao: "texto", serie: "numero", numero: "numero", emissao: "data", natureza: "texto", destinatario_nome: "texto", valor_total: "numero", autorizada_em: "data" },
    fonte: f("fiscal", "Fiscal", "NF-e"),
  },
  {
    tabela: "fiscal_dfe", modulo: "fiscal", rotulo: "notas recebidas da SEFAZ", descricao: "Notas emitidas contra a empresa (distribuição da SEFAZ): emitente, valor, emissão, situação, manifestação.",
    exige: ["fiscal.nfe", "fiscal.icms"], data: "emissao",
    colunas: { emitente_nome: "texto", valor: "numero", emissao: "data", situacao: "texto", manifestacao: "texto" },
    fonte: f("fiscal", "Fiscal", "NF-e"),
  },
  // ---------------- Comercial ----------------
  {
    tabela: "sales_quotes", modulo: "comercial", rotulo: "orçamentos", descricao: "Orçamentos: número, cliente, data, validade, situação, pedido do cliente, prazo, motivo de perda, ganho em.",
    exige: ["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], data: "data_orcamento",
    colunas: { numero: "numero", data_orcamento: "data", validade: "data", situacao: "texto", pedido_cliente: "texto", condicao_pagamento: "texto", prazo_entrega: "data", motivo_perda: "texto", ganho_em: "data", treino: "logico" },
    rel: { cliente: { tabela: "customers", fk: "customer_id", campo: "name" } },
    fonte: f("comercial", "Comercial", "orcamentos"),
  },
  {
    tabela: "products", modulo: "comercial", rotulo: "produtos", descricao: "Produtos (peças): código, descrição, tipo de peça, NCM, material, desenho, cliente, ativo.",
    exige: ["comercial.produtos", "comercial.orcamentos", "producao.entrada", "fiscal.nfe"], colunas: { codigo: "texto", descricao: "texto", tipo_peca: "texto", ncm: "texto", material: "texto", desenho_codigo: "texto", peso_liquido: "numero", ativo: "logico" },
    rel: { cliente: { tabela: "customers", fk: "customer_id", campo: "name" } },
    fonte: f("comercial", "Comercial", "produtos"),
  },
  {
    tabela: "customers", modulo: "comercial", rotulo: "clientes", descricao: "Clientes: nome, município, UF, ativo (sem CNPJ nem contato).",
    exige: ["comercial.clientes", "comercial.orcamentos"], colunas: { name: "texto", municipio: "texto", uf: "texto", active: "logico" },
    fonte: f("comercial", "Comercial", "clientes"),
  },
  // ---------------- Produção ----------------
  {
    tabela: "production_orders", modulo: "producao", rotulo: "ordens de serviço", descricao: "OS espelhadas da Forja: código, cliente, artigo, tipo de peça, quantidade, prazo, abertura, prioridade, situação, lotes. As removidas da Forja têm removed_from_source_at.",
    exige: ["producao.os", "comercial.funil", "comercial.cobranca", "financeiro.receber"], data: "due_date",
    colunas: { code: "texto", customer_name: "texto", article_code: "texto", article_description: "texto", product_type: "texto", quantity: "numero", due_date: "data", opened_at: "data", priority: "texto", status: "texto", lots_count: "numero", removed_from_source_at: "data" },
    fonte: f("producao", "Produção", "Ordens de serviço"),
  },
];

export const tabelaDoCatalogo = (nome: string) => CATALOGO.find((t) => t.tabela === nome);
