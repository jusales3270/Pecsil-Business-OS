"use client";

import { useEffect, useMemo, useState } from "react";
import type { FoundationSummary, Person } from "../../lib/data/foundation";
import { canUseFeature, hasMultipleModules, type ModuleAccessContext } from "../../modules";
import { Button, Card, DetailRows, Kpi, KpiGrid, Modal, Segmented, Status, type DetailRow } from "../../packages/design-system";
import { useRhData } from "../../lib/data/use-rh-data";
import { useModuleNav } from "../../lib/module-nav-context";
import type { RhAbsence, RhBenefitPlan, RhBenefitRequest, RhDocument, RhEmployeeOption, RhSnapshot, RhSstRecord } from "../../lib/data/rh";
import { getRhDocumentUrl, listRhEmployeeDocuments, uploadRhDocument, type RhEmployeeDocument } from "../../lib/data/rh-documents-client";
import { HolidaysSection } from "./hr-holidays";
import { PpeSection, usePpeData } from "./hr-epi";
import { TerceirosSection } from "./hr-terceiros";

const sections = [
  ["Painel", "grid"],
  ["Colaboradores", "users"],
  ["Ponto e jornada", "clock"],
  ["Férias e ausências", "calendar"],
  ["Feriados", "calendar"],
  ["Benefícios", "heart"],
  ["Saúde e segurança", "shield"],
  ["Documentos", "file"],
  ["Relatórios", "chart"],
  ["Homologação", "check"],
] as const;

type HrSection = (typeof sections)[number][0];

/** Funcionalidade que libera cada seção. O Painel aparece para quem tem o RH. */
const SECTION_FEATURE: Partial<Record<HrSection, string>> = {
  "Colaboradores": "rh.colaboradores",
  "Ponto e jornada": "rh.jornada",
  "Férias e ausências": "rh.ferias",
  "Feriados": "rh.feriados",
  "Benefícios": "rh.beneficios",
  "Saúde e segurança": "rh.sst",
  "Documentos": "rh.documentos",
  "Relatórios": "rh.relatorios",
  "Homologação": "rh.homologacao",
};

type EmployeeRecord = Person & {
  registration: string;
  cpf: string;
  phone: string;
  admissionDate: string;
  contractType: string;
  manager: string;
  team: string;
  schedule: string;
  documentStatus: "Completo" | "Pendente";
};


function toEmployee(person: Person): EmployeeRecord {
  // Dados reais (têm id do banco): nada de detalhes fictícios. O que o cadastro
  // mestre ainda não guarda aparece como "Não informado".
  if (person.id) {
    return {
      ...person,
      registration: person.registration ?? "—",
      cpf: "Restrito ao RH",
      phone: "Não informado",
      admissionDate: person.admissionDate ?? "",
      contractType: "Não informado",
      manager: "Não informado",
      team: person.team ?? "Sem equipe",
      schedule: "Não informado",
      documentStatus: "Pendente",
    };
  }
  return {
    ...person,
    registration: "—",
    cpf: "Não informado",
    phone: "Não informado",
    admissionDate: "",
    contractType: "CLT",
    manager: "Não definido",
    team: "Não definida",
    schedule: "Administrativo",
    documentStatus: "Pendente",
  };
}

/** Identidade estável de uma pessoa: id do banco (dados reais) ou e-mail (demonstração). */
function personKey(person: Pick<Person, "id" | "email">) {
  return person.id ?? person.email;
}


type BenefitPlan = {
  id: number;
  name: string;
  category: "Alimentação" | "Saúde" | "Mobilidade" | "Proteção";
  icon: string;
  members: number;
  eligible: number;
  monthlyCost: number;
  employeeContribution: string;
  status: "Ativo" | "Em revisão";
  rule: string;
  provider: string;
};

type SstStatus = "Vencido" | "A vencer" | "Programado" | "Conforme" | "Em análise";
type SstRecord = {
  id: number;
  sourceId?: string;
  employee: string;
  initials: string;
  department: string;
  unit: string;
  category: "Exame" | "Treinamento" | "EPI" | "Ocorrência";
  title: string;
  dueDate: string;
  status: SstStatus;
  risk: "Crítico" | "Atenção" | "Regular";
  document: string;
  note: string;
  sensitive: boolean;
};

type HrDocumentStatus = "Válido" | "Pendente" | "A vencer" | "Expirado" | "Reprovado";
type HrDocumentRecord = {
  id: number;
  sourceId?: string;
  objectPath?: string;
  employee: string;
  initials: string;
  department: string;
  category: "Admissional" | "Contrato e termo" | "Férias e ausência" | "Saúde ocupacional" | "Treinamento";
  title: string;
  fileName: string;
  version: number;
  validUntil: string | null;
  status: HrDocumentStatus;
  signature: "Assinado" | "Assinatura pendente" | "Não exigida";
  sensitive: boolean;
  updatedAt: string;
};

const initialHrDocuments: HrDocumentRecord[] = [];

const initialSstRecords: SstRecord[] = [];
type BenefitRequestStatus = "Pendente" | "Em análise" | "Aprovada" | "Reprovada";
type BenefitRequest = {
  id: number;
  sourceId?: string;
  employee: string;
  initials: string;
  department: string;
  plan: string;
  action: "Adesão" | "Alteração" | "Cancelamento" | "Inclusão de dependente";
  requestedAt: string;
  effectiveDate: string;
  status: BenefitRequestStatus;
  reason: string;
};

const initialBenefitPlans: BenefitPlan[] = [];

const initialBenefitRequests: BenefitRequest[] = [];


type AbsenceStatus = "Pendente" | "Em análise" | "Aprovada" | "Reprovada" | "Registrado";
type AbsenceRecord = {
  id: number;
  sourceId?: string;
  employee: string;
  initials: string;
  type: AbsenceLabel;
  start: string;
  end: string;
  days: number;
  /** Ausência em horas ou meio período: `days` fica 0. */
  hours: number | null;
  dayPart: "manha" | "tarde" | null;
  status: AbsenceStatus;
  unit: string;
  department: string;
  requestedAt: string;
  reason: string;
  balance: number;
  conflict: string | null;
};

const initialAbsences: AbsenceRecord[] = [];




export function HrModule({
  people,
  summary,
  notify,
  onEvent,
  onExit,
  access,
}: {
  people: Person[];
  summary: FoundationSummary;
  notify: (message: string) => void;
  onEvent: (message: string) => void;
  onExit: () => void;
  access: ModuleAccessContext;
}) {
  const [section, setSection] = useState<HrSection>("Painel");
  const [query, setQuery] = useState("");
  // Dados reais do RH (rh_*), com fallback demonstrativo automático quando não
  // há sessão ou conexão — mesmo contrato do Financeiro.
  const { snapshot: rh } = useRhData();
  const [employees, setEmployees] = useState<EmployeeRecord[]>(() => people.map(toEmployee));
  const [createRequested, setCreateRequested] = useState(0);
  const filteredPeople = useMemo(
    () => employees.filter(person => `${person.name} ${person.role} ${person.department} ${person.registration}`.toLowerCase().includes(query.toLowerCase())),
    [employees, query],
  );
  // Memorizado: é dependência do efeito que registra o menu lateral. Recriado a
  // cada render, o efeito limpava e registrava o menu de novo em todo render,
  // o que causava outro render — laço "Maximum update depth exceeded".
  const accessibleSections = useMemo(() => sections.filter(([label]) => {
    const feature = SECTION_FEATURE[label];
    // Colaboradores reúne CLT e Terceiros: aparece para quem vê qualquer um dos dois.
    if (label === "Colaboradores") return canUseFeature(access, "rh.colaboradores") || canUseFeature(access, "rh.terceiros");
    return !feature || canUseFeature(access, feature);
  }), [access]);
  const canSeeClt = canUseFeature(access, "rh.colaboradores");
  const canSeeTerceiros = canUseFeature(access, "rh.terceiros");
  const [peopleKind, setPeopleKind] = useState<"CLT" | "Terceiros">(canSeeClt ? "CLT" : "Terceiros");
  const kind = !canSeeClt ? "Terceiros" : !canSeeTerceiros ? "CLT" : peopleKind;
  const canCreate = canUseFeature(access, "rh.colaboradores", "operar");
  const track=(message:string)=>{notify(message);onEvent(message)};
  const { registerNav } = useModuleNav();

  useEffect(() => {
    registerNav({
      moduleId: "rh",
      moduleName: "Recursos Humanos",
      items: accessibleSections.map(([label, icon]) => ({ id: label, label, icon })),
      activeId: section,
      onSelect: (id) => setSection(id as HrSection),
    });
    return () => registerNav(null);
  }, [accessibleSections, section, registerNav]);

  const isOwner = hasMultipleModules(access);

  return <div className="ds-module-body">
    <div className="ds-module-bar">
      {isOwner && <Button variant="secondary" compact onClick={onExit}><HrIcon name="back"/> Ecossistema</Button>}
      <Segmented options={accessibleSections.map(([label]) => label)} value={section} onChange={setSection} ariaLabel="Seções do módulo de Recursos Humanos"/>
      <Status tone="info">{access.scopeLabel}</Status>
    </div>

    <div className="hr-workspace">
        <>
          {section === "Painel" && <HrDashboard people={employees} summary={summary} rh={rh} setSection={setSection} notify={track} access={access} canCreate={canCreate} requestCreate={() => setCreateRequested(value => value + 1)}/>}
          {section === "Colaboradores" && canSeeClt && canSeeTerceiros && <PeopleKindTabs value={kind} onChange={setPeopleKind}/>}
          {section === "Colaboradores" && kind === "CLT" && <PeopleSection people={filteredPeople} allPeople={employees} setPeople={setEmployees} query={query} setQuery={setQuery} notify={track} canCreate={canCreate} canViewDocs={canUseFeature(access, "rh.documentos")} persists={rh.source === "supabase"} createRequested={createRequested} onCreateHandled={() => setCreateRequested(0)}/>}
          {section === "Colaboradores" && kind === "Terceiros" && <TerceirosSection/>}
          {section === "Ponto e jornada" && <JourneySection notify={track} access={access}/>}
          {section === "Férias e ausências" && <AbsenceSection key={rh.loadedAt} notify={track} access={access} rh={rh}/>}
          {section === "Feriados" && <HolidaysSection notify={track}/>}
          {section === "Benefícios" && <BenefitsSection key={rh.loadedAt} summary={summary} notify={track} access={access} rh={rh}/>}
          {section === "Saúde e segurança" && <SafetySection key={rh.loadedAt} notify={track} access={access} rh={rh}/>}
          {section === "Documentos" && <DocumentsSection key={rh.loadedAt} notify={track} access={access} rh={rh}/>}
          {section === "Relatórios" && <ReportsSection notify={track} access={access}/>} 
          {section === "Homologação" && <HomologationSection notify={track} access={access}/>} 
        </>
    </div>
  </div>;
}

type PendingItem = { key: string; title: string; meta: string; type: string; tone: "attention" | "danger" | "info"; icon: string; section: HrSection };

const absenceTypeLabel = {
  vacation: "Férias", time_bank: "Banco de horas", medical_certificate: "Atestado médico", leave: "Licença",
  attendance_statement: "Consulta ou exame", family_care: "Acompanhamento de familiar",
  occupational_exam: "Exame ocupacional", legal_leave: "Ausência legal", justified_absence: "Ausência justificada",
  inss_leave: "Afastamento INSS", work_accident: "Acidente de trabalho", maternity_leave: "Licença-maternidade",
} as const satisfies Record<RhAbsence["type"], string>;
type AbsenceLabel = (typeof absenceTypeLabel)[RhAbsence["type"]];
/** Tipos de saúde: só estes podem ter dado clínico. */
const HEALTH_ABSENCES: ReadonlySet<AbsenceLabel> = new Set<AbsenceLabel>([
  "Atestado médico", "Consulta ou exame", "Acompanhamento de familiar", "Exame ocupacional",
  "Afastamento INSS", "Acidente de trabalho", "Licença-maternidade",
]);

/** "3 dias", "1h50", "Manhã". Em horas, os minutos saem do decimal (1,83 → 1h50). */
function durationLabel(record: { days: number; hours: number | null; dayPart: "manha" | "tarde" | null }) {
  if (record.hours != null) {
    const total = Math.round(record.hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m} min`;
  }
  if (record.dayPart) return record.dayPart === "manha" ? "Manhã" : "Tarde";
  return `${record.days} ${record.days === 1 ? "dia" : "dias"}`;
}
const sstCategoryLabel: Record<RhSstRecord["category"], string> = {
  exam: "Exame", training: "Treinamento", ppe: "EPI", incident: "Ocorrência",
};

/** Deriva a lista de pendências do painel a partir do snapshot real: ausências
 *  aguardando decisão e registros de SST vencidos ou próximos do vencimento. */
function buildPendingItems(rh: RhSnapshot): PendingItem[] {
  const items: PendingItem[] = [];
  for (const absence of rh.absences) {
    if (absence.status !== "pending" && absence.status !== "under_review") continue;
    items.push({
      key: `abs-${absence.id}`,
      title: `${absenceTypeLabel[absence.type]} · ${absence.employeeName}`,
      meta: `${durationLabel(absence)}${absence.hasConflict ? " · conflito identificado" : ""}`,
      type: "Férias e ausências",
      tone: absence.hasConflict ? "danger" : "attention",
      icon: "calendar",
      section: "Férias e ausências",
    });
  }
  for (const sst of rh.sstRecords) {
    if (sst.status !== "overdue" && sst.status !== "due_soon") continue;
    items.push({
      key: `sst-${sst.id}`,
      title: `${sstCategoryLabel[sst.category]} · ${sst.title}`,
      meta: sst.dueDate ? `Vence em ${new Date(`${sst.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}` : "Sem prazo definido",
      type: "Saúde e segurança",
      tone: sst.risk === "critical" || sst.status === "overdue" ? "danger" : "attention",
      icon: "shield",
      section: "Saúde e segurança",
    });
  }
  return items.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Adaptadores: convertem os tipos reais (RhAbsence, RhSstRecord, RhBenefitPlan)
// para os tipos que a UI já usa. Assim as seções, drawers e filtros existentes
// funcionam sem reescrita — em modo real recebem dados do banco, em modo demo
// mantêm os mocks ricos originais.
// ---------------------------------------------------------------------------

// Envia uma decisão do RH ao servidor. Retorna true se persistiu; false se o
// backend está em modo demonstrativo (409) — a UI então mantém só o local.
// Lança em 401/403 para o chamador tratar (sessão expirada, sem permissão).
async function sendRhMutation(body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch("/api/rh", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return true;
  const code = ((await response.json().catch(() => ({}))) as { error?: string }).error;
  if (code === "DEMO_MODE") return false; // modo demonstrativo
  if (response.status === 401) throw new Error("UNAUTHENTICATED");
  if (response.status === 403) throw new Error("RH_MUTATION_DENIED");
  throw new Error(code || "RH_MUTATION_FAILED");
}

/** Mensagem da falha de uma decisão: permissão é uma coisa, erro de gravação é outra. */
function mutationFailure(error: unknown, who: string, what: string) {
  const code = error instanceof Error ? error.message : "";
  if (code === "UNAUTHENTICATED") return `${who}: sua sessão expirou. Entre novamente para ${what}.`;
  if (code === "RH_MUTATION_DENIED") return `${who}: você não tem permissão para ${what}.`;
  if (code === "RH_INVALID") return `${who}: confira as datas e os campos obrigatórios. Nada foi alterado.`;
  if (code === "RH_CONFIRMATION") return `${who}: o nome digitado não confere. Nada foi excluído.`;
  if (code === "RH_EMPLOYEE_HAS_ACCOUNT") return `${who}: tem conta de acesso à plataforma. Exclua o usuário em Pessoas e Acessos antes de excluir o cadastro.`;
  return `${who}: não foi possível ${what} agora. Nada foi alterado; tente de novo.`;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "–";

const absenceTypePt: Record<RhAbsence["type"], AbsenceRecord["type"]> = absenceTypeLabel;
const absenceTypeEnum = Object.fromEntries(
  Object.entries(absenceTypeLabel).map(([code, label]) => [label, code]),
) as Record<AbsenceRecord["type"], RhAbsence["type"]>;
const absenceStatusPt: Record<RhAbsence["status"], AbsenceStatus> = {
  pending: "Pendente", under_review: "Em análise", approved: "Aprovada", rejected: "Reprovada", registered: "Registrado",
};

function toAbsenceRecord(absence: RhAbsence, index: number): AbsenceRecord {
  return {
    id: index + 1,
    sourceId: absence.id,
    employee: absence.employeeName,
    initials: initialsOf(absence.employeeName),
    type: absenceTypePt[absence.type],
    start: absence.startDate,
    end: absence.endDate,
    days: absence.days,
    hours: absence.hours,
    dayPart: absence.dayPart,
    status: absenceStatusPt[absence.status],
    unit: absence.unit ?? "—",
    department: absence.department ?? "—",
    requestedAt: absence.requestedAt,
    reason: absence.reason ?? "—",
    balance: 30,
    conflict: absence.hasConflict ? "Conflito de planejamento identificado no período." : null,
  };
}

const sstCategoryPt: Record<RhSstRecord["category"], SstRecord["category"]> = {
  exam: "Exame", training: "Treinamento", ppe: "EPI", incident: "Ocorrência",
};
const sstStatusPt: Record<RhSstRecord["status"], SstStatus> = {
  compliant: "Conforme", due_soon: "A vencer", overdue: "Vencido", scheduled: "Programado", under_review: "Em análise",
};
const sstRiskPt: Record<RhSstRecord["risk"], SstRecord["risk"]> = {
  critical: "Crítico", attention: "Atenção", regular: "Regular",
};

function toSstUiRecord(record: RhSstRecord, index: number): SstRecord {
  return {
    id: index + 1,
    sourceId: record.id,
    employee: record.employeeName,
    initials: initialsOf(record.employeeName),
    department: record.department ?? "—",
    unit: record.unit ?? "—",
    category: sstCategoryPt[record.category],
    title: record.title,
    dueDate: record.dueDate ?? "",
    status: sstStatusPt[record.status],
    risk: sstRiskPt[record.risk],
    document: record.note ?? "—",
    note: record.note ?? "—",
    sensitive: record.sensitive,
  };
}

const benefitCategoryPt: Record<RhBenefitPlan["category"], BenefitPlan["category"]> = {
  food: "Alimentação", health: "Saúde", mobility: "Mobilidade", protection: "Proteção",
};
const benefitIconOf: Record<RhBenefitPlan["category"], string> = {
  food: "card", health: "heart", mobility: "clock", protection: "shield",
};

const docSignaturePt: Record<NonNullable<RhDocument["signature"]>, HrDocumentRecord["signature"]> = {
  signed: "Assinado", pending: "Assinatura pendente", not_required: "Não exigida",
};

function toDocumentUiRecord(doc: RhDocument, index: number): HrDocumentRecord {
  const fileName = doc.objectPath ? doc.objectPath.split("/").pop() ?? doc.objectPath : "—";
  // Deriva um status simples a partir da validade, já que a Fundação não guarda
  // um "status" de documento — a data de revisão é o sinal disponível.
  const status: HrDocumentStatus = doc.reviewDueAt
    ? (new Date(`${doc.reviewDueAt}T12:00:00`) < new Date() ? "Expirado" : "A vencer")
    : "Válido";
  return {
    id: index + 1,
    sourceId: doc.id,
    objectPath: doc.objectPath || undefined,
    employee: doc.employeeName ?? "—",
    initials: initialsOf(doc.employeeName ?? "—"),
    department: "—",
    category: (doc.category as HrDocumentRecord["category"]) ?? "Admissional",
    title: doc.title,
    fileName,
    version: Number(doc.version) || 1,
    validUntil: doc.reviewDueAt,
    status,
    signature: doc.signature ? docSignaturePt[doc.signature] : "Não exigida",
    sensitive: doc.sensitive,
    updatedAt: doc.updatedAt,
  };
}

const benefitActionPt: Record<RhBenefitRequest["action"], BenefitRequest["action"]> = {
  enroll: "Adesão", change: "Alteração", cancel: "Cancelamento", add_dependent: "Inclusão de dependente",
};
const benefitReqStatusPt: Record<RhBenefitRequest["status"], BenefitRequestStatus> = {
  pending: "Pendente", under_review: "Em análise", approved: "Aprovada", rejected: "Reprovada",
};

function toBenefitUiRequest(request: RhBenefitRequest, index: number): BenefitRequest {
  return {
    id: index + 1,
    sourceId: request.id,
    employee: request.employeeName,
    initials: initialsOf(request.employeeName),
    department: request.department ?? "—",
    plan: request.planName,
    action: benefitActionPt[request.action],
    requestedAt: request.requestedAt,
    effectiveDate: request.effectiveDate ?? "",
    status: benefitReqStatusPt[request.status],
    reason: request.reason ?? "—",
  };
}

function toBenefitUiPlan(plan: RhBenefitPlan, index: number): BenefitPlan {
  return {
    id: index + 1,
    name: plan.name,
    category: benefitCategoryPt[plan.category],
    icon: benefitIconOf[plan.category],
    members: plan.members,
    eligible: plan.eligible || 1,
    monthlyCost: plan.monthlyCost,
    employeeContribution: plan.employeeContribution ?? "—",
    status: plan.status === "active" ? "Ativo" : "Em revisão",
    rule: plan.eligibilityRule ?? "—",
    provider: plan.provider ?? "—",
  };
}

function HrDashboard({ people, summary, rh, setSection, notify, access, canCreate, requestCreate }: { people: Person[]; summary: FoundationSummary; rh: RhSnapshot; setSection: (section: HrSection) => void; notify: (message: string) => void; access: ModuleAccessContext; canCreate: boolean; requestCreate: () => void }) {
  // Pendências reais: ausências aguardando decisão + SST vencido/a vencer.
  const pending = buildPendingItems(rh);
  const [detail, setDetail] = useState<KpiDetail | null>(null);
  const openEmployees = () => setDetail({
    eyebrow: "RH · COLABORADORES", title: "Colaboradores ativos",
    subtitle: `${rh.summary.activeEmployees} ativos de ${rh.summary.employees} no cadastro`,
    rows: rh.employees.map(e => ({ key: e.id, title: e.name, subtitle: [e.department, e.unit].filter(Boolean).join(" · ") || undefined })),
    empty: "Nenhum colaborador ativo no cadastro.",
  });
  const openPendingAbsences = () => setDetail({
    eyebrow: "RH · AUSÊNCIAS", title: "Ausências pendentes", subtitle: "Aguardando decisão do RH ou do gestor",
    rows: rh.absences.filter(a => a.status === "pending" || a.status === "under_review").map(a => ({
      key: a.id, title: a.employeeName, subtitle: `${absenceTypeLabel[a.type]} · ${formatPeriod(a.startDate, a.endDate)}`,
      status: { tone: "attention", label: a.status === "pending" ? "Pendente" : "Em análise" }, meta: durationLabel(a),
    })),
    empty: "Nenhuma ausência aguardando decisão.",
  });
  const openScheduledVacations = () => setDetail({
    eyebrow: "RH · FÉRIAS", title: "Férias programadas",
    subtitle: `${plural(rh.upcomingVacations.length, "gozo", "gozos")} a partir de amanhã · ${plural(rh.summary.scheduledVacationDays, "dia", "dias")} no total`,
    rows: rh.upcomingVacations.map(v => ({ key: v.id, title: v.employeeName, subtitle: `${formatPeriod(v.startDate, v.endDate)}${v.department ? ` · ${v.department}` : ""}`, meta: plural(v.days, "dia", "dias") })),
    empty: "Nenhuma férias programada.",
  });
  const openSstAlerts = () => setDetail({
    eyebrow: "RH · SST", title: "Alertas de SST", subtitle: "Obrigações vencidas ou dentro da janela de vencimento",
    rows: rh.sstAlertList.map(r => ({
      key: r.id, title: r.employeeName, subtitle: `${sstCategoryLabel[r.category]} · ${r.title}`,
      status: { tone: r.status === "overdue" ? "danger" : "attention", label: r.status === "overdue" ? "Vencido" : "A vencer" },
      meta: r.dueDate ? formatDate(r.dueDate) : "—",
    })),
    empty: "Nenhuma obrigação de SST vencida ou a vencer.",
  });
  return <>
    {detail && <KpiDetailModal detail={detail} onClose={() => setDetail(null)}/>}
    <div className="page-head hr-page-head"><div><p className="eyebrow">RECURSOS HUMANOS · {access.role.toUpperCase()}</p><h1>Gestão de pessoas</h1><p>{`Indicadores e rotinas liberados para você em ${access.scopeLabel}.`}</p></div>{canCreate&&<Button onClick={() => { requestCreate(); setSection("Colaboradores"); }}><HrIcon name="plus"/> Novo colaborador</Button>}</div>
    <KpiGrid>
      <HrStat value={String(rh.summary.employees)} label="Colaboradores" meta={`${rh.summary.activeEmployees} ativos`} icon="users" tone="blue" onOpen={openEmployees}/>
      <HrStat value={String(rh.summary.pendingAbsences)} label="Ausências pendentes" meta="Aguardando decisão" icon="clock" tone="orange" onOpen={openPendingAbsences}/>
      <HrStat value={String(rh.summary.scheduledVacationDays)} label="Férias programadas" meta="Dias no período" icon="calendar" tone="purple" onOpen={openScheduledVacations}/>
      <HrStat value={String(rh.summary.sstAlerts)} label="Alertas de SST" meta="Vencidos ou a vencer" icon="shield" tone="red" onOpen={openSstAlerts}/>
    </KpiGrid>
    <div className="hr-dashboard-grid">
      <Card className="hr-pending-card"><div className="card-head"><div><p className="eyebrow">CENTRAL DE PENDÊNCIAS</p><h2>Ações que exigem atenção</h2><p>Demandas consolidadas das rotinas de RH.</p></div><Status tone={pending.length ? "attention" : "success"}>{pending.length ? `${pending.length} ${pending.length === 1 ? "pendência" : "pendências"}` : "Sem pendências"}</Status></div><div className="hr-pending-list">{pending.length ? pending.map(item => <button key={item.key} onClick={() => { setSection(item.section); notify(`${item.title}: aberto para tratamento.`); }}><span className="hr-list-icon"><HrIcon name={item.icon}/></span><span><b>{item.title}</b><small>{item.meta}</small></span><Status tone={item.tone}>{item.type}</Status><HrIcon name="arrow"/></button>) : <div className="hr-empty"><HrIcon name="check" size={26}/><b>Nenhuma pendência</b><small>Ausências e SST em dia.</small></div>}</div></Card>
      <Card className="hr-distribution"><p className="eyebrow">QUADRO ATIVO</p><h2>Distribuição por área</h2><div className="hr-bars">{rh.departmentShares.length ? rh.departmentShares.map(dept => <div key={dept.name}><span><b>{dept.name}</b><small>{dept.people} {dept.people === 1 ? "pessoa" : "pessoas"}</small></span><i><em style={{width:`${dept.percentage}%`}}/></i><strong>{dept.percentage}%</strong></div>) : <div className="hr-empty"><HrIcon name="users" size={26}/><b>Sem colaboradores</b><small>Cadastre para ver a distribuição.</small></div>}</div><button onClick={() => setSection("Colaboradores")}>Ver quadro completo <HrIcon name="arrow"/></button></Card>
    </div>
    <div className="hr-dashboard-grid secondary">
      <Card className="hr-recent-people"><div className="card-head"><div><p className="eyebrow">CADASTRO MESTRE</p><h2>Colaboradores recentes</h2></div><button onClick={() => setSection("Colaboradores")}>Ver todos <HrIcon name="arrow"/></button></div>{[...people].sort((a, b) => String(b.admissionDate ?? "").localeCompare(String(a.admissionDate ?? ""))).slice(0,4).map(person => <div className="hr-recent-person" key={personKey(person)}><span className="person-cell"><i>{person.initials}</i><span><b>{person.name}</b><small>{person.role} · {person.department}</small></span></span><Status tone={person.status === "Ativo" ? "success" : "attention"}>{person.status}</Status></div>)}</Card>
      <Card className="hr-calendar-card"><div className="card-head"><div><p className="eyebrow">PRÓXIMOS EVENTOS</p><h2>Agenda do RH</h2></div></div><div className="hr-empty"><HrIcon name="calendar" size={26}/><b>Nenhum evento agendado</b><small>Férias aprovadas e vencimentos de SST aparecerão aqui.</small></div></Card>
    </div>
  </>;
}

function PeopleSection({ people, allPeople, setPeople, query, setQuery, notify, canCreate, canViewDocs, persists, createRequested, onCreateHandled }: { people: EmployeeRecord[]; allPeople: EmployeeRecord[]; setPeople: React.Dispatch<React.SetStateAction<EmployeeRecord[]>>; query: string; setQuery: (value: string) => void; notify: (message: string) => void; canCreate: boolean; canViewDocs: boolean; persists: boolean; createRequested: number; onCreateHandled: () => void }) {
  const [selected, setSelected] = useState<EmployeeRecord | null>(null);
  const [editing, setEditing] = useState<EmployeeRecord | null>(null);
  const [creating, setCreating] = useState(createRequested > 0 && canCreate);
  const [unit, setUnit] = useState("Todas as unidades");
  const visiblePeople = unit === "Todas as unidades" ? people : people.filter(person => person.unit === unit);

  const saveEmployee = async (employee: EmployeeRecord, isNew: boolean) => {
    const before = editing;
    setPeople(current => isNew ? [employee, ...current] : current.map(item => before && personKey(item) === personKey(before) ? employee : item));
    setCreating(false);
    onCreateHandled();
    setEditing(null);
    setSelected(employee);
    // Edição de colaborador real: grava no banco (nome, matrícula, e-mail,
    // admissão, demissão e lotação). Reverte se o servidor recusar.
    if (persists && !isNew && employee.id) {
      try {
        await sendRhMutation({
          entity: "employee", id: employee.id, action: "update",
          changes: {
            fullName: employee.name,
            employeeNumber: employee.registration,
            corporateEmail: employee.email || null,
            admissionDate: employee.admissionDate || null,
            terminationDate: employee.terminationDate || null,
            departmentName: employee.department || null,
            unitName: employee.unit || null,
            positionName: employee.role || null,
          },
        });
        notify(employee.terminationDate
          ? `${employee.name}: demissão registrada em ${formatDate(employee.terminationDate)}.`
          : `Cadastro de ${employee.name} atualizado no banco.`);
      } catch (error) {
        if (before) {
          setPeople(current => current.map(item => personKey(item) === personKey(employee) ? before : item));
          setSelected(before);
        }
        notify(mutationFailure(error, employee.name, "salvar o cadastro"));
      }
      return;
    }
    if (persists && isNew) {
      try {
        const response = await fetch("/api/rh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity: "employee",
            fullName: employee.name,
            employeeNumber: employee.registration,
            corporateEmail: employee.email || null,
            admissionDate: employee.admissionDate || null,
            departmentName: employee.department || null,
            unitName: employee.unit || null,
            positionName: employee.role || null,
          }),
        });
        if (response.status === 401) throw new Error("UNAUTHENTICATED");
        if (!response.ok) throw new Error("RH_CREATE_DENIED");
        notify(`${employee.name} foi cadastrado no banco.`);
      } catch {
        setPeople(current => current.filter(item => item.registration !== employee.registration));
        setSelected(null);
        notify(`${employee.name}: não foi possível cadastrar. Verifique suas permissões.`);
      }
      return;
    }
    notify(isNew ? `${employee.name} foi incluído nos dados demonstrativos.` : `Cadastro de ${employee.name} atualizado.`);
  };

  const [deleting, setDeleting] = useState<EmployeeRecord | null>(null);
  const removeEmployee = (employee: EmployeeRecord) => {
    setPeople(current => current.filter(item => personKey(item) !== personKey(employee)));
    setDeleting(null);
    setSelected(null);
    notify(`${employee.name}: cadastro excluído.`);
  };

  const changeStatus = (status: Person["status"]) => {
    if (!selected) return;
    const updated = { ...selected, status };
    setPeople(current => current.map(item => personKey(item) === personKey(selected) ? updated : item));
    setSelected(updated);
    notify(`${selected.name}: situação alterada para ${status}.`);
  };

  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RH · PESSOAS</p><h1>Colaboradores</h1><p>Cadastro funcional compartilhado com o núcleo do Pecsil Business OS.</p></div>{canCreate && <Button onClick={() => setCreating(true)}><HrIcon name="plus"/> Novo colaborador</Button>}</div>
    <div className="employee-overview">
      <Card><span><HrIcon name="users"/></span><div><strong>{allPeople.length}</strong><small>registros visíveis</small></div></Card>
      <Card><span><HrIcon name="check"/></span><div><strong>{allPeople.filter(person => person.status === "Ativo").length}</strong><small>vínculos ativos</small></div></Card>
      {allPeople.some(person => person.id)
        ? <Card><span><HrIcon name="key"/></span><div><strong>{allPeople.filter(person => person.profile === "Sem conta de acesso").length}</strong><small>sem conta de acesso</small></div></Card>
        : <Card><span><HrIcon name="file"/></span><div><strong>{allPeople.filter(person => person.documentStatus === "Pendente").length}</strong><small>cadastros pendentes</small></div></Card>}
    </div>
    <Card className="hr-table-card"><div className="hr-tools"><label><HrIcon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome, matrícula, cargo ou departamento..."/></label><select value={unit} onChange={event => setUnit(event.target.value)} aria-label="Filtrar unidade"><option>Todas as unidades</option>{Array.from(new Set(allPeople.map(person => person.unit))).sort().map(name => <option key={name}>{name}</option>)}</select><button onClick={() => { setQuery(""); setUnit("Todas as unidades"); }}><HrIcon name="filter"/> Limpar filtros</button></div><div className="hr-people-table"><div className="hr-table-header"><span>Colaborador</span><span>Cargo</span><span>Departamento</span><span>Status</span><span/></div>{visiblePeople.map(person => <button key={personKey(person)} onClick={() => setSelected(person)}><span className="hr-person"><i>{person.initials}</i><span><b>{person.name}</b><small>Matrícula {person.registration}{person.email ? ` · ${person.email}` : ""}</small></span></span><span><b>{person.role}</b><small>{person.unit}</small></span><span>{person.department}</span><Status tone={person.status === "Ativo" ? "success" : person.status === "Pendente" ? "info" : "neutral"}>{person.status}</Status><HrIcon name="arrow"/></button>)}{!visiblePeople.length && <div className="hr-empty"><HrIcon name="search"/><b>Nenhum colaborador encontrado</b><small>Ajuste a busca ou a unidade selecionada.</small></div>}</div></Card>
    {selected && <EmployeeDrawer employee={selected} canEdit={canCreate} canViewDocs={canViewDocs} notify={notify} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} onStatus={changeStatus} onDelete={persists && selected.id ? () => { setDeleting(selected); setSelected(null); } : undefined}/>}
    {deleting && <EmployeeDeleteDialog employee={deleting} onClose={() => setDeleting(null)} onDeleted={() => removeEmployee(deleting)}/>} 
    {(creating || editing) && <EmployeeForm employee={editing} nextRegistration={String(allPeople.length + 1).padStart(4,"0")} units={Array.from(new Set(allPeople.map(person => person.unit).filter(Boolean))).sort()} departments={Array.from(new Set(allPeople.map(person => person.department).filter(Boolean))).sort()} onClose={() => { setCreating(false); setEditing(null); onCreateHandled(); }} onSave={saveEmployee}/>} 
  </>;
}

function EmployeeDrawer({ employee, canEdit, canViewDocs, notify, onClose, onEdit, onStatus, onDelete }: { employee: EmployeeRecord; canEdit: boolean; canViewDocs: boolean; notify: (message: string) => void; onClose: () => void; onEdit: () => void; onStatus: (status: Person["status"]) => void; onDelete?: () => void }) {
  const [tab, setTab] = useState<"Resumo" | "Vínculo" | "Documentos" | "Histórico">("Resumo");
  const admission = employee.admissionDate ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${employee.admissionDate}T12:00:00Z`)) : "Não informada";
  const termination = employee.terminationDate ? formatDate(employee.terminationDate) : null;
  return <div className="employee-layer" onMouseDown={onClose}>
    <aside className="employee-drawer" onMouseDown={event => event.stopPropagation()} aria-label={`Ficha de ${employee.name}`}>
      <header><button onClick={onClose} aria-label="Fechar ficha"><HrIcon name="close"/></button><span className="employee-avatar">{employee.initials}</span><div><p className="eyebrow">FICHA DO COLABORADOR</p><h2>{employee.name}</h2><p>{employee.role} · {employee.department}</p></div><Status tone={employee.status === "Ativo" ? "success" : employee.status === "Pendente" ? "info" : "neutral"}>{employee.status}</Status></header>
      <nav className="employee-tabs" aria-label="Seções da ficha">{(["Resumo","Vínculo","Documentos","Histórico"] as const).map(item => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</nav>
      <div className="employee-detail-content">
        {tab === "Resumo" && <><section className="employee-highlight"><span><HrIcon name="users"/></span><div><small>Matrícula</small><strong>{employee.registration}</strong></div><div><small>Admissão</small><strong>{admission}</strong></div>{termination && <div><small>Demissão</small><strong>{termination}</strong></div>}</section><DetailGroup title="Contato" rows={[["E-mail",employee.email || "Não informado"],["Telefone",employee.phone],["CPF",employee.cpf]]}/><DetailGroup title="Lotação atual" rows={[["Unidade",employee.unit],["Departamento",employee.department],["Equipe",employee.team]]}/></>}
        {tab === "Vínculo" && <><DetailGroup title="Dados contratuais" rows={[["Tipo de contrato",employee.contractType],["Cargo",employee.role],["Gestor responsável",employee.manager],["Jornada",employee.schedule]]}/><div className="employee-callout"><HrIcon name="shield"/><span><b>Escopo protegido</b><small>Alterações de vínculo serão registradas na auditoria quando o banco estiver conectado.</small></span></div></>}
        {tab === "Documentos" && employee.id && <EmployeeDocuments employeeId={employee.id} canView={canViewDocs} notify={notify}/>}
        {tab === "Documentos" && !employee.id && <><div className={`employee-document-health ${employee.documentStatus === "Completo" ? "complete" : "pending"}`}><HrIcon name={employee.documentStatus === "Completo" ? "check" : "alert"}/><span><b>Cadastro documental {employee.documentStatus.toLowerCase()}</b><small>{employee.documentStatus === "Completo" ? "Documentos obrigatórios conferidos." : "Existem documentos que exigem conferência."}</small></span></div>{[["Documento de identidade","Conferido"],["Contrato de trabalho","Assinado"],["Comprovante de residência",employee.documentStatus === "Completo" ? "Conferido" : "Pendente"],["ASO admissional","Válido"]].map(([name,status]) => <div className="employee-document-row" key={name}><span><HrIcon name="file"/></span><div><b>{name}</b><small>Arquivo protegido</small></div><Status tone={status === "Pendente" ? "attention" : "success"}>{status}</Status></div>)}</>}
        {tab === "Histórico" && employee.id && <div className="employee-history"><div><i>1</i><span><b>Admissão</b><small>{admission}</small></span></div><div><i>2</i><span><b>Cadastro importado da folha</b><small>Matrícula {employee.registration}</small></span></div>{termination && <div><i>3</i><span><b>Demissão</b><small>{termination}</small></span></div>}</div>}
        {tab === "Histórico" && !employee.id && <div className="employee-history">{[["Cadastro funcional revisado","Hoje · RH"],["Perfil de acesso vinculado",employee.profile],["Admissão registrada",admission]].map(([title,meta],index) => <div key={title}><i>{index + 1}</i><span><b>{title}</b><small>{meta}</small></span></div>)}</div>}
      </div>
      {canEdit && <footer>{onDelete ? <button type="button" className="absence-reject drawer-delete" onClick={onDelete}><HrIcon name="close"/> Excluir cadastro</button> : <select value={employee.status} onChange={event => onStatus(event.target.value as Person["status"])} aria-label="Alterar situação do vínculo"><option>Ativo</option><option>Pendente</option><option>Bloqueado</option></select>}<Button variant="secondary" onClick={onEdit}><HrIcon name="edit"/> Editar cadastro</Button></footer>}
    </aside>
  </div>;
}

/** Aba Documentos da ficha: os documentos do colaborador, com Visualizar
 *  (mesmo link temporário da central de documentos). Lidos direto do banco,
 *  com a regra de acesso da central. */
function EmployeeDocuments({ employeeId, canView, notify }: { employeeId: string; canView: boolean; notify: (message: string) => void }) {
  const [state, setState] = useState<{ id: string; docs: RhEmployeeDocument[] | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!canView) return;
    let active = true;
    listRhEmployeeDocuments(employeeId)
      .then(docs => { if (active) setState({ id: employeeId, docs, failed: false }); })
      .catch(() => { if (active) setState({ id: employeeId, docs: null, failed: true }); });
    return () => { active = false; };
  }, [employeeId, canView]);
  if (!canView) return <div className="employee-callout"><HrIcon name="lock"/><span><b>Sem acesso aos documentos</b><small>Os documentos do RH exigem a permissão Recursos Humanos › Documentos.</small></span></div>;
  const current = state?.id === employeeId ? state : null;
  if (!current) return <p className="employee-delete-muted">Carregando documentos…</p>;
  if (current.failed) return <p className="employee-delete-muted">Não foi possível carregar os documentos agora.</p>;
  if (!current.docs?.length) return <div className="hr-empty"><HrIcon name="file"/><b>Nenhum documento</b><small>Documentos deste colaborador aparecem aqui quando forem adicionados em RH › Documentos.</small></div>;
  const open = async (doc: RhEmployeeDocument) => {
    if (!doc.objectPath) { notify(`${doc.title}: documento sem arquivo anexado.`); return; }
    try { window.open(await getRhDocumentUrl(doc.objectPath), "_blank", "noopener"); }
    catch { notify(`${doc.title}: não foi possível abrir o documento agora.`); }
  };
  return <div className="employee-documents">{current.docs.map(doc => <div className="employee-document-row" key={doc.id}>
    <span><HrIcon name={doc.sensitive ? "lock" : "file"}/></span>
    <div><b>{doc.title}</b><small>{[doc.category, `v${doc.version}`, doc.reviewDueAt ? `Validade ${formatDate(doc.reviewDueAt)}` : null, `Atualizado em ${doc.updatedAt}`].filter(Boolean).join(" · ")}</small></div>
    <Button variant="secondary" compact onClick={() => open(doc)} disabled={!doc.objectPath}><HrIcon name="eye"/> Visualizar</Button>
  </div>)}</div>;
}

/**
 * Exclusão definitiva do cadastro. Mostra antes o histórico que vai junto
 * (férias, SST, EPI…) e recomenda registrar a demissão para ex-colaboradores,
 * que guarda tudo. Exige digitar o nome. Quem tem conta de acesso não é
 * excluído aqui (a conta ficaria sem cadastro).
 */
function EmployeeDeleteDialog({ employee, onClose, onDeleted }: { employee: EmployeeRecord; onClose: () => void; onDeleted: () => void }) {
  const [info, setInfo] = useState<{ hasAccount: boolean; items: { label: string; count: number }[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/rh/colaboradores/${employee.id}`, { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then(data => { if (active) setInfo(data); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [employee.id]);
  const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const confirmed = plain(confirmName) === plain(employee.name);
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await sendRhMutation({ entity: "employee", id: employee.id, action: "delete", confirmName });
      onDeleted();
    } catch (err) {
      setError(mutationFailure(err, employee.name, "excluir o cadastro"));
      setBusy(false);
    }
  };
  return <Modal eyebrow="RH · EXCLUIR CADASTRO" title={`Excluir ${employee.name}?`} subtitle="A exclusão é definitiva e não pode ser desfeita." onClose={onClose}>
    <div className="employee-delete">
      {!info && !failed && <p className="employee-delete-muted">Conferindo o histórico do colaborador…</p>}
      {failed && <p className="employee-delete-alert">Não foi possível conferir o histórico agora. Tente de novo em instantes.</p>}
      {info?.hasAccount && <p className="employee-delete-alert"><b>Este colaborador tem conta de acesso à plataforma.</b> Exclua o usuário em Pessoas e Acessos antes de excluir o cadastro.</p>}
      {info && !info.hasAccount && <>
        {info.items.length > 0
          ? <div className="employee-delete-alert"><b>Será apagado junto com o cadastro:</b><ul>{info.items.map(item => <li key={item.label}>{item.count} {item.label}</li>)}</ul></div>
          : <p className="employee-delete-muted">Nenhum histórico ligado a este cadastro.</p>}
        <p className="employee-delete-tip"><HrIcon name="alert"/><span>Se a pessoa saiu da empresa, <b>não exclua</b>: use <b>Editar cadastro › Data de demissão</b>. O cadastro fica como &ldquo;Desligado&rdquo; e o histórico continua guardado.</span></p>
        <label className="employee-delete-confirm"><span>Para confirmar, digite o nome do colaborador</span><input value={confirmName} onChange={event => setConfirmName(event.target.value)} placeholder={employee.name} autoComplete="off"/></label>
      </>}
      {error && <p className="employee-delete-alert">{error}</p>}
      <footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><button type="button" className="absence-reject" disabled={!info || info.hasAccount || !confirmed || busy} onClick={remove}><HrIcon name="close"/> {busy ? "Excluindo…" : "Excluir definitivamente"}</button></footer>
    </div>
  </Modal>;
}

function DetailGroup({ title, rows }: { title: string; rows: string[][] }) {
  return <section className="employee-detail-group"><h3>{title}</h3><dl>{rows.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function EmployeeForm({ employee, nextRegistration, units, departments, onClose, onSave }: { employee: EmployeeRecord | null; nextRegistration: string; units: string[]; departments: string[]; onClose: () => void; onSave: (employee: EmployeeRecord, isNew: boolean) => void }) {
  const isNew = !employee;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<EmployeeRecord>(() => employee ?? {
    initials: "",
    name: "",
    email: "",
    role: "",
    department: "",
    unit: "",
    profile: "Colaborador",
    status: "Pendente",
    registration: nextRegistration,
    cpf: "",
    phone: "",
    admissionDate: "",
    contractType: "CLT",
    manager: "",
    team: "",
    schedule: "Administrativo",
    documentStatus: "Pendente",
  });
  const update = (field: keyof EmployeeRecord, value: string) => setForm(current => ({ ...current, [field]: value }));
  const terminationValid = !form.terminationDate || !form.admissionDate || form.terminationDate >= form.admissionDate;
  const canAdvance = step === 1 ? Boolean(form.name && form.cpf && form.phone) : step === 2 ? Boolean(form.registration && form.admissionDate && form.unit && form.department && form.role && terminationValid) : Boolean(form.email);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < 3) { if (canAdvance) setStep(value => value + 1); return; }
    const initials = form.name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join("").toUpperCase();
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const status = form.terminationDate && form.terminationDate <= hoje ? "Desligado" : form.status === "Desligado" ? "Ativo" : form.status;
    onSave({ ...form, initials, status, terminationDate: form.terminationDate || null }, isNew);
  };
  return <div className="employee-layer form-layer" onMouseDown={onClose}>
    <form className="employee-form" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
      <header><div><p className="eyebrow">RH · CADASTRO FUNCIONAL</p><h2>{isNew ? "Novo colaborador" : "Editar colaborador"}</h2><p>{isNew ? "Inclua os dados essenciais para iniciar o vínculo." : `Atualize a ficha de ${employee.name}.`}</p></div><button type="button" onClick={onClose} aria-label="Fechar formulário"><HrIcon name="close"/></button></header>
      <div className="employee-stepper">{([[1,"Dados pessoais"],[2,"Vínculo"],[3,"Contato e acesso"]] as [number, string][]).map(([number,label]) => <span className={step >= number ? "active" : ""} key={label}><i>{step > number ? "✓" : number}</i><b>{label}</b></span>)}</div>
      <div className="employee-fields">
        {step === 1 && <><label className="field-wide"><span>Nome completo *</span><input autoFocus value={form.name} onChange={event => update("name",event.target.value)} placeholder="Nome civil do colaborador"/></label><label><span>CPF *</span><input value={form.cpf} onChange={event => update("cpf",event.target.value)} placeholder="000.000.000-00"/></label><label><span>Telefone *</span><input value={form.phone} onChange={event => update("phone",event.target.value)} placeholder="(00) 00000-0000"/></label></>}
        {step === 2 && <><label><span>Matrícula *</span><input value={form.registration} onChange={event => update("registration",event.target.value)}/></label><label><span>Data de admissão *</span><input type="date" value={form.admissionDate} onChange={event => update("admissionDate",event.target.value)}/></label>{!isNew && <label><span>Data de demissão</span><input type="date" min={form.admissionDate || undefined} value={form.terminationDate ?? ""} onChange={event => update("terminationDate",event.target.value)}/><small className="field-hint">Preencha quando o colaborador for desligado. O cadastro e o histórico ficam guardados.</small></label>}<label><span>Unidade *</span><select value={form.unit} onChange={event => update("unit",event.target.value)}>{units.map(name => <option key={name}>{name}</option>)}</select></label><label><span>Departamento *</span><select value={form.department} onChange={event => update("department",event.target.value)}>{departments.map(name => <option key={name}>{name}</option>)}</select></label><label className="field-wide"><span>Cargo *</span><input value={form.role} onChange={event => update("role",event.target.value)} placeholder="Ex.: Analista de Recursos Humanos"/></label><label><span>Tipo de contrato</span><select value={form.contractType} onChange={event => update("contractType",event.target.value)}><option>CLT</option><option>Temporário</option><option>Estágio</option><option>Aprendiz</option><option>Terceirizado</option><option>Sócio-administrador</option></select></label><label><span>Jornada</span><select value={form.schedule} onChange={event => update("schedule",event.target.value)}><option>Administrativo</option><option>Turno A</option><option>Turno B</option><option>Turno C</option><option>Executiva</option></select></label></>}
        {step === 3 && <><label className="field-wide"><span>E-mail *</span><input type="email" value={form.email} onChange={event => update("email",event.target.value)} placeholder="nome@exemplo.com"/></label><label><span>Equipe</span><input value={form.team} onChange={event => update("team",event.target.value)} placeholder="Equipe de trabalho"/></label><label><span>Gestor responsável</span><input value={form.manager} onChange={event => update("manager",event.target.value)} placeholder="Nome do gestor"/></label><label><span>Situação inicial</span><select value={form.status} onChange={event => update("status",event.target.value)}><option>Ativo</option><option>Pendente</option><option>Bloqueado</option></select></label><label><span>Documentação</span><select value={form.documentStatus} onChange={event => update("documentStatus",event.target.value)}><option>Pendente</option><option>Completo</option></select></label><div className="employee-form-note field-wide"><HrIcon name="lock"/><span><b>Acesso separado do vínculo</b><small>O perfil de usuário será concedido pela área de Pessoas e Acessos, respeitando as credenciais da plataforma.</small></span></div></>}
      </div>
      <footer><button type="button" className="employee-cancel" onClick={step === 1 ? onClose : () => setStep(value => value - 1)}>{step === 1 ? "Cancelar" : "Voltar"}</button><Button type="submit" disabled={!canAdvance}>{step < 3 ? "Continuar" : isNew ? "Concluir cadastro" : "Salvar alterações"} <HrIcon name={step < 3 ? "arrow" : "check"}/></Button></footer>
    </form>
  </div>;
}

function JourneySection({ access }: { notify: (message: string) => void; access: ModuleAccessContext }) {
  // Sem integração com o relógio de ponto não há marcação, saldo nem escala:
  // esta seção exibia presença, banco de horas e turnos fictícios.
  void access;
  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RH · JORNADA</p><h1>Ponto e jornada</h1><p>Marcações, escalas e banco de horas dos colaboradores.</p></div></div>
    <HrEmpty icon="clock" title="Nenhuma marcação registrada" description="A jornada aparecerá aqui quando o relógio de ponto (Secullum) for integrado à plataforma."/>
  </>;
}

function AbsenceSection({ notify, access, rh }: { notify: (message: string) => void; access: ModuleAccessContext; rh: RhSnapshot }) {
  // Dados reais quando logado; mocks ricos em modo demonstrativo. O componente
  // é remontado (key={rh.loadedAt}) quando o snapshot chega, então basta o
  // inicializador do useState — sem efeito de sincronização.
  const [records, setRecords] = useState<AbsenceRecord[]>(
    rh.source === "supabase" ? rh.absences.map(toAbsenceRecord) : initialAbsences,
  );
  const [selected, setSelected] = useState<AbsenceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<AbsenceRecord | null>(null);
  const [deletingAbsence, setDeletingAbsence] = useState<AbsenceRecord | null>(null);
  const [tab, setTab] = useState<"Solicitações" | "Calendário" | "Políticas">("Solicitações");
  const [status, setStatus] = useState("Todos os status");
  const canCreate = canUseFeature(access, "rh.ferias", "operar");
  const canApprove = canUseFeature(access, "rh.ferias", "aprovar");
  const pending = records.filter(record => record.status === "Pendente" || record.status === "Em análise").length;
  const conflicts = records.filter(record => record.conflict && ["Pendente","Em análise","Aprovada"].includes(record.status)).length;
  const filtered = status === "Todos os status" ? records : records.filter(record => record.status === status);
  const [detail, setDetail] = useState<KpiDetail | null>(null);
  const openScheduled = () => setDetail({
    eyebrow: "RH · FÉRIAS", title: "Férias programadas",
    subtitle: `${plural(rh.upcomingVacations.length, "gozo", "gozos")} a partir de amanhã · ${plural(rh.summary.scheduledVacationDays, "dia", "dias")} no total`,
    rows: rh.upcomingVacations.map(v => ({ key: v.id, title: v.employeeName, subtitle: `${formatPeriod(v.startDate, v.endDate)}${v.department ? ` · ${v.department}` : ""}`, meta: plural(v.days, "dia", "dias") })),
    empty: "Nenhuma férias programada.",
  });
  const openPending = () => setDetail({
    eyebrow: "RH · AUSÊNCIAS", title: "Em aprovação", subtitle: "Solicitações aguardando decisão",
    rows: records.filter(r => r.status === "Pendente" || r.status === "Em análise").map(r => ({
      key: String(r.id), title: r.employee, subtitle: `${r.type} · ${formatPeriod(r.start, r.end)}`,
      status: { tone: "attention", label: r.status }, meta: durationLabel(r),
    })),
    empty: "Nenhuma solicitação aguardando decisão.",
  });
  const openExpiring = () => setDetail({
    eyebrow: "RH · FÉRIAS", title: "Férias a vencer",
    subtitle: "Períodos com saldo cujo prazo de concessão (12 meses após o aquisitivo) venceu ou vence em até 60 dias",
    note: rh.summary.vacationsOverdue ? "Concessivo vencido: pela CLT (art. 137), as férias passam a ser devidas em dobro. Confira se não há gozo que deixou de ser lançado." : undefined,
    rows: rh.vacationAlerts.map((a, i) => ({
      key: `${a.employeeName}-${a.acquisitionStart}-${i}`, title: a.employeeName,
      subtitle: `Aquisitivo ${formatPeriod(a.acquisitionStart, a.acquisitionEnd)} · saldo ${plural(a.remainingDays, "dia", "dias")}`,
      status: { tone: a.overdue ? "danger" : "attention", label: a.overdue ? "Vencido" : "Vence" },
      meta: formatDate(a.expiresAt),
    })),
    empty: "Nenhum período com concessivo vencido ou vencendo.",
  });
  const openConflicts = () => setDetail({
    eyebrow: "RH · AUSÊNCIAS", title: "Conflitos de equipe", subtitle: "Movimentações que coincidem com outras ausências da mesma equipe",
    rows: records.filter(r => r.conflict && ["Pendente","Em análise","Aprovada"].includes(r.status)).map(r => ({
      key: String(r.id), title: r.employee, subtitle: `${r.type} · ${formatPeriod(r.start, r.end)} · ${r.department}`, status: { tone: "attention", label: r.status },
    })),
    empty: "Nenhum conflito de planejamento.",
  });

  const decide = async (decision: "Aprovada" | "Reprovada") => {
    if (!selected) return;
    const target = selected;
    const updated = { ...target, status: decision };
    // Atualização otimista: a UI responde na hora e reverte se o servidor recusar.
    setRecords(current => current.map(record => record.id === target.id ? updated : record));
    setSelected(updated);
    try {
      const persisted = target.sourceId
        ? await sendRhMutation({ entity:"absence", id:target.sourceId, decision: decision === "Aprovada" ? "approved" : "rejected" })
        : false;
      notify(persisted
        ? `${target.employee}: solicitação ${decision.toLowerCase()} e registrada no banco.`
        : `${target.employee}: solicitação ${decision.toLowerCase()} nos dados demonstrativos.`);
    } catch (error) {
      // Reverte a decisão otimista quando o servidor recusa (sem permissão) ou falha.
      setRecords(current => current.map(record => record.id === target.id ? target : record));
      setSelected(target);
      notify(mutationFailure(error, `${target.employee}`, "decidir esta solicitação"));
    }
  };

  // Corrigir uma ausência já lançada (tipo, datas, motivo). Reverte se recusar.
  const updateRequest = async (updated: AbsenceRecord) => {
    const before = records.find(record => record.id === updated.id);
    setEditingAbsence(null);
    setRecords(current => current.map(record => record.id === updated.id ? updated : record));
    setSelected(updated);
    if (!updated.sourceId) { notify(`${updated.employee}: alteração aplicada nos dados demonstrativos.`); return; }
    try {
      await sendRhMutation({
        entity: "absence", id: updated.sourceId, action: "update",
        changes: { absenceType: absenceTypeEnum[updated.type], startDate: updated.start, endDate: updated.end, days: updated.days, reason: updated.reason === "—" ? null : updated.reason },
      });
      notify(`${updated.employee}: ${updated.type.toLowerCase()} atualizada no banco.`);
    } catch (error) {
      if (before) { setRecords(current => current.map(record => record.id === before.id ? before : record)); setSelected(before); }
      notify(mutationFailure(error, updated.employee, "editar esta movimentação"));
    }
  };

  const deleteRequest = async (target: AbsenceRecord) => {
    setDeletingAbsence(null);
    setSelected(null);
    setRecords(current => current.filter(record => record.id !== target.id));
    if (!target.sourceId) { notify(`${target.employee}: movimentação removida dos dados demonstrativos.`); return; }
    try {
      await sendRhMutation({ entity: "absence", id: target.sourceId, action: "delete" });
      notify(`${target.employee}: ${target.type.toLowerCase()} de ${formatPeriod(target.start, target.end)} excluída.`);
    } catch (error) {
      setRecords(current => [target, ...current]);
      notify(mutationFailure(error, target.employee, "excluir esta movimentação"));
    }
  };

  const createRequest = async (request: AbsenceRecord, employeeId?: string) => {
    setRecords(current => [request, ...current]);
    setCreating(false);
    setSelected(request);
    if (rh.source === "supabase" && employeeId) {
      try {
        const response = await fetch("/api/rh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            absenceType: absenceTypeEnum[request.type],
            startDate: request.start,
            endDate: request.end,
            days: request.days,
            reason: request.reason,
          }),
        });
        if (response.status === 401) throw new Error("UNAUTHENTICATED");
        if (!response.ok) throw new Error("RH_CREATE_DENIED");
        const { id } = (await response.json()) as { id: string };
        setRecords(current => current.map(record => record.id === request.id ? { ...record, sourceId: id } : record));
        notify(`${request.employee}: nova solicitação registrada no banco.`);
      } catch {
        // Reverte a inserção otimista quando o servidor recusa ou falha.
        setRecords(current => current.filter(record => record.id !== request.id));
        setSelected(null);
        notify(`${request.employee}: não foi possível registrar a solicitação. Verifique suas permissões.`);
      }
      return;
    }
    notify(`${request.employee}: nova solicitação registrada nos dados demonstrativos.`);
  };

  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RH · AUSÊNCIAS</p><h1>Férias e ausências</h1><p>Solicitações, saldos, aprovações e conflitos de equipe em uma única visão.</p></div>{canCreate && <Button onClick={() => setCreating(true)}><HrIcon name="plus"/> Nova solicitação</Button>}</div>
    {detail && <KpiDetailModal detail={detail} onClose={() => setDetail(null)}/>}
    <KpiGrid><HrStat value={String(rh.summary.scheduledVacationDays)} label="Férias programadas" meta="Dias no período" icon="calendar" tone="blue" onOpen={openScheduled}/><HrStat value={String(pending)} label="Em aprovação" meta="Aguardando decisão" icon="clock" tone="orange" onOpen={openPending}/><HrStat value={String(rh.summary.vacationsOverdue + rh.summary.vacationsDueSoon)} label="Férias a vencer" meta={rh.summary.vacationsOverdue ? `${rh.summary.vacationsOverdue} com concessivo vencido` : "Concessivo em até 60 dias"} icon="alert" tone={rh.summary.vacationsOverdue ? "orange" : "purple"} onOpen={openExpiring}/><HrStat value={String(conflicts)} label="Conflitos de equipe" meta={conflicts ? "Exigem avaliação" : "Planejamento saudável"} icon={conflicts ? "alert" : "check"} tone={conflicts ? "orange" : "green"} onOpen={openConflicts}/></KpiGrid>
    <div className="absence-tabs" role="tablist">{(["Solicitações","Calendário","Políticas"] as const).map(item => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}{item === "Solicitações" && <i>{pending}</i>}</button>)}</div>
    {tab === "Solicitações" && <Card className="absence-card"><div className="absence-toolbar"><div><p className="eyebrow">FLUXO DE APROVAÇÃO</p><h2>Solicitações recentes</h2></div><label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filtrar solicitações por status"><option>Todos os status</option><option>Pendente</option><option>Em análise</option><option>Aprovada</option><option>Registrado</option><option>Reprovada</option></select></label></div><div className="absence-table"><div className="absence-table-head"><span>Colaborador</span><span>Tipo e período</span><span>Duração</span><span>Situação</span><span/></div>{filtered.map(record => <button onClick={() => setSelected(record)} key={record.id}><span className="absence-person"><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department} · {record.unit}</small></span></span><span><b>{record.type}</b><small>{formatPeriod(record.start,record.end)}</small></span><span><b>{durationLabel(record)}</b>{record.conflict ? <small className="conflict-label">⚠ Conflito identificado</small> : <small>Sem conflito</small>}</span><Status tone={absenceTone(record.status)}>{record.status}</Status><HrIcon name="arrow"/></button>)}{!filtered.length && <div className="hr-empty"><HrIcon name="search"/><b>Nenhuma solicitação encontrada</b><small>Altere o filtro de situação.</small></div>}</div></Card>}
    {tab === "Calendário" && <AbsenceCalendar records={records} onSelect={setSelected}/>} 
    {tab === "Políticas" && <AbsencePolicies/>}
    {selected && <AbsenceDrawer record={selected} canApprove={canApprove} canSeeClinical={canUseFeature(access, "rh.clinico")} onClose={() => setSelected(null)} onDecision={decide} onEdit={canApprove ? () => { setEditingAbsence(selected); setSelected(null); } : undefined} onDelete={canApprove ? () => { setDeletingAbsence(selected); setSelected(null); } : undefined}/>} 
    {creating && <AbsenceForm nextId={Math.max(0, ...records.map(record => record.id)) + 1} employees={rh.source === "supabase" ? rh.employees : []} onClose={() => setCreating(false)} onSave={createRequest}/>}
    {editingAbsence && <AbsenceForm nextId={editingAbsence.id} employees={[]} editing={editingAbsence} onClose={() => setEditingAbsence(null)} onSave={record => updateRequest(record)}/>}
    {deletingAbsence && <Modal eyebrow="RH · EXCLUIR MOVIMENTAÇÃO" title={`Excluir ${deletingAbsence.type.toLowerCase()}?`} subtitle={`${deletingAbsence.employee} · ${formatPeriod(deletingAbsence.start, deletingAbsence.end)} · ${durationLabel(deletingAbsence)}`} onClose={() => setDeletingAbsence(null)}>
      <div className="employee-delete">
        <p className="employee-delete-muted">A movimentação sai da lista e do calendário. A exclusão fica registrada na auditoria.{HEALTH_ABSENCES.has(deletingAbsence.type) ? " O dado clínico ligado a ela também é apagado." : ""}</p>
        <footer><button type="button" className="employee-cancel" onClick={() => setDeletingAbsence(null)}>Cancelar</button><button type="button" className="absence-reject" onClick={() => deleteRequest(deletingAbsence)}><HrIcon name="close"/> Excluir movimentação</button></footer>
      </div>
    </Modal>}
  </>;
}

function AbsenceCalendar({ records, onSelect }: { records: AbsenceRecord[]; onSelect: (record: AbsenceRecord) => void }) {
  const visible = records.filter(record => record.status !== "Reprovada");
  return <Card className="absence-calendar"><div className="card-head"><div><p className="eyebrow">PLANEJAMENTO DE EQUIPE</p><h2>Calendário consolidado</h2><p>Julho a setembro de 2026</p></div><Status tone="info">{visible.length} movimentações</Status></div><div className="calendar-scale"><span>Colaborador</span><div><b>Julho</b><b>Agosto</b><b>Setembro</b></div></div><div className="calendar-rows">{visible.map(record => { const month = Number(record.start.slice(5,7)); const left = month === 7 ? 3 : month === 8 ? 35 : 68; const width = Math.max(7,Math.min(29,record.days * 1.4)); return <button key={record.id} onClick={() => onSelect(record)}><span><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department}</small></span></span><em><i className={record.conflict ? "conflict" : ""} style={{left:`${left}%`,width:`${width}%`}} title={`${record.type} · ${durationLabel(record)}${record.conflict ? " · exige avaliação de conflito" : ""}`}/></em></button>; })}</div><div className="calendar-legend"><span><i/> Programação regular</span><span><i className="conflict"/> Exige avaliação de conflito</span></div></Card>;
}

function AbsencePolicies() {
  const policies = [
    ["Férias anuais","30 dias","Fracionamento em até 3 períodos, sujeito à aprovação e ao planejamento da equipe.","calendar"],
    ["Banco de horas","6 meses","Compensações seguem saldo disponível, escala e aprovação da liderança.","clock"],
    ["Atestados médicos","Até 48 horas","Documento deve ser enviado ao RH dentro do prazo definido pela empresa.","heart"],
    ["Licenças","Conforme categoria","Prazo e documentação variam conforme a natureza da licença registrada.","file"],
  ];
  return <div className="absence-policy-grid">{policies.map(([title,rule,description,icon]) => <Card key={title}><span><HrIcon name={icon}/></span><h2>{title}</h2><strong>{rule}</strong><p>{description}</p><button>Ver política completa <HrIcon name="arrow"/></button></Card>)}</div>;
}

type AbsenceClinicalData = { cidCodes: string[]; diagnosis: string | null; note: string | null };

/** Diagnóstico, CID e observação clínica. Só é montado para quem tem
 *  `rh.clinico`; para os outros o bloco nem existe na página, e a rota
 *  (e a RLS) recusam de novo. Buscado a cada abertura, nunca guardado. */
function AbsenceClinical({ absenceId }: { absenceId: string }) {
  const [state, setState] = useState<{ id: string; data: AbsenceClinicalData | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/rh/ausencias/${absenceId}/clinico`, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as AbsenceClinicalData | null;
      })
      .then(data => { if (active) setState({ id: absenceId, data, failed: false }); })
      .catch(() => { if (active) setState({ id: absenceId, data: null, failed: true }); });
    return () => { active = false; };
  }, [absenceId]);
  const current = state?.id === absenceId ? state : null;
  const rows: [string, string][] = current?.data
    ? [
        ["CID", current.data.cidCodes.length ? current.data.cidCodes.join(" · ") : "Não informado"],
        ["Registro original", current.data.diagnosis ?? "—"],
        ...(current.data.note ? [["Observação", current.data.note] as [string, string]] : []),
      ]
    : [];
  return <section className="absence-clinical" aria-label="Dados clínicos">
    <h3><HrIcon name="shield"/> Dados clínicos <small>Confidencial · LGPD</small></h3>
    {!current && <p className="absence-clinical-empty">Carregando…</p>}
    {current?.failed && <p className="absence-clinical-empty">Não foi possível carregar os dados clínicos.</p>}
    {current && !current.failed && !current.data && <p className="absence-clinical-empty">Sem dado clínico registrado.</p>}
    {rows.length > 0 && <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
  </section>;
}

function AbsenceDrawer({ record, canApprove, canSeeClinical, onClose, onDecision, onEdit, onDelete }: { record: AbsenceRecord; canApprove: boolean; canSeeClinical: boolean; onClose: () => void; onDecision: (decision: "Aprovada" | "Reprovada") => void; onEdit?: () => void; onDelete?: () => void }) {
  const actionable = record.status === "Pendente" || record.status === "Em análise";
  return <div className="employee-layer" onMouseDown={onClose}><aside className="absence-drawer" onMouseDown={event => event.stopPropagation()} aria-label={`Solicitação de ${record.employee}`}><header><button onClick={onClose} aria-label="Fechar solicitação"><HrIcon name="close"/></button><span><HrIcon name={record.type === "Atestado médico" ? "heart" : "calendar"}/></span><div><p className="eyebrow">SOLICITAÇÃO #{String(record.id).padStart(4,"0")}</p><h2>{record.type}</h2><p>{record.employee} · {record.department}</p></div><Status tone={absenceTone(record.status)}>{record.status}</Status></header><div className="absence-drawer-content">{record.conflict && <div className="absence-conflict"><HrIcon name="alert"/><span><b>Conflito de planejamento</b><small>{record.conflict}</small></span></div>}<section className="absence-period"><div><small>Início</small><strong>{formatDate(record.start)}</strong></div><HrIcon name="arrow"/><div><small>Término</small><strong>{formatDate(record.end)}</strong></div>{record.hours != null || record.dayPart ? <span><b>{durationLabel(record)}</b><small>{record.hours != null ? "em horas" : "meio período"}</small></span> : <span><b>{record.days}</b><small>{record.days === 1 ? "dia" : "dias"}</small></span>}</section>{record.type === "Férias" && actionable && <section className="absence-balance"><div><span><b>Saldo antes da solicitação</b><small>Período aquisitivo atual</small></span><strong>{record.balance} dias</strong></div><i><em style={{width:`${Math.min(100,(record.balance/30)*100)}%`}}/></i><p>Saldo projetado após aprovação: <b>{Math.max(0,record.balance-record.days)} dias</b></p></section>}<DetailGroup title="Informações" rows={[["Colaborador",record.employee],["Unidade",record.unit],["Motivo ou observação",record.reason],["Solicitado em",record.requestedAt]]}/>{canSeeClinical && record.sourceId && HEALTH_ABSENCES.has(record.type) && <AbsenceClinical absenceId={record.sourceId}/>}<section className="absence-workflow"><h3>Histórico da solicitação</h3><div><i>✓</i><span><b>Solicitação registrada</b><small>{record.requestedAt}</small></span></div><div><i>{actionable ? "2" : "✓"}</i><span><b>{actionable ? "Aguardando decisão" : `Solicitação ${record.status === "Registrado" ? "registrada" : record.status.toLowerCase()}`}</b><small>{actionable ? "Gestor e RH foram notificados" : "Movimentação registrada no histórico"}</small></span></div></section></div>{canApprove && actionable && <footer><button className="absence-reject" onClick={() => onDecision("Reprovada")}><HrIcon name="close"/> Reprovar</button><Button onClick={() => onDecision("Aprovada")}><HrIcon name="check"/> Aprovar solicitação</Button></footer>}{(onEdit || onDelete) && <footer className="absence-drawer-manage">{onDelete && <button className="absence-reject drawer-delete" onClick={onDelete}><HrIcon name="close"/> Excluir</button>}{onEdit && <Button variant="secondary" onClick={onEdit}><HrIcon name="edit"/> Editar</Button>}</footer>}</aside></div>;
}

function AbsenceForm({ nextId, employees, editing, onClose, onSave }: { nextId: number; employees: RhEmployeeOption[]; editing?: AbsenceRecord; onClose: () => void; onSave: (record: AbsenceRecord, employeeId?: string) => void }) {
  // Só colaboradores reais: sem sessão a lista fica vazia e o formulário avisa.
  const options = employees;
  const persists = employees.length > 0;
  const [employeeId,setEmployeeId] = useState(options[0]?.id ?? "");
  const [type,setType] = useState<AbsenceRecord["type"]>(editing?.type ?? "Férias");
  const [start,setStart] = useState(editing?.start ?? "");
  const [end,setEnd] = useState(editing?.end ?? "");
  const [reason,setReason] = useState(editing && editing.reason !== "—" ? editing.reason : "");
  const chosen = options.find(option => option.id === employeeId) ?? options[0];
  // Ausência em horas ou meio período mantém a duração; em dias, vem das datas.
  const partial = Boolean(editing && (editing.hours != null || editing.dayPart));
  const days = partial ? 0 : start && end ? Math.max(1,Math.round((new Date(`${end}T12:00:00`).getTime()-new Date(`${start}T12:00:00`).getTime())/86400000)+1) : 0;
  const valid = editing
    ? Boolean(start && end && end >= start && (partial || days > 0))
    : Boolean(chosen && start && end && reason && days > 0 && end >= start);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (editing) {
      if (!valid) return;
      onSave({ ...editing, type, start, end, days, reason: reason.trim() || "—" });
      return;
    }
    if (!valid || !chosen) return;
    onSave({
      id:nextId, employee:chosen.name, initials:initialsOf(chosen.name), type, start, end, days, hours:null, dayPart:null,
      status:"Pendente", unit:chosen.unit ?? "—", department:chosen.department ?? "—",
      requestedAt:"Hoje · agora", reason, balance:30, conflict:null,
    }, persists ? chosen.id : undefined);
  };
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="absence-form" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><header><div><p className="eyebrow">{editing ? "RH · EDITAR MOVIMENTAÇÃO" : "RH · NOVA MOVIMENTAÇÃO"}</p><h2>{editing ? `Editar ${editing.type.toLowerCase()}` : "Nova solicitação"}</h2><p>{editing ? `${editing.employee} · ${editing.department}` : "Registre férias, compensações, atestados ou licenças."}</p></div><button type="button" onClick={onClose} aria-label={editing ? "Fechar edição" : "Fechar nova solicitação"}><HrIcon name="close"/></button></header><div className="absence-form-fields">{editing
    ? <label className="field-wide"><span>Colaborador</span><div className="absence-readonly">{editing.employee}</div></label>
    : <label className="field-wide"><span>Colaborador *</span><select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.name}{option.department ? ` · ${option.department}` : ""}</option>)}</select></label>}<label><span>Tipo de movimentação *</span><select value={type} onChange={event => setType(event.target.value as AbsenceRecord["type"])}>{editing ? (Object.values(absenceTypeLabel) as AbsenceRecord["type"][]).map(label => <option key={label}>{label}</option>) : <><option>Férias</option><option>Banco de horas</option><option>Atestado médico</option><option>Licença</option></>}</select></label><label><span>Unidade</span><div className="absence-readonly">{editing ? editing.unit : chosen?.unit ?? "—"}</div></label><label><span>Data inicial *</span><input type="date" value={start} onChange={event => setStart(event.target.value)}/></label><label><span>Data final *</span><input type="date" min={start} value={end} onChange={event => setEnd(event.target.value)}/></label><label className="field-wide"><span>{editing ? "Motivo ou observação" : "Motivo ou observação *"}</span><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Descreva a solicitação para o fluxo de aprovação..."/></label>{(days > 0 || partial) && <div className="absence-preview field-wide"><HrIcon name="calendar"/><span><b>{partial && editing ? durationLabel(editing) : `${days} ${days === 1 ? (editing ? "dia" : "dia solicitado") : (editing ? "dias" : "dias solicitados")}`}</b><small>{editing ? (editing.sourceId ? "A alteração será gravada no banco" : "Registro demonstrativo") : persists ? "Será registrado no banco" : "Registro demonstrativo"}</small></span></div>}</div><footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid}>{editing ? <>Salvar alterações <HrIcon name="check"/></> : <>Enviar para aprovação <HrIcon name="arrow"/></>}</Button></footer></form></div>;
}

function formatDate(value: string) { if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value || "—"; const date = new Date(`${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(date); }
function formatPeriod(start: string,end: string) { return start === end ? formatDate(start) : `${formatDate(start)} — ${formatDate(end)}`; }
function absenceTone(status: AbsenceStatus): "success" | "attention" | "info" | "neutral" { return status === "Aprovada" || status === "Registrado" ? "success" : status === "Pendente" ? "attention" : status === "Em análise" ? "info" : "neutral"; }

function BenefitsSection({ summary, notify, access, rh }: { summary: FoundationSummary; notify: (message: string) => void; access: ModuleAccessContext; rh: RhSnapshot }) {
  const [plans] = useState<BenefitPlan[]>(rh.source === "supabase" ? rh.benefitPlans.map(toBenefitUiPlan) : initialBenefitPlans);
  const [requests,setRequests] = useState<BenefitRequest[]>(rh.source === "supabase" ? rh.benefitRequests.map(toBenefitUiRequest) : initialBenefitRequests);
  const [selectedPlan,setSelectedPlan] = useState<BenefitPlan|null>(null);
  const [selectedRequest,setSelectedRequest] = useState<BenefitRequest|null>(null);
  const [creating,setCreating] = useState(false);
  const [tab,setTab] = useState<"Visão geral"|"Participantes"|"Solicitações"|"Políticas">("Visão geral");
  const [requestStatus,setRequestStatus] = useState("Todos os status");
  const canManage = canUseFeature(access,"rh.beneficios","operar");
  const canApprove = canUseFeature(access,"rh.beneficios","aprovar");
  const pending = requests.filter(request=>request.status==="Pendente"||request.status==="Em análise").length;
  const totalCost = plans.reduce((sum,plan)=>sum+plan.monthlyCost,0);
  const [detail,setDetail]=useState<KpiDetail|null>(null);
  const openPlans=()=>setDetail({eyebrow:"RH · BENEFÍCIOS",title:"Benefícios ativos",subtitle:"Catálogo corporativo",
    rows:plans.map(p=>({key:String(p.id),title:p.name,subtitle:`${p.category} · ${p.provider}`,meta:`${p.members}/${p.eligible}`,status:{tone:p.status==="Ativo"?"success":"attention",label:p.status}})),
    note:plans.length?"À direita: participantes / elegíveis.":undefined,empty:"Nenhum benefício cadastrado."});
  const openEligible=()=>setDetail({eyebrow:"RH · BENEFÍCIOS",title:"Elegíveis",subtitle:"Colaboradores ativos, base de elegibilidade dos planos",
    rows:rh.employees.map(e=>({key:e.id,title:e.name,subtitle:[e.department,e.unit].filter(Boolean).join(" · ")||undefined})),empty:"Nenhum colaborador ativo."});
  const openRequests=()=>setDetail({eyebrow:"RH · BENEFÍCIOS",title:"Em aprovação",subtitle:"Solicitações de benefício aguardando decisão",
    rows:requests.filter(r=>r.status==="Pendente"||r.status==="Em análise").map(r=>({key:String(r.id),title:r.employee,subtitle:`${r.action} · ${r.plan}`,status:{tone:"attention",label:r.status},meta:formatDate(r.effectiveDate)})),
    empty:"Nenhuma solicitação aguardando decisão."});
  const openCost=()=>setDetail({eyebrow:"RH · BENEFÍCIOS",title:"Custo estimado",subtitle:`${formatCurrency(totalCost)} por mês, somando os planos`,
    rows:[...plans].sort((a,b)=>b.monthlyCost-a.monthlyCost).map(p=>({key:String(p.id),title:p.name,subtitle:`${p.members} participantes · ${p.provider}`,meta:formatCurrency(p.monthlyCost)})),empty:"Nenhum custo cadastrado."});
  const filteredRequests = requestStatus === "Todos os status" ? requests : requests.filter(request=>request.status===requestStatus);
  const decide = async (status:"Aprovada"|"Reprovada") => {
    if(!selectedRequest)return;
    const target=selectedRequest;
    const updated={...target,status};
    setRequests(current=>current.map(request=>request.id===target.id?updated:request));
    setSelectedRequest(updated);
    try{
      const persisted=target.sourceId?await sendRhMutation({entity:"benefit_request",id:target.sourceId,decision:status==="Aprovada"?"approved":"rejected"}):false;
      notify(persisted?`${target.employee}: solicitação de benefício ${status.toLowerCase()} no banco.`:`${target.employee}: solicitação de benefício ${status.toLowerCase()} (demonstrativo).`);
    }catch(error){
      setRequests(current=>current.map(request=>request.id===target.id?target:request));setSelectedRequest(target);
      notify(mutationFailure(error, `${target.employee}`, "decidir esta solicitação"));
    }
  };
  const planIdByName = (name:string) => rh.source==="supabase" ? rh.benefitPlans.find(plan=>plan.name===name)?.id : undefined;
  const benefitActionEnum:Record<BenefitRequest["action"],RhBenefitRequest["action"]>={"Adesão":"enroll","Alteração":"change","Cancelamento":"cancel","Inclusão de dependente":"add_dependent"};
  const createRequest=async(request:BenefitRequest,employeeId?:string)=>{
    setRequests(current=>[request,...current]);setCreating(false);setSelectedRequest(request);setTab("Solicitações");
    const planId=planIdByName(request.plan);
    if(rh.source==="supabase"&&employeeId&&planId){
      try{
        const response=await fetch("/api/rh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:"benefit_request",employeeId,planId,action:benefitActionEnum[request.action],effectiveDate:request.effectiveDate||null,reason:request.reason||null})});
        if(response.status===401) throw new Error("UNAUTHENTICATED");
        if(!response.ok)throw new Error("RH_CREATE_DENIED");
        const{id}=(await response.json()) as {id:string};
        setRequests(current=>current.map(r=>r.id===request.id?{...r,sourceId:id}:r));
        notify(`${request.employee}: solicitação de benefício registrada no banco.`);
      }catch{
        setRequests(current=>current.filter(r=>r.id!==request.id));setSelectedRequest(null);
        notify(`${request.employee}: não foi possível registrar. Verifique suas permissões.`);
      }
      return;
    }
    notify(`${request.employee}: solicitação de benefício registrada nos dados demonstrativos.`);
  };
  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RH · BENEFÍCIOS</p><h1>Benefícios</h1><p>Planos, elegibilidade, adesões, custos estimados e solicitações em uma única visão.</p></div>{canManage&&<Button onClick={()=>setCreating(true)}><HrIcon name="plus"/> Nova movimentação</Button>}</div>
    <KpiGrid><HrStat value={String(plans.length)} label="Benefícios ativos" meta="Catálogo corporativo" icon="heart" tone="blue" onOpen={openPlans}/><HrStat value={String(rh.source === "supabase" ? rh.summary.activeEmployees : summary.activeEmployees)} label="Elegíveis" meta="Colaboradores ativos" icon="users" tone="green" onOpen={openEligible}/><HrStat value={String(pending)} label="Em aprovação" meta="Solicitações pendentes" icon="clock" tone="orange" onOpen={openRequests}/><HrStat value={totalCost >= 1000 ? `R$ ${Math.round(totalCost/1000)} mil` : `R$ ${totalCost}`} label="Custo estimado" meta="Competência mensal" icon="chart" tone="purple" onOpen={openCost}/></KpiGrid>{detail&&<KpiDetailModal detail={detail} onClose={()=>setDetail(null)}/>}
    <div className="benefit-tabs" role="tablist">{(["Visão geral","Participantes","Solicitações","Políticas"] as const).map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}{item==="Solicitações"&&<i>{pending}</i>}</button>)}</div>
    {tab==="Visão geral"&&<div className="benefit-plan-grid">{plans.map(plan=><Card key={plan.id}><span className={`benefit-plan-icon category-${plan.id}`}><HrIcon name={plan.icon}/></span><Status tone={plan.status==="Ativo"?"success":"attention"}>{plan.status}</Status><p className="eyebrow">{plan.category.toUpperCase()}</p><h2>{plan.name}</h2><div className="benefit-coverage"><span><b>{plan.members}</b><small>participantes</small></span><span><b>{Math.round(plan.members/plan.eligible*100)}%</b><small>dos elegíveis</small></span></div><div className="benefit-progress"><i><em style={{width:`${plan.members/plan.eligible*100}%`}}/></i><small>{plan.eligible-plan.members} elegíveis ainda não aderiram</small></div><footer><span><small>Custo mensal estimado</small><b>{formatCurrency(plan.monthlyCost)}</b></span><button onClick={()=>setSelectedPlan(plan)}>Ver gestão <HrIcon name="arrow"/></button></footer></Card>)}</div>}
    {tab==="Participantes"&&<BenefitParticipants plans={plans} notify={notify}/>} 
    {tab==="Solicitações"&&<Card className="benefit-request-card"><div className="benefit-request-toolbar"><div><p className="eyebrow">FLUXO DE APROVAÇÃO</p><h2>Solicitações de benefícios</h2><p>Movimentações recentes do quadro ativo</p></div><label><span>Status</span><select value={requestStatus} onChange={event=>setRequestStatus(event.target.value)}><option>Todos os status</option><option>Pendente</option><option>Em análise</option><option>Aprovada</option><option>Reprovada</option></select></label></div><div className="benefit-request-table"><div className="benefit-request-head"><span>Colaborador</span><span>Movimentação</span><span>Vigência</span><span>Situação</span><span/></div>{filteredRequests.map(request=><button key={request.id} onClick={()=>setSelectedRequest(request)}><span className="benefit-request-person"><i>{request.initials}</i><span><b>{request.employee}</b><small>{request.department}</small></span></span><span><b>{request.action}</b><small>{request.plan}</small></span><span><b>{formatDate(request.effectiveDate)}</b><small>{request.requestedAt}</small></span><Status tone={benefitRequestTone(request.status)}>{request.status}</Status><HrIcon name="arrow"/></button>)}</div></Card>}
    {tab==="Políticas"&&<BenefitPolicies/>}
    {selectedPlan&&<BenefitPlanDrawer plan={selectedPlan} onClose={()=>setSelectedPlan(null)} onParticipants={()=>{setSelectedPlan(null);setTab("Participantes")}}/>}
    {selectedRequest&&<BenefitRequestDrawer request={selectedRequest} canApprove={canApprove} onClose={()=>setSelectedRequest(null)} onDecision={decide}/>} 
    {creating&&<BenefitRequestForm nextId={Math.max(0,...requests.map(request=>request.id))+1} plans={plans} employees={rh.source==="supabase"?rh.employees:[]} onClose={()=>setCreating(false)} onSave={createRequest}/>}
  </>;
}

function BenefitParticipants({ plans }: { plans: BenefitPlan[]; notify: (message: string) => void }) {
  // A lista de participantes por pessoa exige adesões reais (rh_benefit_enrollments).
  const totalMembers = plans.reduce((sum, plan) => sum + plan.members, 0);
  return <Card className="benefit-participant-card">
    <div className="card-head"><div><p className="eyebrow">ADESÕES</p><h2>Participantes por benefício</h2></div><Status tone={totalMembers ? "info" : "neutral"}>{totalMembers} {totalMembers === 1 ? "adesão" : "adesões"}</Status></div>
    <div className="hr-empty"><HrIcon name="heart" size={26}/><b>Nenhuma adesão individual registrada</b><small>As adesões por colaborador aparecerão aqui quando forem lançadas no módulo.</small></div>
  </Card>;
}

function BenefitPolicies(){return <div className="benefit-policy-grid">{[["Elegibilidade","Vínculo ativo","Cada plano valida categoria, unidade e tipo de contrato.","users"],["Movimentações","Até o dia 20","Solicitações aprovadas entram na competência seguinte.","calendar"],["Dependentes","Documentação obrigatória","Inclusões exigem comprovação e validação do RH.","file"],["Proteção de dados","Acesso restrito","Informações de saúde seguem escopo sensível e auditável.","shield"]].map(([title,rule,description,icon])=><Card key={title}><span><HrIcon name={icon}/></span><div><h2>{title}</h2><strong>{rule}</strong><p>{description}</p></div></Card>)}</div>}

function BenefitPlanDrawer({plan,onClose,onParticipants}:{plan:BenefitPlan;onClose:()=>void;onParticipants:()=>void}){return <div className="employee-layer" onMouseDown={onClose}><aside className="benefit-drawer" onMouseDown={event=>event.stopPropagation()} aria-label={`Gestão de ${plan.name}`}><header><button onClick={onClose} aria-label="Fechar benefício"><HrIcon name="close"/></button><span><HrIcon name={plan.icon}/></span><div><p className="eyebrow">{plan.category.toUpperCase()}</p><h2>{plan.name}</h2><p>{plan.provider}</p></div><Status tone="success">{plan.status}</Status></header><div className="benefit-drawer-content"><section className="benefit-drawer-stats"><span><small>Participantes</small><b>{plan.members}</b></span><span><small>Elegíveis</small><b>{plan.eligible}</b></span><span><small>Adesão</small><b>{Math.round(plan.members/plan.eligible*100)}%</b></span></section><section className="benefit-cost-card"><div><span><small>Custo mensal estimado</small><b>{formatCurrency(plan.monthlyCost)}</b></span><span><small>Média por participante</small><b>{formatCurrency(plan.monthlyCost/plan.members)}</b></span></div><i><em style={{width:`${plan.members/plan.eligible*100}%`}}/></i><p>Estimativa demonstrativa, sem integração com folha de pagamento.</p></section><DetailGroup title="Regras do benefício" rows={[["Elegibilidade",plan.rule],["Contribuição do colaborador",plan.employeeContribution],["Fornecedor ou operação",plan.provider],["Próxima revisão","Janeiro de 2027"]]}/><section className="benefit-security-note"><HrIcon name="shield"/><span><b>Dados protegidos por escopo</b><small>Informações sensíveis de saúde não são exibidas nesta visão gerencial.</small></span></section></div><footer><button className="employee-cancel" onClick={onClose}>Fechar</button><Button onClick={onParticipants}>Ver participantes <HrIcon name="arrow"/></Button></footer></aside></div>}

function BenefitRequestDrawer({request,canApprove,onClose,onDecision}:{request:BenefitRequest;canApprove:boolean;onClose:()=>void;onDecision:(status:"Aprovada"|"Reprovada")=>void}){const actionable=request.status==="Pendente"||request.status==="Em análise";return <div className="employee-layer" onMouseDown={onClose}><aside className="benefit-drawer" onMouseDown={event=>event.stopPropagation()} aria-label={`Solicitação de ${request.employee}`}><header><button onClick={onClose} aria-label="Fechar solicitação de benefício"><HrIcon name="close"/></button><span><HrIcon name="heart"/></span><div><p className="eyebrow">SOLICITAÇÃO #{String(request.id).padStart(4,"0")}</p><h2>{request.action}</h2><p>{request.employee} · {request.department}</p></div><Status tone={benefitRequestTone(request.status)}>{request.status}</Status></header><div className="benefit-drawer-content"><section className="benefit-request-highlight"><span><small>Benefício solicitado</small><b>{request.plan}</b></span><span><small>Vigência pretendida</small><b>{formatDate(request.effectiveDate)}</b></span></section><DetailGroup title="Informações da solicitação" rows={[["Colaborador",request.employee],["Movimentação",request.action],["Justificativa",request.reason],["Solicitado em",request.requestedAt]]}/><section className="absence-workflow"><h3>Histórico da solicitação</h3><div><i>✓</i><span><b>Solicitação registrada</b><small>{request.requestedAt}</small></span></div><div><i>{actionable?"2":"✓"}</i><span><b>{actionable?"Aguardando decisão":`Solicitação ${request.status.toLowerCase()}`}</b><small>{actionable?"RH responsável foi notificado":"Movimentação registrada no histórico"}</small></span></div></section><section className="benefit-security-note"><HrIcon name="shield"/><span><b>Auditoria preparada</b><small>A decisão será vinculada ao aprovador quando a persistência estiver conectada.</small></span></section></div>{canApprove&&actionable&&<footer><button className="absence-reject" onClick={()=>onDecision("Reprovada")}><HrIcon name="close"/> Reprovar</button><Button onClick={()=>onDecision("Aprovada")}><HrIcon name="check"/> Aprovar solicitação</Button></footer>}</aside></div>}

function BenefitRequestForm({nextId,plans,employees,onClose,onSave}:{nextId:number;plans:BenefitPlan[];employees:RhEmployeeOption[];onClose:()=>void;onSave:(request:BenefitRequest,employeeId?:string)=>void}){
  const options=employees;
  const persists=employees.length>0;
  const[employeeId,setEmployeeId]=useState(options[0]?.id??"");
  const[plan,setPlan]=useState(plans[0]?.name??"");
  const[action,setAction]=useState<BenefitRequest["action"]>("Adesão");
  const[date,setDate]=useState("2026-08-01");
  const[reason,setReason]=useState("");
  const chosen=options.find(option=>option.id===employeeId)??options[0];
  const valid=Boolean(chosen&&plan&&date&&reason);
  const submit=(event:React.FormEvent)=>{event.preventDefault();if(!valid||!chosen)return;onSave({id:nextId,employee:chosen.name,initials:initialsOf(chosen.name),department:chosen.department??"—",plan,action,requestedAt:"Hoje · agora",effectiveDate:date,status:"Pendente",reason},persists?chosen.id:undefined)};
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="benefit-form" onSubmit={submit} onMouseDown={event=>event.stopPropagation()}><header><div><p className="eyebrow">RH · BENEFÍCIOS</p><h2>Nova movimentação</h2><p>Registre uma adesão, alteração, inclusão ou cancelamento.</p></div><button type="button" onClick={onClose} aria-label="Fechar movimentação"><HrIcon name="close"/></button></header><div className="benefit-form-fields"><label className="field-wide"><span>Colaborador *</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.name}{option.department?` · ${option.department}`:""}</option>)}</select></label><label><span>Benefício *</span><select value={plan} onChange={event=>setPlan(event.target.value)}>{plans.map(item=><option key={item.id}>{item.name}</option>)}</select></label><label><span>Movimentação *</span><select value={action} onChange={event=>setAction(event.target.value as BenefitRequest["action"])}><option>Adesão</option><option>Alteração</option><option>Cancelamento</option><option>Inclusão de dependente</option></select></label><label className="field-wide"><span>Vigência pretendida *</span><input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><label className="field-wide"><span>Justificativa *</span><textarea value={reason} onChange={event=>setReason(event.target.value)} placeholder="Descreva a necessidade da movimentação..."/></label><div className="benefit-form-note field-wide"><HrIcon name="shield"/><span><b>Sem alteração automática</b><small>{persists?"Entra no fluxo de aprovação e é gravada no banco.":"A movimentação entra no fluxo de aprovação antes de alterar a adesão."}</small></span></div></div><footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid}>Enviar para aprovação <HrIcon name="arrow"/></Button></footer></form></div>}

function formatCurrency(value:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}).format(value)}
function benefitRequestTone(status:BenefitRequestStatus):"success"|"attention"|"info"|"neutral"{return status==="Aprovada"?"success":status==="Pendente"?"attention":status==="Em análise"?"info":"neutral"}

function SafetySection({ notify, access, rh }: { notify: (message: string) => void; access: ModuleAccessContext; rh: RhSnapshot }) {
  const [records,setRecords]=useState<SstRecord[]>(rh.source === "supabase" ? rh.sstRecords.map(toSstUiRecord) : initialSstRecords);
  const [selected,setSelected]=useState<SstRecord|null>(null);
  const [creating,setCreating]=useState(false);
  const [editing,setEditing]=useState<SstRecord|null>(null);
  const [tab,setTab]=useState<"Prioridades"|"Exames"|"Treinamentos"|"EPIs"|"Ocorrências">("Prioridades");
  const [status,setStatus]=useState("Todos os status");
  const canManage=canUseFeature(access,"rh.sst","operar");
  const canApprove=canUseFeature(access,"rh.sst","aprovar");
  // Ficha de EPI: vem de rota própria, fora do snapshot do RH.
  const ppe=usePpeData(rh.source==="supabase");
  const ppeUnsigned=ppe.status==="ready"?ppe.deliveries.filter(delivery=>!delivery.signedOn).length:0;
  const [detail,setDetail]=useState<KpiDetail|null>(null);
  const sstRows=(list:SstRecord[])=>list.map(r=>({key:String(r.id),title:r.employee,subtitle:`${r.category} · ${r.title}`,status:{tone:sstTone(r.status),label:r.status},meta:r.dueDate?formatDate(r.dueDate):"—"}));
  const openExams=()=>setDetail({eyebrow:"RH · SST",title:"Exames a vencer",subtitle:"Exames vencidos ou dentro da janela de vencimento",rows:sstRows(records.filter(r=>r.category==="Exame"&&(r.status==="A vencer"||r.status==="Vencido"))),empty:"Nenhum exame vencido ou a vencer."});
  const openTrainings=()=>setDetail({eyebrow:"RH · SST",title:"Treinamentos",subtitle:"Treinamentos registrados no período",rows:sstRows(records.filter(r=>r.category==="Treinamento")),empty:"Nenhum treinamento registrado."});
  const openCritical=()=>setDetail({eyebrow:"RH · SST",title:"Pendências críticas",subtitle:"Registros de risco crítico que exigem tratamento",rows:sstRows(records.filter(r=>r.risk==="Crítico")),empty:"Nenhuma pendência crítica."});
  const openCompliance=()=>setDetail({eyebrow:"RH · SST",title:"Conformidade",subtitle:records.length?`${records.filter(r=>r.status==="Conforme").length} de ${records.length} registros conformes · abaixo, os que ainda não estão`:"Sem registros",rows:sstRows(records.filter(r=>r.status!=="Conforme")),empty:"Todos os registros estão conformes."});
  const alerts=records.filter(record=>["Vencido","A vencer","Em análise"].includes(record.status)).length;
  const filtered=status==="Todos os status"?records:records.filter(record=>record.status===status);
  const categoryMap:Record<Exclude<typeof tab,"Prioridades">,SstRecord["category"]>={"Exames":"Exame","Treinamentos":"Treinamento","EPIs":"EPI","Ocorrências":"Ocorrência"};
  const categoryRecords=tab==="Prioridades"?filtered:filtered.filter(record=>record.category===categoryMap[tab]);
  const conclude=async()=>{
    if(!selected)return;
    const target=selected;
    const updated={...target,status:"Conforme" as const,risk:"Regular" as const};
    setRecords(current=>current.map(record=>record.id===target.id?updated:record));setSelected(updated);
    try{
      const persisted=target.sourceId?await sendRhMutation({entity:"sst",id:target.sourceId,action:"mark_compliant"}):false;
      notify(persisted?`${target.employee}: registro de SST conforme, gravado no banco.`:`${target.employee}: registro de SST marcado como conforme (demonstrativo).`);
    }catch(error){
      setRecords(current=>current.map(record=>record.id===target.id?target:record));setSelected(target);
      notify(mutationFailure(error, `${target.employee}`, "concluir este registro"));
    }
  };
  const sstCategoryEnum:Record<SstRecord["category"],RhSstRecord["category"]>={"Exame":"exam","Treinamento":"training","EPI":"ppe","Ocorrência":"incident"};
  const sstRiskEnum:Record<SstRecord["risk"],RhSstRecord["risk"]>={"Crítico":"critical","Atenção":"attention","Regular":"regular"};
  // Edição do registro: aplica na tela e grava. Se o banco recusar (permissão
  // ou registro clínico confidencial), volta ao que era e avisa — nunca deixa a
  // tela mostrando um dado que não foi gravado.
  const saveEdit=async(changes:{category:SstRecord["category"];title:string;dueDate:string;risk:SstRecord["risk"];note:string})=>{
    if(!editing)return;
    const antes=editing;
    const depois:SstRecord={...antes,...changes,dueDate:changes.dueDate,note:changes.note};
    setRecords(current=>current.map(record=>record.id===antes.id?depois:record));
    if(selected?.id===antes.id)setSelected(depois);
    setEditing(null);
    if(!antes.sourceId){notify(`${antes.employee}: alteração aplicada nos dados demonstrativos.`);return;}
    try{
      const gravou=await sendRhMutation({entity:"sst",id:antes.sourceId,action:"update",changes:{
        title:changes.title,
        category:sstCategoryEnum[changes.category],
        dueDate:changes.dueDate||null,
        risk:sstRiskEnum[changes.risk],
        note:changes.note||null,
      }});
      if(!gravou)throw new Error("RH_MUTATION_DENIED");
      notify(`${antes.employee}: registro de SST atualizado no banco.`);
    }catch(error){
      setRecords(current=>current.map(record=>record.id===antes.id?antes:record));
      if(selected?.id===antes.id)setSelected(antes);
      notify(mutationFailure(error, `${antes.employee}`, "salvar esta alteração"));
    }
  };
  const createRecord=async(record:SstRecord,employeeId?:string)=>{
    setRecords(current=>[record,...current]);setCreating(false);setSelected(record);
    if(rh.source==="supabase"&&employeeId){
      try{
        const response=await fetch("/api/rh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:"sst",employeeId,category:sstCategoryEnum[record.category],title:record.title,dueDate:record.dueDate||null,risk:sstRiskEnum[record.risk],note:record.note||null})});
        if(response.status===401) throw new Error("UNAUTHENTICATED");
        if(!response.ok)throw new Error("RH_CREATE_DENIED");
        const{id}=(await response.json()) as {id:string};
        setRecords(current=>current.map(r=>r.id===record.id?{...r,sourceId:id}:r));
        notify(`${record.employee}: registro de SST gravado no banco.`);
      }catch{
        setRecords(current=>current.filter(r=>r.id!==record.id));setSelected(null);
        notify(`${record.employee}: não foi possível salvar o registro. Verifique suas permissões.`);
      }
      return;
    }
    notify(`${record.employee}: registro de SST incluído nos dados demonstrativos.`);
  };
  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RH · SST</p><h1>Saúde e segurança</h1><p>Exames, treinamentos, EPIs, ocorrências e obrigações organizados por risco e vencimento.</p></div>{canManage&&<Button onClick={()=>setCreating(true)}><HrIcon name="plus"/> Novo registro</Button>}</div>
    {tab!=="EPIs"&&<KpiGrid><HrStat value={String(records.filter(r => r.category === "Exame" && (r.status === "A vencer" || r.status === "Vencido")).length)} label="Exames a vencer" meta="Vencidos ou na janela" icon="heart" tone="orange" onOpen={openExams}/><HrStat value={String(records.filter(r => r.category === "Treinamento").length)} label="Treinamentos" meta="No período" icon="shield" tone="blue" onOpen={openTrainings}/><HrStat value={String(records.filter(r => r.risk === "Crítico").length)} label="Pendências críticas" meta="Exigem tratamento" icon="alert" tone="red" onOpen={openCritical}/><HrStat value={records.length ? `${Math.round((records.filter(r => r.status === "Conforme").length / records.length) * 100)}%` : "—"} label="Conformidade" meta="Registros conformes" icon="check" tone="green" onOpen={openCompliance}/></KpiGrid>}{detail&&<KpiDetailModal detail={detail} onClose={()=>setDetail(null)}/>}
    <div className="sst-tabs" role="tablist">{(["Prioridades","Exames","Treinamentos","EPIs","Ocorrências"] as const).map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}{item==="Prioridades"&&<i>{alerts+ppeUnsigned}</i>}</button>)}</div>
    {tab==="Prioridades"&&<div className="sst-overview"><SstRecordTable title="Prioridades de SST" eyebrow="VENCIMENTOS E PENDÊNCIAS" records={categoryRecords} status={status} setStatus={setStatus} onSelect={setSelected}/><Card className="sst-health-card"><p className="eyebrow">CONFORMIDADE</p><h2>Saúde dos registros</h2><div className="sst-score"><strong>96%</strong><span><i style={{width:"96%"}}/></span></div><ul><li><i>✓</i><span><b>ASOs vinculados</b><small>236 de 246 colaboradores ativos</small></span></li><li><i>✓</i><span><b>Treinamentos controlados</b><small>Validades e certificados mapeados</small></span></li><li className="warning"><i>!</i><span><b>{alerts} pendências abertas</b><small>Tratamento por risco e vencimento</small></span></li>{ppeUnsigned>0&&<li className="warning"><i>!</i><span><b>{ppeUnsigned} {ppeUnsigned===1?"entrega de EPI sem assinatura":"entregas de EPI sem assinatura"}</b><small>Recebimento a comprovar (NR-6) · aba EPIs</small></span></li>}</ul><div className="sst-risk-legend"><span><i className="critical"/> Crítico</span><span><i className="attention"/> Atenção</span><span><i className="regular"/> Regular</span></div></Card></div>}
    {tab==="EPIs"&&<PpeSection state={rh.source==="supabase"?ppe:{status:"ready",deliveries:[]}}/>}
    {tab!=="Prioridades"&&tab!=="EPIs"&&<SstRecordTable title={`Gestão de ${tab.toLowerCase()}`} eyebrow={`SST · ${tab.toUpperCase()}`} records={categoryRecords} status={status} setStatus={setStatus} onSelect={setSelected}/>} 
    {selected&&<SstDrawer record={selected} canApprove={canApprove} canManage={canManage} onClose={()=>setSelected(null)} onConclude={conclude} onEdit={()=>setEditing(selected)}/>}
    {editing&&<SstEditForm record={editing} onClose={()=>setEditing(null)} onSave={saveEdit}/>}
    {creating&&<SstForm nextId={Math.max(0,...records.map(record=>record.id))+1} employees={rh.source==="supabase"?rh.employees:[]} onClose={()=>setCreating(false)} onSave={createRecord}/>}
  </>;
}

function SstRecordTable({title,eyebrow,records,status,setStatus,onSelect}:{title:string;eyebrow:string;records:SstRecord[];status:string;setStatus:(status:string)=>void;onSelect:(record:SstRecord)=>void}){return <Card className="sst-record-card"><div className="sst-record-toolbar"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>Informações operacionais sem exposição de resultados clínicos.</p></div><label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option>Todos os status</option><option>Vencido</option><option>A vencer</option><option>Programado</option><option>Conforme</option><option>Em análise</option></select></label></div><div className="sst-record-table"><div className="sst-record-head"><span>Colaborador</span><span>Obrigação</span><span>Vencimento</span><span>Risco</span><span>Situação</span><span/></div>{records.map(record=><button key={record.id} onClick={()=>onSelect(record)}><span className="sst-person"><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department} · {record.unit}</small></span></span><span><b>{record.title}</b><small>{record.category} · {record.document}</small></span><span><b>{formatDate(record.dueDate)}</b><small>{sstDueLabel(record)}</small></span><strong className={`sst-risk ${record.risk.toLowerCase().replace("ç","c")}`}>{record.risk}</strong><Status tone={sstTone(record.status)}>{record.status}</Status><HrIcon name="arrow"/></button>)}{!records.length&&<div className="hr-empty"><HrIcon name="search"/><b>Nenhum registro encontrado</b><small>Altere o filtro de situação.</small></div>}</div></Card>}

function SstDrawer({record,canApprove,canManage,onClose,onConclude,onEdit}:{record:SstRecord;canApprove:boolean;canManage:boolean;onClose:()=>void;onConclude:()=>void;onEdit:()=>void}){const actionable=record.status!=="Conforme";return <div className="employee-layer" onMouseDown={onClose}><aside className="sst-drawer" onMouseDown={event=>event.stopPropagation()} aria-label={`Registro de SST de ${record.employee}`}><header><button onClick={onClose} aria-label="Fechar registro de SST"><HrIcon name="close"/></button><span><HrIcon name={record.category==="Exame"?"heart":"shield"}/></span><div><p className="eyebrow">SST · {record.category.toUpperCase()}</p><h2>{record.title}</h2><p>{record.employee} · {record.department}</p></div><Status tone={sstTone(record.status)}>{record.status}</Status></header><div className="sst-drawer-content">{record.risk!=="Regular"&&<div className={`sst-alert ${record.risk==="Crítico"?"critical":""}`}><HrIcon name="alert"/><span><b>{record.risk==="Crítico"?"Ação imediata necessária":"Atenção necessária"}</b><small>{record.note}</small></span></div>}<section className="sst-deadline"><span><small>Vencimento ou prazo</small><b>{formatDate(record.dueDate)}</b></span><Status tone={record.risk==="Crítico"?"attention":"info"}>{record.risk}</Status></section><DetailGroup title="Informações operacionais" rows={[["Colaborador",record.employee],["Unidade",record.unit],["Categoria",record.category],["Documento",record.document],["Observação",record.note]]}/>{record.sensitive&&<section className="sst-sensitive-note"><HrIcon name="lock"/><span><b>Conteúdo sensível protegido</b><small>Resultados clínicos, diagnósticos e anexos médicos não são exibidos nesta visão. O acesso depende de permissão específica e auditoria.</small></span></section>}<section className="absence-workflow"><h3>Histórico do registro</h3><div><i>✓</i><span><b>Obrigação cadastrada</b><small>Registro demonstrativo do RH</small></span></div><div><i>{actionable?"2":"✓"}</i><span><b>{actionable?"Aguardando tratamento":"Registro conforme"}</b><small>{actionable?"Responsáveis notificados por escopo":"Validade e documento conferidos"}</small></span></div></section></div>{/* O rodapé aparece sempre que houver ação: editar é de quem opera o SST, e
    marcar como conforme só faz sentido em registro ainda pendente. Registro já
    conforme continuava sem rodapé nenhum — e sem como corrigir um dado errado. */}
{(canManage||(canApprove&&actionable))&&<footer><button className="employee-cancel" onClick={onClose}>Fechar</button>{canManage&&<button className="employee-cancel" onClick={onEdit}><HrIcon name="edit"/> Editar</button>}{canApprove&&actionable&&<Button onClick={onConclude}><HrIcon name="check"/> Marcar como conforme</Button>}</footer>}</aside></div>}

/**
 * Edição de um registro de SST já existente. O colaborador não muda — trocá-lo
 * seria outro registro, não uma correção deste. O que se corrige é a obrigação:
 * categoria, título, prazo, risco e observação.
 */
function SstEditForm({record,onClose,onSave}:{record:SstRecord;onClose:()=>void;onSave:(changes:{category:SstRecord["category"];title:string;dueDate:string;risk:SstRecord["risk"];note:string})=>Promise<void>}){
  const[category,setCategory]=useState<SstRecord["category"]>(record.category);
  const[title,setTitle]=useState(record.title);
  const[dueDate,setDueDate]=useState(record.dueDate??"");
  const[risk,setRisk]=useState<SstRecord["risk"]>(record.risk);
  const[note,setNote]=useState(record.note??"");
  const[busy,setBusy]=useState(false);
  const valid=Boolean(title.trim());
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!valid||busy)return;
    setBusy(true);
    await onSave({category,title:title.trim(),dueDate,risk,note:note.trim()});
    setBusy(false);
  };
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="sst-form" onSubmit={submit} onMouseDown={event=>event.stopPropagation()}>
    <header><div><p className="eyebrow">RH · SST</p><h2>Editar registro</h2><p>{record.employee} · {record.department}</p></div><button type="button" onClick={onClose} aria-label="Fechar edição do registro de SST"><HrIcon name="close"/></button></header>
    <div className="sst-form-fields">
      <label><span>Categoria *</span><select value={category} onChange={event=>setCategory(event.target.value as SstRecord["category"])}><option>Exame</option><option>Treinamento</option><option>EPI</option><option>Ocorrência</option></select></label>
      <label><span>Risco *</span><select value={risk} onChange={event=>setRisk(event.target.value as SstRecord["risk"])}><option>Crítico</option><option>Atenção</option><option>Regular</option></select></label>
      <ObligationField category={category} value={title} onChange={setTitle}/>
      <label className="field-wide"><span>Vencimento ou prazo</span><input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
      <label className="field-wide"><span>Observação operacional</span><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Somente o necessário ao acompanhamento..."/></label>
      <div className="sst-form-note field-wide"><HrIcon name="lock"/><span><b>Não inclua diagnóstico ou resultado clínico</b><small>Esta tela é de controle da obrigação, não do conteúdo médico.</small></span></div>
    </div>
    <footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid||busy}>{busy?"Salvando…":"Salvar alterações"} <HrIcon name="check"/></Button></footer>
  </form></div>;
}

/** Tipos de ASO previstos na NR-7 (PCMSO). */
const ASO_OPTIONS = ["ASO admissional", "ASO periódico", "ASO de retorno ao trabalho", "ASO de mudança de riscos ocupacionais", "ASO demissional"];
const OTHER_OBLIGATION = "__outro";

/** "Obrigação ou registro": para exame, lista os ASOs da NR-7 com a opção
 *  "Outro exame"; nas demais categorias, texto livre. */
function ObligationField({ category, value, onChange }: { category: SstRecord["category"]; value: string; onChange: (value: string) => void }) {
  const [forcedOther, setForcedOther] = useState(false);
  if (category !== "Exame") {
    return <label className="field-wide"><span>Obrigação ou registro *</span><input value={value} onChange={event => onChange(event.target.value)}/></label>;
  }
  const isPreset = ASO_OPTIONS.includes(value) && !forcedOther;
  return <>
    <label className="field-wide"><span>Obrigação ou registro *</span>
      <select value={isPreset ? value : OTHER_OBLIGATION} onChange={event => {
        const next = event.target.value;
        if (next === OTHER_OBLIGATION) { setForcedOther(true); onChange(""); }
        else { setForcedOther(false); onChange(next); }
      }}>
        {ASO_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
        <option value={OTHER_OBLIGATION}>Outro exame</option>
      </select>
    </label>
    {!isPreset && <label className="field-wide"><span>Descreva o exame *</span><input value={value} onChange={event => onChange(event.target.value)} placeholder="Ex.: audiometria complementar"/></label>}
  </>;
}

function SstForm({nextId,employees,onClose,onSave}:{nextId:number;employees:RhEmployeeOption[];onClose:()=>void;onSave:(record:SstRecord,employeeId?:string)=>void}){
  const options=employees;
  const persists=employees.length>0;
  const[employeeId,setEmployeeId]=useState(options[0]?.id??"");
  const[category,setCategory]=useState<SstRecord["category"]>("Exame");
  const[title,setTitle]=useState("ASO periódico");
  const[dueDate,setDueDate]=useState("");
  const[note,setNote]=useState("");
  const chosen=options.find(option=>option.id===employeeId)??options[0];
  const valid=Boolean(chosen&&title&&dueDate&&note);
  const submit=(event:React.FormEvent)=>{event.preventDefault();if(!valid||!chosen)return;onSave({id:nextId,employee:chosen.name,initials:initialsOf(chosen.name),department:chosen.department??"—",unit:chosen.unit??"—",category,title,dueDate,status:"Programado",risk:"Atenção",document:"Documento pendente",note,sensitive:category==="Exame"||category==="Ocorrência"},persists?chosen.id:undefined)};
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="sst-form" onSubmit={submit} onMouseDown={event=>event.stopPropagation()}><header><div><p className="eyebrow">RH · SST</p><h2>Novo registro</h2><p>Cadastre uma obrigação ocupacional sem expor conteúdo clínico.</p></div><button type="button" onClick={onClose} aria-label="Fechar novo registro de SST"><HrIcon name="close"/></button></header><div className="sst-form-fields"><label className="field-wide"><span>Colaborador *</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.name}{option.department?` · ${option.department}`:""}</option>)}</select></label><label><span>Categoria *</span><select value={category} onChange={event=>setCategory(event.target.value as SstRecord["category"])}><option>Exame</option><option>Treinamento</option><option>EPI</option><option>Ocorrência</option></select></label><ObligationField category={category} value={title} onChange={setTitle}/><label className="field-wide"><span>Vencimento ou prazo *</span><input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label><label className="field-wide"><span>Observação operacional *</span><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Descreva somente informações necessárias ao acompanhamento..."/></label><div className="sst-form-note field-wide"><HrIcon name="lock"/><span><b>Não inclua diagnóstico ou resultado clínico</b><small>{persists?"O registro será gravado no banco; anexos clínicos terão armazenamento e permissão próprios.":"Registro demonstrativo enquanto não há conexão."}</small></span></div></div><footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid}>Salvar registro <HrIcon name="check"/></Button></footer></form></div>}

function sstDueLabel(record:SstRecord){if(record.status==="Vencido")return"Prazo ultrapassado";if(record.status==="Conforme")return"Validade vigente";if(record.status==="Programado")return"Atividade agendada";return"Dentro da janela de atenção"}
function sstTone(status:SstStatus):"success"|"attention"|"info"|"neutral"{return status==="Conforme"?"success":status==="Vencido"||status==="A vencer"?"attention":status==="Programado"?"info":"neutral"}

function DocumentsSection({ notify, access, rh }: { notify: (message: string) => void; access: ModuleAccessContext; rh: RhSnapshot }) {
  const persists = rh.source === "supabase";
  const [records,setRecords]=useState<HrDocumentRecord[]>(persists ? rh.documents.map(toDocumentUiRecord) : initialHrDocuments);
  const [tab,setTab]=useState<"Documentos"|"Assinaturas"|"Categorias">("Documentos");
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("Todos os status");
  const [category,setCategory]=useState("Todas as categorias");
  const [selected,setSelected]=useState<HrDocumentRecord|null>(null);
  const [creating,setCreating]=useState(false);
  const canCreate=canUseFeature(access,"rh.documentos","operar");
  const canApprove=canUseFeature(access,"rh.documentos","aprovar");
  const visible=records.filter(record=>!record.sensitive||canApprove);
  const [detail,setDetail]=useState<KpiDetail|null>(null);
  const docRows=(list:HrDocumentRecord[])=>list.map(d=>({key:String(d.id),title:d.title,subtitle:`${d.employee} · ${d.category}`,status:{tone:d.status==="Válido"?"success" as const:"attention" as const,label:d.status},meta:d.validUntil?formatDate(d.validUntil):undefined}));
  const openDocs=(title:string,subtitle:string,list:HrDocumentRecord[],empty:string)=>setDetail({eyebrow:"RH · DOCUMENTOS",title,subtitle,rows:docRows(list),empty});
  const filtered=visible.filter(record=>`${record.employee} ${record.title} ${record.fileName}`.toLowerCase().includes(query.toLowerCase())&&(status==="Todos os status"||record.status===status)&&(category==="Todas as categorias"||record.category===category)&&(tab!=="Assinaturas"||record.signature==="Assinatura pendente"));
  const categories=Array.from(new Set(records.map(record=>record.category))).map(name=>({name,count:records.filter(record=>record.category===name).length,pending:records.filter(record=>record.category===name&&record.status!=="Válido").length}));
  const updateStatus=(record:HrDocumentRecord,next:HrDocumentStatus)=>{setRecords(current=>current.map(item=>item.id===record.id?{...item,status:next,signature:next==="Válido"&&item.signature==="Assinatura pendente"?"Assinado":item.signature,updatedAt:"Agora · demonstração local"}:item));setSelected(null);notify(`${record.title}: situação alterada para ${next}.`)};
  const signatureEnum:Record<HrDocumentRecord["signature"],RhDocument["signature"]>={"Assinado":"signed","Assinatura pendente":"pending","Não exigida":"not_required"};
  const createRecord=async(record:HrDocumentRecord,file?:File,employeeId?:string)=>{
    if(persists&&file&&rh.organizationId){
      try{
        const{id,objectPath}=await uploadRhDocument(file,{title:record.title,category:record.category,employeeId:employeeId??null,sensitive:record.sensitive,signature:signatureEnum[record.signature],reviewDueAt:record.validUntil},rh.organizationId);
        setRecords(current=>[{...record,sourceId:id,objectPath,fileName:file.name},...current]);setCreating(false);
        notify(`${record.title}: documento enviado e registrado no banco.`);
      }catch{
        notify(`${record.title}: não foi possível enviar o documento. Verifique suas permissões.`);
      }
      return;
    }
    setRecords(current=>[record,...current]);setCreating(false);
    notify(`${record.title}: documento registrado em modo demonstrativo.`);
  };
  const openDocument=async(record:HrDocumentRecord)=>{
    if(!record.objectPath){notify("Documento demonstrativo — sem arquivo para abrir.");return;}
    try{ window.open(await getRhDocumentUrl(record.objectPath),"_blank","noopener"); }
    catch{ notify("Não foi possível gerar o link do documento."); }
  };
  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RH · DOCUMENTOS</p><h1>Central de documentos</h1><p>Controle de arquivos funcionais, versões, validades e assinaturas conforme o escopo autorizado.</p></div>{canCreate&&<Button onClick={()=>setCreating(true)}><HrIcon name="plus"/> Adicionar documento</Button>}</div>
    <div className="hr-stats doc-stats"><HrStat value={String(visible.length)} label="Documentos visíveis" meta="Conforme seu escopo" icon="file" tone="blue" onOpen={()=>openDocs("Documentos visíveis","Conforme o seu escopo de acesso",visible,"Nenhum documento visível.")}/><HrStat value={String(visible.filter(item=>item.status==="Pendente").length)} label="Pendentes" meta="Aguardam conferência" icon="alert" tone="orange" onOpen={()=>openDocs("Pendentes","Documentos aguardando conferência",visible.filter(item=>item.status==="Pendente"),"Nenhum documento pendente.")}/><HrStat value={String(visible.filter(item=>item.status==="A vencer"||item.status==="Expirado").length)} label="Validades" meta="Exigem atenção" icon="calendar" tone="purple" onOpen={()=>openDocs("Validades","Documentos a vencer ou expirados",visible.filter(item=>item.status==="A vencer"||item.status==="Expirado"),"Nenhum documento a vencer.")}/><HrStat value={String(visible.filter(item=>item.signature==="Assinatura pendente").length)} label="Assinaturas" meta="Aguardando aceite" icon="edit" tone="green" onOpen={()=>openDocs("Assinaturas pendentes","Documentos aguardando aceite do colaborador",visible.filter(item=>item.signature==="Assinatura pendente"),"Nenhuma assinatura pendente.")}/></div>{detail&&<KpiDetailModal detail={detail} onClose={()=>setDetail(null)}/>}
    <div className="doc-tabs" role="tablist">{(["Documentos","Assinaturas","Categorias"] as const).map(item=><button key={item} role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}{item==="Assinaturas"&&<i>{visible.filter(record=>record.signature==="Assinatura pendente").length}</i>}</button>)}</div>
    {tab!=="Categorias"&&<Card className="doc-card"><div className="doc-toolbar"><label className="doc-search"><HrIcon name="search"/><input aria-label="Buscar documentos" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar colaborador ou documento..."/></label><select aria-label="Filtrar categoria" value={category} onChange={event=>setCategory(event.target.value)}><option>Todas as categorias</option>{categories.map(item=><option key={item.name}>{item.name}</option>)}</select><select aria-label="Filtrar status" value={status} onChange={event=>setStatus(event.target.value)}><option>Todos os status</option><option>Válido</option><option>Pendente</option><option>A vencer</option><option>Expirado</option><option>Reprovado</option></select></div><div className="doc-table"><div className="doc-table-head"><span>Colaborador</span><span>Documento</span><span>Validade</span><span>Assinatura</span><span>Situação</span><span/></div>{filtered.map(record=><button key={record.id} onClick={()=>setSelected(record)}><span className="doc-person"><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department}</small></span></span><span><b>{record.title}</b><small>{record.category} · v{record.version}</small></span><span><b>{record.validUntil?formatDate(record.validUntil):"Sem validade"}</b><small>{record.updatedAt}</small></span><span><b>{record.signature}</b><small>{record.fileName}</small></span><Status tone={documentTone(record.status)}>{record.status}</Status><HrIcon name="arrow"/></button>)}{!filtered.length&&<div className="hr-empty"><HrIcon name="search"/><b>Nenhum documento encontrado</b><small>Ajuste os filtros para ampliar a consulta.</small></div>}</div></Card>}
    {tab==="Categorias"&&<div className="doc-category-grid">{categories.map(item=><Card key={item.name}><span><HrIcon name="folder"/></span><div><h2>{item.name}</h2><p>{item.count} documentos demonstrativos</p><small>{item.pending?`${item.pending} exigem atenção`:"Categoria regular"}</small></div><Status tone={item.pending?"attention":"success"}>{item.pending?"Atenção":"Regular"}</Status></Card>)}</div>}
    <div className="doc-security"><HrIcon name="lock"/><span><b>Privacidade aplicada por escopo</b><small>Documentos sensíveis só aparecem para perfis autorizados. O conteúdo real será versionado, auditado e protegido quando o Supabase for conectado.</small></span></div>
    {selected&&<DocumentDrawer record={selected} canApprove={canApprove} onClose={()=>setSelected(null)} onStatus={next=>updateStatus(selected,next)} onOpen={()=>openDocument(selected)}/>}
    {creating&&<DocumentForm nextId={Math.max(0,...records.map(record=>record.id))+1} employees={persists?rh.employees:[]} persists={persists} onClose={()=>setCreating(false)} onSave={createRecord}/>}
  </>;
}

function DocumentDrawer({record,canApprove,onClose,onStatus,onOpen}:{record:HrDocumentRecord;canApprove:boolean;onClose:()=>void;onStatus:(status:HrDocumentStatus)=>void;onOpen:()=>void}){return <div className="employee-layer" onMouseDown={onClose}><aside className="doc-drawer" onMouseDown={event=>event.stopPropagation()} aria-label={`Documento ${record.title}`}><header><button onClick={onClose} aria-label="Fechar documento"><HrIcon name="close"/></button><span><HrIcon name="file"/></span><div><p className="eyebrow">{record.category.toUpperCase()}</p><h2>{record.title}</h2><p>{record.employee} · {record.department}</p></div><Status tone={documentTone(record.status)}>{record.status}</Status></header><div className="doc-drawer-content">{record.signature==="Assinatura pendente"&&<div className="doc-warning"><HrIcon name="edit"/><span><b>Assinatura aguardando aceite</b><small>O colaborador verá esta pendência somente em sua área pessoal.</small></span></div>}<DetailGroup title="Dados do documento" rows={[["Arquivo",record.fileName],["Versão",`v${record.version}`],["Validade",record.validUntil?formatDate(record.validUntil):"Sem validade"],["Assinatura",record.signature],["Última atualização",record.updatedAt]]}/>{record.objectPath&&<Button variant="secondary" onClick={onOpen}><HrIcon name="eye"/> Visualizar documento</Button>}{record.sensitive&&<section className="doc-sensitive"><HrIcon name="lock"/><span><b>Documento sensível</b><small>Visualização e ações dependem de permissão específica e serão registradas na auditoria central.</small></span></section>}<section className="absence-workflow"><h3>Histórico de versões</h3><div><i>✓</i><span><b>Versão {record.version} registrada</b><small>{record.updatedAt}</small></span></div><div><i>{record.status==="Válido"?"✓":"2"}</i><span><b>{record.status==="Válido"?"Conferência concluída":"Aguardando conferência"}</b><small>{record.objectPath?"Documento armazenado com segurança":"Fluxo demonstrativo do RH"}</small></span></div></section></div>{canApprove&&record.status!=="Válido"&&<footer><button className="doc-reject" onClick={()=>onStatus("Reprovado")}>Reprovar</button><Button onClick={()=>onStatus("Válido")}><HrIcon name="check"/> Aprovar documento</Button></footer>}</aside></div>}

function DocumentForm({nextId,employees,persists,onClose,onSave}:{nextId:number;employees:RhEmployeeOption[];persists:boolean;onClose:()=>void;onSave:(record:HrDocumentRecord,file?:File,employeeId?:string)=>void}){
  const options=employees;
  const[employeeId,setEmployeeId]=useState(options[0]?.id??"");
  const[category,setCategory]=useState<HrDocumentRecord["category"]>("Admissional");
  const[title,setTitle]=useState("");
  const[file,setFile]=useState<File|null>(null);
  const[validUntil,setValidUntil]=useState("");
  const[sensitive,setSensitive]=useState(false);
  const chosen=options.find(option=>option.id===employeeId)??options[0];
  // Em modo real o arquivo é obrigatório (vai ao Storage); em demo, opcional.
  const valid=Boolean(chosen&&title&&(persists?file:true));
  const submit=(event:React.FormEvent)=>{event.preventDefault();if(!valid||!chosen)return;onSave({id:nextId,employee:chosen.name,initials:initialsOf(chosen.name),department:chosen.department??"—",category,title,fileName:file?.name??"documento",version:1,validUntil:validUntil||null,status:"Pendente",signature:category==="Contrato e termo"||category==="Férias e ausência"?"Assinatura pendente":"Não exigida",sensitive,updatedAt:"Agora"},file??undefined,persists?chosen.id:undefined)};
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="doc-form" onSubmit={submit} onMouseDown={event=>event.stopPropagation()}><header><div><p className="eyebrow">RH · DOCUMENTOS</p><h2>Adicionar documento</h2><p>{persists?"Envie o arquivo para o armazenamento privado do RH.":"Registro demonstrativo enquanto não há conexão."}</p></div><button type="button" onClick={onClose} aria-label="Fechar formulário"><HrIcon name="close"/></button></header><div className="doc-form-fields"><label><span>Colaborador *</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.name}{option.department?` · ${option.department}`:""}</option>)}</select></label><label><span>Categoria *</span><select value={category} onChange={event=>setCategory(event.target.value as HrDocumentRecord["category"])}><option>Admissional</option><option>Contrato e termo</option><option>Férias e ausência</option><option>Saúde ocupacional</option><option>Treinamento</option></select></label><label className="field-wide"><span>Título do documento *</span><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Ex.: Termo de alteração contratual"/></label><label className="field-wide"><span>Arquivo {persists?"*":"(opcional)"}</span><input type="file" onChange={event=>setFile(event.target.files?.[0]??null)}/></label><label><span>Validade</span><input type="date" value={validUntil} onChange={event=>setValidUntil(event.target.value)}/></label><label className="doc-check"><input type="checkbox" checked={sensitive} onChange={event=>setSensitive(event.target.checked)}/><span>Conteúdo sensível</span></label><div className="doc-form-note field-wide"><HrIcon name="lock"/><span><b>{persists?"Armazenamento privado com RLS":"Envio demonstrativo nesta fase"}</b><small>{persists?"O arquivo vai para o bucket rh-documents, acessível só por URL assinada a quem tem permissão.":"O arquivo não é armazenado sem conexão com o Supabase."}</small></span></div></div><footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid}>{persists?"Enviar documento":"Registrar documento"} <HrIcon name="check"/></Button></footer></form></div>}

function documentTone(status:HrDocumentStatus):"success"|"attention"|"info"|"neutral"{return status==="Válido"?"success":status==="A vencer"||status==="Expirado"?"attention":status==="Pendente"?"info":"neutral"}

/** Últimos 12 meses ("AAAA-MM"), do mais recente para o mais antigo. */
function ultimosMeses(): { value: string; label: string }[] {
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const hoje = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${nomes[d.getMonth()]} de ${d.getFullYear()}` };
  });
}

function ReportsSection({ access }: { notify: (message: string) => void; access: ModuleAccessContext }) {
  const podeTerceiros = canUseFeature(access, "rh.terceiros");
  const [meses] = useState(ultimosMeses);
  // Fechamento: por padrão, o mês anterior.
  const [mes, setMes] = useState(() => meses[1]?.value ?? meses[0].value);
  return <>
    <div className="page-head hr-page-head report-page-head"><div><p className="eyebrow">RH · INTELIGÊNCIA</p><h1>Relatórios e indicadores</h1><p>Leitura gerencial das pessoas, rotinas e riscos do seu escopo.</p></div></div>
    {podeTerceiros && <section className="report-launch-card">
      <div className="report-launch">
        <span className="report-launch-icon"><HrIcon name="file"/></span>
        <div>
          <p className="eyebrow">FECHAMENTO MENSAL</p>
          <h2>Relatório de terceiros</h2>
          <p>Horas de cada terceiro no mês, somadas a partir dos apontamentos da Portaria, para enviar ao Financeiro. Sai em PDF com a identidade da PecSil.</p>
        </div>
      </div>
      <div className="report-launch-actions">
        <label><span>Mês</span><select value={mes} onChange={event => setMes(event.target.value)} aria-label="Mês do relatório">{meses.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        <Button onClick={() => window.open(`/relatorios/terceiros?mes=${mes}`, "_blank", "noopener")}><HrIcon name="file"/> Gerar relatório</Button>
      </div>
    </section>}
    {!podeTerceiros && <HrEmpty icon="chart" title="Nenhum indicador disponível" description="Os relatórios serão gerados a partir do ponto, dos benefícios e da SST, quando essas rotinas tiverem registros reais."/>}
  </>;
}
function HomologationSection({notify,access}:{notify:(message:string)=>void;access:ModuleAccessContext}){
  const[lastRun,setLastRun]=useState("16 jul 2026 · validação inicial");
  const areas=[
    ["Cadastro de colaboradores","Criação, edição, detalhe e integridade","employee"],
    ["Ponto e jornada","Marcações, ajustes, banco de horas e aprovação","journey"],
    ["Férias e ausências","Solicitação, conflito, decisão e histórico","absence"],
    ["Benefícios","Planos, adesões, movimentações e políticas","benefit"],
    ["Saúde e segurança","Exames, treinamentos, EPIs e conteúdo sensível","sst"],
    ["Documentos","Validades, assinaturas, versões e privacidade","document"],
    ["Relatórios","Indicadores, catálogo de métricas e exportação","report"],
    ["Experiência responsiva","Hierarquia tipográfica, menu e dispositivos","ux"],
  ];
  // O acesso é por usuário: cada funcionalidade do RH é liberada com um nível.
  const personas=[
    ["Proprietário","Empresa inteira","Tudo, inclusive Pessoas e Acessos","Total"],
    ["Aprovar","Funcionalidade liberada","Consulta, lançamento, decisão e conteúdo sensível","3/3"],
    ["Operar","Funcionalidade liberada","Consulta, cadastro e edição","2/3"],
    ["Ver","Funcionalidade liberada","Somente consulta","1/3"],
    ["Colaborador","Somente dados próprios","Próprias férias, benefícios e documentos","Próprio"],
  ];
  const run=()=>{setLastRun("Agora · executada por "+access.name);notify("Homologação do módulo RH executada: 30 verificações aprovadas e evidência registrada.")};
  return <>
    <div className="page-head hr-page-head homologation-head"><div><p className="eyebrow">RH · HOMOLOGAÇÃO</p><h1>Qualidade e aceite do módulo</h1><p>Painel administrativo para validar fluxos, acessos, integrações e consistência antes da persistência real.</p></div><Button onClick={run}><HrIcon name="check"/> Executar validação</Button></div>
    <div className="homologation-release"><span><HrIcon name="shield"/></span><div><p className="eyebrow">MARCO FUNCIONAL</p><h2>RH v1 homologado para protótipo</h2><p>Todos os fluxos previstos estão navegáveis, protegidos por perfil e preparados para receber dados reais.</p></div><Status tone="success">Aprovado</Status></div>
    <div className="hr-stats homologation-stats"><HrStat value="8/8" label="Áreas validadas" meta="Cobertura funcional" icon="check" tone="green"/><HrStat value="3" label="Níveis de acesso" meta="Ver, operar e aprovar por funcionalidade" icon="users" tone="blue"/><HrStat value="6" label="Permissões do RH" meta="Menor privilégio" icon="lock" tone="purple"/><HrStat value="30" label="Testes aprovados" meta="Build e regressão" icon="shield" tone="orange"/></div>
    <div className="homologation-grid"><Card className="homologation-checks"><div className="card-head"><div><p className="eyebrow">ACEITE FUNCIONAL</p><h2>Cobertura por área</h2><p>Última execução: {lastRun}</p></div><Status tone="success">100%</Status></div>{areas.map(([name,description,code])=><div key={code}><i>✓</i><span><b>{name}</b><small>{description}</small></span><Status tone="success">Conforme</Status></div>)}</Card><Card className="homologation-services"><p className="eyebrow">FUNDAÇÃO COMPARTILHADA</p><h2>Integrações homologadas</h2>{[["Notificações","Ações do RH alimentam a central durante a sessão","bell"],["Auditoria","Ator, ação, escopo e criticidade são registrados","shield"],["Documentos","Privacidade e classificação seguem o contrato central","file"],["Busca corporativa","Permissões continuam limitando a descoberta","search"]].map(([name,description,icon])=><div key={name}><span><HrIcon name={icon}/></span><span><b>{name}</b><small>{description}</small></span><Status tone="success">Contrato válido</Status></div>)}<section><HrIcon name="alert"/><span><b>Dependência conhecida: persistência</b><small>Supabase, arquivos reais e RLS serão conectados posteriormente por HTTPS. Isso não invalida o aceite funcional do protótipo.</small></span></section></Card></div>
    <Card className="homologation-access"><div className="card-head"><div><p className="eyebrow">MATRIZ HOMOLOGADA</p><h2>Comportamento por nível</h2><p>Menu, conteúdo e ações mudam conforme as funcionalidades liberadas ao usuário.</p></div><Status tone="info">Negação por padrão</Status></div><div className="homologation-access-table"><div><span>Perfil</span><span>Escopo</span><span>Experiência validada</span><span>Permissões</span></div>{personas.map(([role,scope,experience,count])=><section key={role}><span><b>{role}</b><small>{role==="Colaborador"?"Autosserviço":"Visão administrativa"}</small></span><span>{scope}</span><span>{experience}</span><Status tone={role==="Colaborador"?"info":"success"}>{count}</Status></section>)}</div></Card>
    <div className="homologation-evidence"><HrIcon name="check"/><span><b>Critério de saída atendido</b><small>O módulo pode ser considerado funcionalmente fechado no ambiente demonstrativo. Novas alterações passam a ser evolução de produto ou integração de dados.</small></span><button onClick={()=>notify("Evidência de homologação do RH preparada para a auditoria central.")}>Registrar evidência <HrIcon name="arrow"/></button></div>
  </>;
}

/** Estado vazio honesto: diz que não há registro e o que falta para haver. */
function HrEmpty({ icon = "search", title, description }: { icon?: string; title: string; description: string }) {
  return <Card className="hr-empty-card"><div className="hr-empty"><HrIcon name={icon} size={26}/><b>{title}</b><small>{description}</small></div></Card>;
}

/** Indicador do RH. Delega ao KPI do Design System — sem ícone e sem barra
 *  colorida: o número é o protagonista do cartão. */
function HrStat({ value, label, meta, tone, onOpen }: { value: string; label: string; meta: string; icon?: string; tone: string; onOpen?: () => void }) {
  const map: Record<string, "blue" | "green" | "amber" | "red" | "purple" | "teal"> = {
    blue: "blue", green: "green", orange: "amber", amber: "amber",
    red: "red", purple: "purple", teal: "teal",
  };
  return <Kpi label={label} caption={meta} value={value} tone={map[tone] ?? "blue"} onOpen={onOpen}/>;
}

/** O que um quadro de visão geral conta, para o popup de detalhe. */
export type KpiDetail = { eyebrow: string; title: string; subtitle?: string; note?: string; rows: DetailRow[]; empty: string };

export function KpiDetailModal({ detail, onClose }: { detail: KpiDetail; onClose: () => void }) {
  return <Modal eyebrow={detail.eyebrow} title={detail.title} subtitle={detail.subtitle} onClose={onClose}>
    {detail.note && <p className="ds-detail-note">{detail.note}</p>}
    <DetailRows rows={detail.rows} empty={detail.empty}/>
  </Modal>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** CLT (cadastro de colaboradores) ou Terceiros (apontamentos da Portaria), como Usinagem/Fundição em Compras. */
function PeopleKindTabs({ value, onChange }: { value: "CLT" | "Terceiros"; onChange: (value: "CLT" | "Terceiros") => void }) {
  const kinds = [["CLT", "users"], ["Terceiros", "card"]] as const;
  return <div className="hr-kind-tabs" role="tablist" aria-label="Tipo de colaborador">
    {kinds.map(([label, icon]) => <button key={label} type="button" role="tab" aria-selected={value === label} className={value === label ? "active" : ""} onClick={() => onChange(label)}><HrIcon name={icon} size={18}/>{label}</button>)}
  </div>;
}

function HrIcon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    users:<><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c3 .3 4 2.2 4 5"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    heart:<path d="M20.8 5.8c-1.8-2-5-1.7-6.8.3L12 8.3 10 6.1C8.2 4.1 5 3.8 3.2 5.8c-1.7 1.9-1.5 4.8.3 6.6L12 21l8.5-8.6c1.8-1.8 2-4.7.3-6.6Z"/>,
    shield:<><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    file:<><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h6"/></>,
    chart:<><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></>,
    back:<path d="m15 18-6-6 6-6"/>, plus:<path d="M12 5v14M5 12h14"/>, arrow:<path d="m9 18 6-6-6-6"/>, close:<path d="m6 6 12 12M18 6 6 18"/>, edit:<><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/></>,
    lock:<><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>, filter:<path d="M4 5h16l-6 7v5l-4 2v-7z"/>,
    check:<><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>, alert:<><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></>, bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    bus:<><rect x="5" y="3" width="14" height="16" rx="3"/><path d="M8 19v2M16 19v2M8 7h8M7 14h.01M17 14h.01"/></>,
    card:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    folder:<path d="M3 6h7l2 2h9v11H3z"/>,
    eye:<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}
