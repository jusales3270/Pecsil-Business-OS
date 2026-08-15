// ============================================================================
// Pecsil Business OS — contrato de dados do RH
//
// Espelha o padrão do Financeiro (lib/data/finance.ts): tipos partilhados entre
// cliente e servidor, mais um snapshot demonstrativo usado como fallback quando
// não há sessão ou conexão. O repository (rh-repository.ts) preenche o mesmo
// formato a partir das tabelas rh_* reais.
//
// v1 cobre o que o painel do RH consome: indicadores, ausências recentes,
// planos de benefício e registros de SST não-clínicos.
// ============================================================================

export type RhAbsenceType = "vacation" | "time_bank" | "medical_certificate" | "leave";
export type RhAbsenceStatus =
  | "pending" | "under_review" | "approved" | "rejected" | "registered";

export type RhAbsence = {
  id: string;
  employeeName: string;
  department: string | null;
  unit: string | null;
  type: RhAbsenceType;
  startDate: string;
  endDate: string;
  days: number;
  status: RhAbsenceStatus;
  hasConflict: boolean;
  reason: string | null;
  requestedAt: string;
};

export type RhBenefitCategory = "food" | "health" | "mobility" | "protection";

export type RhBenefitPlan = {
  id: string;
  name: string;
  category: RhBenefitCategory;
  provider: string | null;
  monthlyCost: number;
  members: number;
  eligible: number;
  employeeContribution: string | null;
  eligibilityRule: string | null;
  status: "active" | "under_review" | "suspended";
};

export type RhSstCategory = "exam" | "training" | "ppe" | "incident";
export type RhSstStatus =
  | "compliant" | "due_soon" | "overdue" | "scheduled" | "under_review";
export type RhSstRisk = "critical" | "attention" | "regular";

export type RhSstRecord = {
  id: string;
  employeeName: string;
  department: string | null;
  unit: string | null;
  category: RhSstCategory;
  title: string;
  dueDate: string | null;
  status: RhSstStatus;
  risk: RhSstRisk;
  note: string | null;
  sensitive: boolean;
};

export type RhDepartmentShare = {
  name: string;
  people: number;
  percentage: number;
};

// Colaborador selecionável em formulários (ex.: nova solicitação de ausência).
export type RhEmployeeOption = {
  id: string;
  name: string;
  department: string | null;
  unit: string | null;
};

export type RhSummary = {
  employees: number;
  activeEmployees: number;
  pendingAbsences: number;
  scheduledVacationDays: number;
  sstAlerts: number;
  benefitMonthlyCost: number;
};

export type RhSnapshot = {
  source: "demo" | "supabase";
  organizationId: string | null;
  summary: RhSummary;
  absences: RhAbsence[];
  benefitPlans: RhBenefitPlan[];
  sstRecords: RhSstRecord[];
  departmentShares: RhDepartmentShare[];
  employees: RhEmployeeOption[];
  loadedAt: string;
};

// Snapshot demonstrativo — o mesmo espírito dos mocks já usados no hr-module,
// exibido enquanto não há sessão autenticada ou conexão com o Supabase.
export const demoRhSnapshot: RhSnapshot = {
  source: "demo",
  organizationId: null,
  summary: {
    employees: 248,
    activeEmployees: 246,
    pendingAbsences: 4,
    scheduledVacationDays: 18,
    sstAlerts: 12,
    benefitMonthlyCost: 124230,
  },
  absences: [
    { id:"demo-abs-1", employeeName:"Mariana Costa", department:"Recursos Humanos", unit:"Matriz Boituva", type:"vacation", startDate:"2026-08-15", endDate:"2026-08-29", days:15, status:"pending", hasConflict:false, reason:"Período aquisitivo 2025/2026", requestedAt:"14 jul 2026 · 09:18" },
    { id:"demo-abs-2", employeeName:"Lucas Martins", department:"Produção", unit:"Unidade Industrial", type:"time_bank", startDate:"2026-07-18", endDate:"2026-07-18", days:1, status:"pending", hasConflict:true, reason:"Compensação de banco de horas", requestedAt:"15 jul 2026 · 07:42" },
    { id:"demo-abs-3", employeeName:"Ana Souza", department:"Administrativo", unit:"Matriz Boituva", type:"medical_certificate", startDate:"2026-07-12", endDate:"2026-07-13", days:2, status:"registered", hasConflict:false, reason:"Atestado médico", requestedAt:"12 jul 2026 · 16:05" },
    { id:"demo-abs-4", employeeName:"Ricardo Alves", department:"Produção", unit:"Unidade Industrial", type:"vacation", startDate:"2026-09-02", endDate:"2026-09-16", days:15, status:"under_review", hasConflict:true, reason:"Sobreposição com escala", requestedAt:"10 jul 2026 · 11:30" },
  ],
  benefitPlans: [
    { id:"demo-ben-1", name:"Vale-alimentação", category:"food", provider:"Cartão corporativo", monthlyCost:124230, members:246, eligible:246, employeeContribution:"Sem coparticipação", eligibilityRule:"Elegível para todos os colaboradores ativos.", status:"active" },
    { id:"demo-ben-2", name:"Plano de saúde", category:"health", provider:"Unimed", monthlyCost:98600, members:218, eligible:246, employeeContribution:"Coparticipação de 20%", eligibilityRule:"Adesão voluntária após período de experiência.", status:"active" },
    { id:"demo-ben-3", name:"Vale-transporte", category:"mobility", provider:"Vale-transporte SP", monthlyCost:41200, members:172, eligible:246, employeeContribution:"Desconto legal de 6%", eligibilityRule:"Conforme deslocamento declarado.", status:"active" },
  ],
  sstRecords: [
    { id:"demo-sst-1", employeeName:"Equipe Produção", department:"Produção", unit:"Unidade Industrial", category:"exam", title:"ASO periódico próximo do vencimento", dueDate:"2026-08-30", status:"due_soon", risk:"attention", note:"Exame periódico na janela de renovação.", sensitive:true },
    { id:"demo-sst-2", employeeName:"Célula Usinagem", department:"Produção", unit:"Unidade Industrial", category:"training", title:"NR-12 · reciclagem", dueDate:"2026-07-29", status:"overdue", risk:"critical", note:"Certificado vencido; afastar da atividade.", sensitive:false },
    { id:"demo-sst-3", employeeName:"Camila Ferreira", department:"Qualidade", unit:"Unidade Industrial", category:"ppe", title:"Entrega de EPI registrada", dueDate:null, status:"compliant", risk:"regular", note:"Entrega confirmada.", sensitive:false },
  ],
  departmentShares: [
    { name:"Produção", people:96, percentage:39 },
    { name:"Manutenção", people:24, percentage:10 },
    { name:"Administrativo", people:22, percentage:9 },
    { name:"Qualidade", people:18, percentage:7 },
    { name:"Demais áreas", people:86, percentage:35 },
  ],
  employees: [
    { id:"demo-emp-1", name:"Mariana Costa", department:"Recursos Humanos", unit:"Matriz Boituva" },
    { id:"demo-emp-2", name:"Lucas Martins", department:"Produção", unit:"Unidade Industrial" },
    { id:"demo-emp-3", name:"Ana Souza", department:"Administrativo", unit:"Matriz Boituva" },
    { id:"demo-emp-4", name:"Ricardo Alves", department:"Produção", unit:"Unidade Industrial" },
    { id:"demo-emp-5", name:"Camila Ferreira", department:"Qualidade", unit:"Unidade Industrial" },
  ],
  loadedAt: new Date(0).toISOString(),
};
