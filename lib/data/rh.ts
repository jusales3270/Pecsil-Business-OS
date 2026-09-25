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

export type RhAbsenceType =
  | "vacation" | "time_bank" | "medical_certificate" | "leave"
  | "attendance_statement" | "family_care" | "occupational_exam" | "legal_leave"
  | "justified_absence" | "inss_leave" | "work_accident" | "maternity_leave";
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
  /** Ausência em horas (days = 0). */
  hours: number | null;
  /** Ausência de meio período (days = 0). */
  dayPart: "manha" | "tarde" | null;
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

export type RhBenefitRequestAction = "enroll" | "change" | "cancel" | "add_dependent";
export type RhBenefitRequestStatus = "pending" | "under_review" | "approved" | "rejected";

export type RhBenefitRequest = {
  id: string;
  employeeName: string;
  department: string | null;
  planName: string;
  action: RhBenefitRequestAction;
  status: RhBenefitRequestStatus;
  reason: string | null;
  effectiveDate: string | null;
  requestedAt: string;
};

export type RhDocumentSignature = "signed" | "pending" | "not_required";

export type RhDocument = {
  id: string;
  title: string;
  category: string;
  employeeName: string | null;
  version: string;
  objectPath: string;
  reviewDueAt: string | null;
  signature: RhDocumentSignature | null;
  sensitive: boolean;
  updatedAt: string;
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
  /** Períodos com saldo cujo concessivo vence nos próximos 60 dias. */
  vacationsDueSoon: number;
  /** Períodos com saldo e concessivo já vencido (férias em dobro). */
  vacationsOverdue: number;
  sstAlerts: number;
  benefitMonthlyCost: number;
};

export type RhSnapshot = {
  source: "demo" | "supabase";
  organizationId: string | null;
  summary: RhSummary;
  absences: RhAbsence[];
  benefitPlans: RhBenefitPlan[];
  benefitRequests: RhBenefitRequest[];
  sstRecords: RhSstRecord[];
  documents: RhDocument[];
  departmentShares: RhDepartmentShare[];
  employees: RhEmployeeOption[];
  loadedAt: string;
};

// Snapshot demonstrativo — o mesmo espírito dos mocks já usados no hr-module,
// exibido enquanto não há sessão autenticada ou conexão com o Supabase.
// Sem sessão ou sem conexão: vazio, nunca cadastro fictício.
export const demoRhSnapshot: RhSnapshot = {
  source: "demo",
  organizationId: null,
  summary: {
    employees: 0,
    activeEmployees: 0,
    pendingAbsences: 0,
    scheduledVacationDays: 0,
    vacationsDueSoon: 0,
    vacationsOverdue: 0,
    sstAlerts: 0,
    benefitMonthlyCost: 0,
  },
  absences: [],
  benefitPlans: [],
  benefitRequests: [],
  sstRecords: [],
  documents: [],
  departmentShares: [],
  employees: [],
  loadedAt: new Date(0).toISOString(),
};
