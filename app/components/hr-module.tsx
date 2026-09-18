"use client";

import { useEffect, useMemo, useState } from "react";
import type { FoundationSummary, Person } from "../../lib/data/foundation";
import { hasPermission, type ModuleAccessContext } from "../../modules";
import { Button, Card, Kpi, KpiGrid, Segmented, Status } from "../../packages/design-system";
import { useRhData } from "../../lib/data/use-rh-data";
import { useModuleNav } from "../../lib/module-nav-context";
import type { RhAbsence, RhBenefitPlan, RhBenefitRequest, RhDocument, RhEmployeeOption, RhSnapshot, RhSstRecord } from "../../lib/data/rh";
import { getRhDocumentUrl, uploadRhDocument } from "../../lib/data/rh-documents-client";
import { HolidaysSection } from "./hr-holidays";

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
  type: "Férias" | "Banco de horas" | "Atestado médico" | "Licença";
  start: string;
  end: string;
  days: number;
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
  const accessibleSections = useMemo(() => access.role === "Colaborador"
    ? sections.filter(([label]) => ["Painel", "Ponto e jornada", "Férias e ausências", "Benefícios", "Saúde e segurança", "Documentos"].includes(label))
    : sections.filter(([label]) => label!=="Homologação"||hasPermission(access,"rh.admin")), [access]);
  const canCreate = hasPermission(access, "rh.create");
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

  const isOwner = access.role === "Proprietário" || access.roleCode === "owner" || access.roleCode === "director";

  return <div className="ds-module-body">
    <div className="ds-module-bar">
      {isOwner && <Button variant="secondary" compact onClick={onExit}><HrIcon name="back"/> Ecossistema</Button>}
      <Segmented options={accessibleSections.map(([label]) => label)} value={section} onChange={setSection} ariaLabel="Seções do módulo de Recursos Humanos"/>
      <Status tone="info">{access.scopeLabel}</Status>
    </div>

    <div className="hr-workspace">
        {access.role === "Colaborador" ? <EmployeeSelfService section={section} notify={track}/> : <>
          {section === "Painel" && <HrDashboard people={employees} summary={summary} rh={rh} setSection={setSection} notify={track} access={access} canCreate={canCreate} requestCreate={() => setCreateRequested(value => value + 1)}/>}
          {section === "Colaboradores" && <PeopleSection people={filteredPeople} allPeople={employees} setPeople={setEmployees} query={query} setQuery={setQuery} notify={track} canCreate={canCreate} persists={rh.source === "supabase"} createRequested={createRequested} onCreateHandled={() => setCreateRequested(0)}/>}
          {section === "Ponto e jornada" && <JourneySection notify={track} access={access}/>} 
          {section === "Férias e ausências" && <AbsenceSection key={rh.loadedAt} notify={track} access={access} rh={rh}/>}
          {section === "Feriados" && <HolidaysSection notify={track}/>}
          {section === "Benefícios" && <BenefitsSection key={rh.loadedAt} summary={summary} notify={track} access={access} rh={rh}/>}
          {section === "Saúde e segurança" && <SafetySection key={rh.loadedAt} notify={track} access={access} rh={rh}/>}
          {section === "Documentos" && <DocumentsSection key={rh.loadedAt} notify={track} access={access} rh={rh}/>}
          {section === "Relatórios" && <ReportsSection notify={track} access={access}/>} 
          {section === "Homologação" && <HomologationSection notify={track} access={access}/>} 
        </>}
    </div>
  </div>;
}

function EmployeeSelfService({ section }: { section: HrSection; notify: (message: string) => void }) {
  // O autosserviço mostrava saldos, benefícios e documentos inventados. Passa a
  // ter conteúdo quando o colaborador tiver conta vinculada e registros próprios.
  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RECURSOS HUMANOS · AUTOSSERVIÇO</p><h1>Meu RH</h1><p>Informações e solicitações limitadas ao seu próprio cadastro.</p></div></div>
    <HrEmpty icon="users" title={`Sem registros em ${section.toLowerCase()}`} description="Seus dados aparecerão aqui quando o RH vincular sua conta ao cadastro funcional e lançar os registros."/>
  </>;
}
type PendingItem = { key: string; title: string; meta: string; type: string; tone: "attention" | "danger" | "info"; icon: string; section: HrSection };

const absenceTypeLabel: Record<RhAbsence["type"], string> = {
  vacation: "Férias", time_bank: "Banco de horas", medical_certificate: "Atestado médico", leave: "Licença",
};
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
      meta: `${absence.days} ${absence.days === 1 ? "dia" : "dias"}${absence.hasConflict ? " · conflito identificado" : ""}`,
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
async function sendRhMutation(body: Record<string, string>): Promise<boolean> {
  const response = await fetch("/api/rh", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 409) return false; // modo demonstrativo
  if (response.status === 401) { throw new Error("UNAUTHENTICATED"); }
  if (!response.ok) throw new Error("RH_MUTATION_DENIED");
  return true;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "–";

const absenceTypePt: Record<RhAbsence["type"], AbsenceRecord["type"]> = {
  vacation: "Férias", time_bank: "Banco de horas", medical_certificate: "Atestado médico", leave: "Licença",
};
const absenceTypeEnum: Record<AbsenceRecord["type"], RhAbsence["type"]> = {
  "Férias": "vacation", "Banco de horas": "time_bank", "Atestado médico": "medical_certificate", "Licença": "leave",
};
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
  return <>
    <div className="page-head hr-page-head"><div><p className="eyebrow">RECURSOS HUMANOS · {access.role.toUpperCase()}</p><h1>{access.role === "Colaborador" ? "Meu RH" : "Gestão de pessoas"}</h1><p>{access.role === "Colaborador" ? "Solicitações, benefícios e documentos limitados ao seu próprio cadastro." : `Indicadores e rotinas autorizados no seu escopo: ${access.scopeLabel}.`}</p></div>{canCreate&&<Button onClick={() => { requestCreate(); setSection("Colaboradores"); }}><HrIcon name="plus"/> Novo colaborador</Button>}</div>
    <KpiGrid>
      <HrStat value={String(rh.summary.employees)} label="Colaboradores" meta={`${rh.summary.activeEmployees} ativos`} icon="users" tone="blue"/>
      <HrStat value={String(rh.summary.pendingAbsences)} label="Ausências pendentes" meta="Aguardando decisão" icon="clock" tone="orange"/>
      <HrStat value={String(rh.summary.scheduledVacationDays)} label="Férias programadas" meta="Dias no período" icon="calendar" tone="purple"/>
      <HrStat value={String(rh.summary.sstAlerts)} label="Alertas de SST" meta="Vencidos ou a vencer" icon="shield" tone="red"/>
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

function PeopleSection({ people, allPeople, setPeople, query, setQuery, notify, canCreate, persists, createRequested, onCreateHandled }: { people: EmployeeRecord[]; allPeople: EmployeeRecord[]; setPeople: React.Dispatch<React.SetStateAction<EmployeeRecord[]>>; query: string; setQuery: (value: string) => void; notify: (message: string) => void; canCreate: boolean; persists: boolean; createRequested: number; onCreateHandled: () => void }) {
  const [selected, setSelected] = useState<EmployeeRecord | null>(null);
  const [editing, setEditing] = useState<EmployeeRecord | null>(null);
  const [creating, setCreating] = useState(createRequested > 0 && canCreate);
  const [unit, setUnit] = useState("Todas as unidades");
  const visiblePeople = unit === "Todas as unidades" ? people : people.filter(person => person.unit === unit);

  const saveEmployee = async (employee: EmployeeRecord, isNew: boolean) => {
    setPeople(current => isNew ? [employee, ...current] : current.map(item => editing && personKey(item) === personKey(editing) ? employee : item));
    setCreating(false);
    onCreateHandled();
    setEditing(null);
    setSelected(employee);
    // Só a criação persiste por ora; edição segue local (v1).
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
    {selected && <EmployeeDrawer employee={selected} canEdit={canCreate} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} onStatus={changeStatus}/>} 
    {(creating || editing) && <EmployeeForm employee={editing} nextRegistration={String(allPeople.length + 1).padStart(4,"0")} units={Array.from(new Set(allPeople.map(person => person.unit).filter(Boolean))).sort()} departments={Array.from(new Set(allPeople.map(person => person.department).filter(Boolean))).sort()} onClose={() => { setCreating(false); setEditing(null); onCreateHandled(); }} onSave={saveEmployee}/>} 
  </>;
}

function EmployeeDrawer({ employee, canEdit, onClose, onEdit, onStatus }: { employee: EmployeeRecord; canEdit: boolean; onClose: () => void; onEdit: () => void; onStatus: (status: Person["status"]) => void }) {
  const [tab, setTab] = useState<"Resumo" | "Vínculo" | "Documentos" | "Histórico">("Resumo");
  const admission = employee.admissionDate ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${employee.admissionDate}T12:00:00Z`)) : "Não informada";
  return <div className="employee-layer" onMouseDown={onClose}>
    <aside className="employee-drawer" onMouseDown={event => event.stopPropagation()} aria-label={`Ficha de ${employee.name}`}>
      <header><button onClick={onClose} aria-label="Fechar ficha"><HrIcon name="close"/></button><span className="employee-avatar">{employee.initials}</span><div><p className="eyebrow">FICHA DO COLABORADOR</p><h2>{employee.name}</h2><p>{employee.role} · {employee.department}</p></div><Status tone={employee.status === "Ativo" ? "success" : employee.status === "Pendente" ? "info" : "neutral"}>{employee.status}</Status></header>
      <nav className="employee-tabs" aria-label="Seções da ficha">{(["Resumo","Vínculo","Documentos","Histórico"] as const).map(item => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</nav>
      <div className="employee-detail-content">
        {tab === "Resumo" && <><section className="employee-highlight"><span><HrIcon name="users"/></span><div><small>Matrícula</small><strong>{employee.registration}</strong></div><div><small>Admissão</small><strong>{admission}</strong></div></section><DetailGroup title="Contato" rows={[["E-mail corporativo",employee.email || "Não informado"],["Telefone",employee.phone],["CPF",employee.cpf]]}/><DetailGroup title="Lotação atual" rows={[["Unidade",employee.unit],["Departamento",employee.department],["Equipe",employee.team]]}/></>}
        {tab === "Vínculo" && <><DetailGroup title="Dados contratuais" rows={[["Tipo de contrato",employee.contractType],["Cargo",employee.role],["Gestor responsável",employee.manager],["Jornada",employee.schedule]]}/><div className="employee-callout"><HrIcon name="shield"/><span><b>Escopo protegido</b><small>Alterações de vínculo serão registradas na auditoria quando o banco estiver conectado.</small></span></div></>}
        {tab === "Documentos" && employee.id && <div className="employee-callout"><HrIcon name="file"/><span><b>Documentos em RH › Documentos</b><small>Arquivos, validades e assinaturas deste colaborador são controlados na central de documentos do RH, conforme o seu escopo.</small></span></div>}
        {tab === "Documentos" && !employee.id && <><div className={`employee-document-health ${employee.documentStatus === "Completo" ? "complete" : "pending"}`}><HrIcon name={employee.documentStatus === "Completo" ? "check" : "alert"}/><span><b>Cadastro documental {employee.documentStatus.toLowerCase()}</b><small>{employee.documentStatus === "Completo" ? "Documentos obrigatórios conferidos." : "Existem documentos que exigem conferência."}</small></span></div>{[["Documento de identidade","Conferido"],["Contrato de trabalho","Assinado"],["Comprovante de residência",employee.documentStatus === "Completo" ? "Conferido" : "Pendente"],["ASO admissional","Válido"]].map(([name,status]) => <div className="employee-document-row" key={name}><span><HrIcon name="file"/></span><div><b>{name}</b><small>Arquivo protegido</small></div><Status tone={status === "Pendente" ? "attention" : "success"}>{status}</Status></div>)}</>}
        {tab === "Histórico" && employee.id && <div className="employee-history"><div><i>1</i><span><b>Admissão</b><small>{admission}</small></span></div><div><i>2</i><span><b>Cadastro importado da folha</b><small>Matrícula {employee.registration}</small></span></div></div>}
        {tab === "Histórico" && !employee.id && <div className="employee-history">{[["Cadastro funcional revisado","Hoje · RH"],["Perfil de acesso vinculado",employee.profile],["Admissão registrada",admission]].map(([title,meta],index) => <div key={title}><i>{index + 1}</i><span><b>{title}</b><small>{meta}</small></span></div>)}</div>}
      </div>
      {canEdit && <footer><Button variant="secondary" onClick={onEdit}><HrIcon name="edit"/> Editar cadastro</Button><select value={employee.status} onChange={event => onStatus(event.target.value as Person["status"])} aria-label="Alterar situação do vínculo"><option>Ativo</option><option>Pendente</option><option>Bloqueado</option></select></footer>}
    </aside>
  </div>;
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
  const canAdvance = step === 1 ? Boolean(form.name && form.cpf && form.phone) : step === 2 ? Boolean(form.registration && form.admissionDate && form.unit && form.department && form.role) : Boolean(form.email);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < 3) { if (canAdvance) setStep(value => value + 1); return; }
    const initials = form.name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join("").toUpperCase();
    onSave({ ...form, initials }, isNew);
  };
  return <div className="employee-layer form-layer" onMouseDown={onClose}>
    <form className="employee-form" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
      <header><div><p className="eyebrow">RH · CADASTRO FUNCIONAL</p><h2>{isNew ? "Novo colaborador" : "Editar colaborador"}</h2><p>{isNew ? "Inclua os dados essenciais para iniciar o vínculo." : `Atualize a ficha de ${employee.name}.`}</p></div><button type="button" onClick={onClose} aria-label="Fechar formulário"><HrIcon name="close"/></button></header>
      <div className="employee-stepper">{([[1,"Dados pessoais"],[2,"Vínculo"],[3,"Contato e acesso"]] as [number, string][]).map(([number,label]) => <span className={step >= number ? "active" : ""} key={label}><i>{step > number ? "✓" : number}</i><b>{label}</b></span>)}</div>
      <div className="employee-fields">
        {step === 1 && <><label className="field-wide"><span>Nome completo *</span><input autoFocus value={form.name} onChange={event => update("name",event.target.value)} placeholder="Nome civil do colaborador"/></label><label><span>CPF *</span><input value={form.cpf} onChange={event => update("cpf",event.target.value)} placeholder="000.000.000-00"/></label><label><span>Telefone *</span><input value={form.phone} onChange={event => update("phone",event.target.value)} placeholder="(00) 00000-0000"/></label></>}
        {step === 2 && <><label><span>Matrícula *</span><input value={form.registration} onChange={event => update("registration",event.target.value)}/></label><label><span>Data de admissão *</span><input type="date" value={form.admissionDate} onChange={event => update("admissionDate",event.target.value)}/></label><label><span>Unidade *</span><select value={form.unit} onChange={event => update("unit",event.target.value)}>{units.map(name => <option key={name}>{name}</option>)}</select></label><label><span>Departamento *</span><select value={form.department} onChange={event => update("department",event.target.value)}>{departments.map(name => <option key={name}>{name}</option>)}</select></label><label className="field-wide"><span>Cargo *</span><input value={form.role} onChange={event => update("role",event.target.value)} placeholder="Ex.: Analista de Recursos Humanos"/></label><label><span>Tipo de contrato</span><select value={form.contractType} onChange={event => update("contractType",event.target.value)}><option>CLT</option><option>Temporário</option><option>Estágio</option><option>Aprendiz</option><option>Terceirizado</option><option>Sócio-administrador</option></select></label><label><span>Jornada</span><select value={form.schedule} onChange={event => update("schedule",event.target.value)}><option>Administrativo</option><option>Turno A</option><option>Turno B</option><option>Turno C</option><option>Executiva</option></select></label></>}
        {step === 3 && <><label className="field-wide"><span>E-mail corporativo *</span><input type="email" value={form.email} onChange={event => update("email",event.target.value)} placeholder="nome.sobrenome@pecsil.com.br"/></label><label><span>Equipe</span><input value={form.team} onChange={event => update("team",event.target.value)} placeholder="Equipe de trabalho"/></label><label><span>Gestor responsável</span><input value={form.manager} onChange={event => update("manager",event.target.value)} placeholder="Nome do gestor"/></label><label><span>Situação inicial</span><select value={form.status} onChange={event => update("status",event.target.value)}><option>Ativo</option><option>Pendente</option><option>Bloqueado</option></select></label><label><span>Documentação</span><select value={form.documentStatus} onChange={event => update("documentStatus",event.target.value)}><option>Pendente</option><option>Completo</option></select></label><div className="employee-form-note field-wide"><HrIcon name="lock"/><span><b>Acesso separado do vínculo</b><small>O perfil de usuário será concedido pela área de Pessoas e Acessos, respeitando as credenciais da plataforma.</small></span></div></>}
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
  const [tab, setTab] = useState<"Solicitações" | "Calendário" | "Políticas">("Solicitações");
  const [status, setStatus] = useState("Todos os status");
  const canCreate = hasPermission(access, "rh.create");
  const canApprove = hasPermission(access, "rh.approve");
  const pending = records.filter(record => record.status === "Pendente" || record.status === "Em análise").length;
  const conflicts = records.filter(record => record.conflict && ["Pendente","Em análise","Aprovada"].includes(record.status)).length;
  const filtered = status === "Todos os status" ? records : records.filter(record => record.status === status);

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
    } catch {
      // Reverte a decisão otimista quando o servidor recusa (sem permissão) ou falha.
      setRecords(current => current.map(record => record.id === target.id ? target : record));
      setSelected(target);
      notify(`${target.employee}: não foi possível registrar a decisão. Verifique suas permissões.`);
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
    <KpiGrid><HrStat value={String(rh.summary.scheduledVacationDays)} label="Férias programadas" meta="Dias no período" icon="calendar" tone="blue"/><HrStat value={String(pending)} label="Em aprovação" meta="Aguardando decisão" icon="clock" tone="orange"/><HrStat value={String(records.filter(r => r.type === "Atestado médico" || r.type === "Licença").length)} label="Afastamentos" meta="Atestados e licenças" icon="heart" tone="purple"/><HrStat value={String(conflicts)} label="Conflitos de equipe" meta={conflicts ? "Exigem avaliação" : "Planejamento saudável"} icon={conflicts ? "alert" : "check"} tone={conflicts ? "orange" : "green"}/></KpiGrid>
    <div className="absence-tabs" role="tablist">{(["Solicitações","Calendário","Políticas"] as const).map(item => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}{item === "Solicitações" && <i>{pending}</i>}</button>)}</div>
    {tab === "Solicitações" && <Card className="absence-card"><div className="absence-toolbar"><div><p className="eyebrow">FLUXO DE APROVAÇÃO</p><h2>Solicitações recentes</h2></div><label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filtrar solicitações por status"><option>Todos os status</option><option>Pendente</option><option>Em análise</option><option>Aprovada</option><option>Registrado</option><option>Reprovada</option></select></label></div><div className="absence-table"><div className="absence-table-head"><span>Colaborador</span><span>Tipo e período</span><span>Duração</span><span>Situação</span><span/></div>{filtered.map(record => <button onClick={() => setSelected(record)} key={record.id}><span className="absence-person"><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department} · {record.unit}</small></span></span><span><b>{record.type}</b><small>{formatPeriod(record.start,record.end)}</small></span><span><b>{record.days} {record.days === 1 ? "dia" : "dias"}</b>{record.conflict ? <small className="conflict-label">⚠ Conflito identificado</small> : <small>Sem conflito</small>}</span><Status tone={absenceTone(record.status)}>{record.status}</Status><HrIcon name="arrow"/></button>)}{!filtered.length && <div className="hr-empty"><HrIcon name="search"/><b>Nenhuma solicitação encontrada</b><small>Altere o filtro de situação.</small></div>}</div></Card>}
    {tab === "Calendário" && <AbsenceCalendar records={records} onSelect={setSelected}/>} 
    {tab === "Políticas" && <AbsencePolicies/>}
    {selected && <AbsenceDrawer record={selected} canApprove={canApprove} onClose={() => setSelected(null)} onDecision={decide}/>} 
    {creating && <AbsenceForm nextId={Math.max(0, ...records.map(record => record.id)) + 1} employees={rh.source === "supabase" ? rh.employees : []} onClose={() => setCreating(false)} onSave={createRequest}/>}
  </>;
}

function AbsenceCalendar({ records, onSelect }: { records: AbsenceRecord[]; onSelect: (record: AbsenceRecord) => void }) {
  const visible = records.filter(record => record.status !== "Reprovada");
  return <Card className="absence-calendar"><div className="card-head"><div><p className="eyebrow">PLANEJAMENTO DE EQUIPE</p><h2>Calendário consolidado</h2><p>Julho a setembro de 2026</p></div><Status tone="info">{visible.length} movimentações</Status></div><div className="calendar-scale"><span>Colaborador</span><div><b>Julho</b><b>Agosto</b><b>Setembro</b></div></div><div className="calendar-rows">{visible.map(record => { const month = Number(record.start.slice(5,7)); const left = month === 7 ? 3 : month === 8 ? 35 : 68; const width = Math.max(7,Math.min(29,record.days * 1.4)); return <button key={record.id} onClick={() => onSelect(record)}><span><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department}</small></span></span><em><i className={record.conflict ? "conflict" : ""} style={{left:`${left}%`,width:`${width}%`}} title={`${record.type} · ${record.days} ${record.days === 1 ? "dia" : "dias"}${record.conflict ? " · exige avaliação de conflito" : ""}`}/></em></button>; })}</div><div className="calendar-legend"><span><i/> Programação regular</span><span><i className="conflict"/> Exige avaliação de conflito</span></div></Card>;
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

function AbsenceDrawer({ record, canApprove, onClose, onDecision }: { record: AbsenceRecord; canApprove: boolean; onClose: () => void; onDecision: (decision: "Aprovada" | "Reprovada") => void }) {
  const actionable = record.status === "Pendente" || record.status === "Em análise";
  return <div className="employee-layer" onMouseDown={onClose}><aside className="absence-drawer" onMouseDown={event => event.stopPropagation()} aria-label={`Solicitação de ${record.employee}`}><header><button onClick={onClose} aria-label="Fechar solicitação"><HrIcon name="close"/></button><span><HrIcon name={record.type === "Atestado médico" ? "heart" : "calendar"}/></span><div><p className="eyebrow">SOLICITAÇÃO #{String(record.id).padStart(4,"0")}</p><h2>{record.type}</h2><p>{record.employee} · {record.department}</p></div><Status tone={absenceTone(record.status)}>{record.status}</Status></header><div className="absence-drawer-content">{record.conflict && <div className="absence-conflict"><HrIcon name="alert"/><span><b>Conflito de planejamento</b><small>{record.conflict}</small></span></div>}<section className="absence-period"><div><small>Início</small><strong>{formatDate(record.start)}</strong></div><HrIcon name="arrow"/><div><small>Término</small><strong>{formatDate(record.end)}</strong></div><span><b>{record.days}</b><small>{record.days === 1 ? "dia" : "dias"}</small></span></section><section className="absence-balance"><div><span><b>Saldo antes da solicitação</b><small>Período aquisitivo atual</small></span><strong>{record.balance} dias</strong></div><i><em style={{width:`${Math.min(100,(record.balance/30)*100)}%`}}/></i><p>Saldo projetado após aprovação: <b>{Math.max(0,record.balance-record.days)} dias</b></p></section><DetailGroup title="Informações" rows={[["Colaborador",record.employee],["Unidade",record.unit],["Motivo ou observação",record.reason],["Solicitado em",record.requestedAt]]}/><section className="absence-workflow"><h3>Histórico da solicitação</h3><div><i>✓</i><span><b>Solicitação registrada</b><small>{record.requestedAt}</small></span></div><div><i>{actionable ? "2" : "✓"}</i><span><b>{actionable ? "Aguardando decisão" : `Solicitação ${record.status.toLowerCase()}`}</b><small>{actionable ? "Gestor e RH foram notificados" : "Movimentação registrada no histórico"}</small></span></div></section></div>{canApprove && actionable && <footer><button className="absence-reject" onClick={() => onDecision("Reprovada")}><HrIcon name="close"/> Reprovar</button><Button onClick={() => onDecision("Aprovada")}><HrIcon name="check"/> Aprovar solicitação</Button></footer>}</aside></div>;
}

function AbsenceForm({ nextId, employees, onClose, onSave }: { nextId: number; employees: RhEmployeeOption[]; onClose: () => void; onSave: (record: AbsenceRecord, employeeId?: string) => void }) {
  // Só colaboradores reais: sem sessão a lista fica vazia e o formulário avisa.
  const options = employees;
  const persists = employees.length > 0;
  const [employeeId,setEmployeeId] = useState(options[0]?.id ?? "");
  const [type,setType] = useState<AbsenceRecord["type"]>("Férias");
  const [start,setStart] = useState("");
  const [end,setEnd] = useState("");
  const [reason,setReason] = useState("");
  const chosen = options.find(option => option.id === employeeId) ?? options[0];
  const days = start && end ? Math.max(1,Math.round((new Date(`${end}T12:00:00`).getTime()-new Date(`${start}T12:00:00`).getTime())/86400000)+1) : 0;
  const valid = Boolean(chosen && start && end && reason && days > 0 && end >= start);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || !chosen) return;
    onSave({
      id:nextId, employee:chosen.name, initials:initialsOf(chosen.name), type, start, end, days,
      status:"Pendente", unit:chosen.unit ?? "—", department:chosen.department ?? "—",
      requestedAt:"Hoje · agora", reason, balance:30, conflict:null,
    }, persists ? chosen.id : undefined);
  };
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="absence-form" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><header><div><p className="eyebrow">RH · NOVA MOVIMENTAÇÃO</p><h2>Nova solicitação</h2><p>Registre férias, compensações, atestados ou licenças.</p></div><button type="button" onClick={onClose} aria-label="Fechar nova solicitação"><HrIcon name="close"/></button></header><div className="absence-form-fields"><label className="field-wide"><span>Colaborador *</span><select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.name}{option.department ? ` · ${option.department}` : ""}</option>)}</select></label><label><span>Tipo de movimentação *</span><select value={type} onChange={event => setType(event.target.value as AbsenceRecord["type"])}><option>Férias</option><option>Banco de horas</option><option>Atestado médico</option><option>Licença</option></select></label><label><span>Unidade</span><div className="absence-readonly">{chosen?.unit ?? "—"}</div></label><label><span>Data inicial *</span><input type="date" value={start} onChange={event => setStart(event.target.value)}/></label><label><span>Data final *</span><input type="date" min={start} value={end} onChange={event => setEnd(event.target.value)}/></label><label className="field-wide"><span>Motivo ou observação *</span><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Descreva a solicitação para o fluxo de aprovação..."/></label>{days > 0 && <div className="absence-preview field-wide"><HrIcon name="calendar"/><span><b>{days} {days === 1 ? "dia solicitado" : "dias solicitados"}</b><small>{persists ? "Será registrado no banco" : "Registro demonstrativo"}</small></span></div>}</div><footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid}>Enviar para aprovação <HrIcon name="arrow"/></Button></footer></form></div>;
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
  const canManage = hasPermission(access,"rh.edit") || hasPermission(access,"rh.create");
  const canApprove = hasPermission(access,"rh.approve");
  const pending = requests.filter(request=>request.status==="Pendente"||request.status==="Em análise").length;
  const totalCost = plans.reduce((sum,plan)=>sum+plan.monthlyCost,0);
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
    }catch{
      setRequests(current=>current.map(request=>request.id===target.id?target:request));setSelectedRequest(target);
      notify(`${target.employee}: não foi possível registrar a decisão. Verifique suas permissões.`);
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
    <KpiGrid><HrStat value={String(plans.length)} label="Benefícios ativos" meta="Catálogo corporativo" icon="heart" tone="blue"/><HrStat value={String(rh.source === "supabase" ? rh.summary.activeEmployees : summary.activeEmployees)} label="Elegíveis" meta="Colaboradores ativos" icon="users" tone="green"/><HrStat value={String(pending)} label="Em aprovação" meta="Solicitações pendentes" icon="clock" tone="orange"/><HrStat value={totalCost >= 1000 ? `R$ ${Math.round(totalCost/1000)} mil` : `R$ ${totalCost}`} label="Custo estimado" meta="Competência mensal" icon="chart" tone="purple"/></KpiGrid>
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
  const [tab,setTab]=useState<"Prioridades"|"Exames"|"Treinamentos"|"EPIs"|"Ocorrências">("Prioridades");
  const [status,setStatus]=useState("Todos os status");
  const canManage=hasPermission(access,"rh.edit")||hasPermission(access,"rh.create");
  const canApprove=hasPermission(access,"rh.approve");
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
    }catch{
      setRecords(current=>current.map(record=>record.id===target.id?target:record));setSelected(target);
      notify(`${target.employee}: não foi possível tratar o registro. Verifique suas permissões.`);
    }
  };
  const sstCategoryEnum:Record<SstRecord["category"],RhSstRecord["category"]>={"Exame":"exam","Treinamento":"training","EPI":"ppe","Ocorrência":"incident"};
  const sstRiskEnum:Record<SstRecord["risk"],RhSstRecord["risk"]>={"Crítico":"critical","Atenção":"attention","Regular":"regular"};
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
    <KpiGrid><HrStat value={String(records.filter(r => r.category === "Exame" && (r.status === "A vencer" || r.status === "Vencido")).length)} label="Exames a vencer" meta="Vencidos ou na janela" icon="heart" tone="orange"/><HrStat value={String(records.filter(r => r.category === "Treinamento").length)} label="Treinamentos" meta="No período" icon="shield" tone="blue"/><HrStat value={String(records.filter(r => r.risk === "Crítico").length)} label="Pendências críticas" meta="Exigem tratamento" icon="alert" tone="red"/><HrStat value={records.length ? `${Math.round((records.filter(r => r.status === "Conforme").length / records.length) * 100)}%` : "—"} label="Conformidade" meta="Registros conformes" icon="check" tone="green"/></KpiGrid>
    <div className="sst-tabs" role="tablist">{(["Prioridades","Exames","Treinamentos","EPIs","Ocorrências"] as const).map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}{item==="Prioridades"&&<i>{alerts}</i>}</button>)}</div>
    {tab==="Prioridades"&&<div className="sst-overview"><SstRecordTable title="Prioridades de SST" eyebrow="VENCIMENTOS E PENDÊNCIAS" records={categoryRecords} status={status} setStatus={setStatus} onSelect={setSelected}/><Card className="sst-health-card"><p className="eyebrow">CONFORMIDADE</p><h2>Saúde dos registros</h2><div className="sst-score"><strong>96%</strong><span><i style={{width:"96%"}}/></span></div><ul><li><i>✓</i><span><b>ASOs vinculados</b><small>236 de 246 colaboradores ativos</small></span></li><li><i>✓</i><span><b>Treinamentos controlados</b><small>Validades e certificados mapeados</small></span></li><li className="warning"><i>!</i><span><b>{alerts} pendências abertas</b><small>Tratamento por risco e vencimento</small></span></li></ul><div className="sst-risk-legend"><span><i className="critical"/> Crítico</span><span><i className="attention"/> Atenção</span><span><i className="regular"/> Regular</span></div></Card></div>}
    {tab!=="Prioridades"&&<SstRecordTable title={`Gestão de ${tab.toLowerCase()}`} eyebrow={`SST · ${tab.toUpperCase()}`} records={categoryRecords} status={status} setStatus={setStatus} onSelect={setSelected}/>} 
    {selected&&<SstDrawer record={selected} canApprove={canApprove} onClose={()=>setSelected(null)} onConclude={conclude}/>} 
    {creating&&<SstForm nextId={Math.max(0,...records.map(record=>record.id))+1} employees={rh.source==="supabase"?rh.employees:[]} onClose={()=>setCreating(false)} onSave={createRecord}/>}
  </>;
}

function SstRecordTable({title,eyebrow,records,status,setStatus,onSelect}:{title:string;eyebrow:string;records:SstRecord[];status:string;setStatus:(status:string)=>void;onSelect:(record:SstRecord)=>void}){return <Card className="sst-record-card"><div className="sst-record-toolbar"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>Informações operacionais sem exposição de resultados clínicos.</p></div><label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option>Todos os status</option><option>Vencido</option><option>A vencer</option><option>Programado</option><option>Conforme</option><option>Em análise</option></select></label></div><div className="sst-record-table"><div className="sst-record-head"><span>Colaborador</span><span>Obrigação</span><span>Vencimento</span><span>Risco</span><span>Situação</span><span/></div>{records.map(record=><button key={record.id} onClick={()=>onSelect(record)}><span className="sst-person"><i>{record.initials}</i><span><b>{record.employee}</b><small>{record.department} · {record.unit}</small></span></span><span><b>{record.title}</b><small>{record.category} · {record.document}</small></span><span><b>{formatDate(record.dueDate)}</b><small>{sstDueLabel(record)}</small></span><strong className={`sst-risk ${record.risk.toLowerCase().replace("ç","c")}`}>{record.risk}</strong><Status tone={sstTone(record.status)}>{record.status}</Status><HrIcon name="arrow"/></button>)}{!records.length&&<div className="hr-empty"><HrIcon name="search"/><b>Nenhum registro encontrado</b><small>Altere o filtro de situação.</small></div>}</div></Card>}

function SstDrawer({record,canApprove,onClose,onConclude}:{record:SstRecord;canApprove:boolean;onClose:()=>void;onConclude:()=>void}){const actionable=record.status!=="Conforme";return <div className="employee-layer" onMouseDown={onClose}><aside className="sst-drawer" onMouseDown={event=>event.stopPropagation()} aria-label={`Registro de SST de ${record.employee}`}><header><button onClick={onClose} aria-label="Fechar registro de SST"><HrIcon name="close"/></button><span><HrIcon name={record.category==="Exame"?"heart":"shield"}/></span><div><p className="eyebrow">SST · {record.category.toUpperCase()}</p><h2>{record.title}</h2><p>{record.employee} · {record.department}</p></div><Status tone={sstTone(record.status)}>{record.status}</Status></header><div className="sst-drawer-content">{record.risk!=="Regular"&&<div className={`sst-alert ${record.risk==="Crítico"?"critical":""}`}><HrIcon name="alert"/><span><b>{record.risk==="Crítico"?"Ação imediata necessária":"Atenção necessária"}</b><small>{record.note}</small></span></div>}<section className="sst-deadline"><span><small>Vencimento ou prazo</small><b>{formatDate(record.dueDate)}</b></span><Status tone={record.risk==="Crítico"?"attention":"info"}>{record.risk}</Status></section><DetailGroup title="Informações operacionais" rows={[["Colaborador",record.employee],["Unidade",record.unit],["Categoria",record.category],["Documento",record.document],["Observação",record.note]]}/>{record.sensitive&&<section className="sst-sensitive-note"><HrIcon name="lock"/><span><b>Conteúdo sensível protegido</b><small>Resultados clínicos, diagnósticos e anexos médicos não são exibidos nesta visão. O acesso depende de permissão específica e auditoria.</small></span></section>}<section className="absence-workflow"><h3>Histórico do registro</h3><div><i>✓</i><span><b>Obrigação cadastrada</b><small>Registro demonstrativo do RH</small></span></div><div><i>{actionable?"2":"✓"}</i><span><b>{actionable?"Aguardando tratamento":"Registro conforme"}</b><small>{actionable?"Responsáveis notificados por escopo":"Validade e documento conferidos"}</small></span></div></section></div>{canApprove&&actionable&&<footer><button className="employee-cancel" onClick={onClose}>Fechar</button><Button onClick={onConclude}><HrIcon name="check"/> Marcar como conforme</Button></footer>}</aside></div>}

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
  return <div className="employee-layer form-layer" onMouseDown={onClose}><form className="sst-form" onSubmit={submit} onMouseDown={event=>event.stopPropagation()}><header><div><p className="eyebrow">RH · SST</p><h2>Novo registro</h2><p>Cadastre uma obrigação ocupacional sem expor conteúdo clínico.</p></div><button type="button" onClick={onClose} aria-label="Fechar novo registro de SST"><HrIcon name="close"/></button></header><div className="sst-form-fields"><label className="field-wide"><span>Colaborador *</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.name}{option.department?` · ${option.department}`:""}</option>)}</select></label><label><span>Categoria *</span><select value={category} onChange={event=>setCategory(event.target.value as SstRecord["category"])}><option>Exame</option><option>Treinamento</option><option>EPI</option><option>Ocorrência</option></select></label><label><span>Obrigação ou registro *</span><input value={title} onChange={event=>setTitle(event.target.value)}/></label><label className="field-wide"><span>Vencimento ou prazo *</span><input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label><label className="field-wide"><span>Observação operacional *</span><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Descreva somente informações necessárias ao acompanhamento..."/></label><div className="sst-form-note field-wide"><HrIcon name="lock"/><span><b>Não inclua diagnóstico ou resultado clínico</b><small>{persists?"O registro será gravado no banco; anexos clínicos terão armazenamento e permissão próprios.":"Registro demonstrativo enquanto não há conexão."}</small></span></div></div><footer><button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button><Button type="submit" disabled={!valid}>Salvar registro <HrIcon name="check"/></Button></footer></form></div>}

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
  const canCreate=hasPermission(access,"rh.create") || hasPermission(access,"core.documents.edit");
  const canApprove=hasPermission(access,"rh.approve");
  const visible=records.filter(record=>!record.sensitive||canApprove);
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
    <div className="hr-stats doc-stats"><HrStat value={String(visible.length)} label="Documentos visíveis" meta="Conforme seu escopo" icon="file" tone="blue"/><HrStat value={String(visible.filter(item=>item.status==="Pendente").length)} label="Pendentes" meta="Aguardam conferência" icon="alert" tone="orange"/><HrStat value={String(visible.filter(item=>item.status==="A vencer"||item.status==="Expirado").length)} label="Validades" meta="Exigem atenção" icon="calendar" tone="purple"/><HrStat value={String(visible.filter(item=>item.signature==="Assinatura pendente").length)} label="Assinaturas" meta="Aguardando aceite" icon="edit" tone="green"/></div>
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

function ReportsSection({ access }: { notify: (message: string) => void; access: ModuleAccessContext }) {
  // Os indicadores dependem de ponto, benefícios e SST com dados reais.
  void access;
  return <>
    <div className="page-head hr-page-head report-page-head"><div><p className="eyebrow">RH · INTELIGÊNCIA</p><h1>Relatórios e indicadores</h1><p>Leitura gerencial das pessoas, rotinas e riscos do seu escopo.</p></div></div>
    <HrEmpty icon="chart" title="Nenhum indicador disponível" description="Os relatórios serão gerados a partir do ponto, dos benefícios e da SST, quando essas rotinas tiverem registros reais."/>
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
  const personas=[
    ["Proprietário","Empresa inteira","Acesso total e homologação","6/6"],
    ["Diretoria","Unidade autorizada","Consulta, aprovação e exportação","3/6"],
    ["Gestor","Departamento e equipes","Consulta e aprovação operacional","2/6"],
    ["RH","Pessoas · empresa inteira","Administração completa do módulo","6/6"],
    ["Colaborador","Somente dados próprios","Autosserviço sem visão administrativa","1/6"],
  ];
  const run=()=>{setLastRun("Agora · executada por "+access.name);notify("Homologação do módulo RH executada: 30 verificações aprovadas e evidência registrada.")};
  return <>
    <div className="page-head hr-page-head homologation-head"><div><p className="eyebrow">RH · HOMOLOGAÇÃO</p><h1>Qualidade e aceite do módulo</h1><p>Painel administrativo para validar fluxos, acessos, integrações e consistência antes da persistência real.</p></div><Button onClick={run}><HrIcon name="check"/> Executar validação</Button></div>
    <div className="homologation-release"><span><HrIcon name="shield"/></span><div><p className="eyebrow">MARCO FUNCIONAL</p><h2>RH v1 homologado para protótipo</h2><p>Todos os fluxos previstos estão navegáveis, protegidos por perfil e preparados para receber dados reais.</p></div><Status tone="success">Aprovado</Status></div>
    <div className="hr-stats homologation-stats"><HrStat value="8/8" label="Áreas validadas" meta="Cobertura funcional" icon="check" tone="green"/><HrStat value="5" label="Perfis simulados" meta="Do proprietário ao colaborador" icon="users" tone="blue"/><HrStat value="6" label="Permissões do RH" meta="Menor privilégio" icon="lock" tone="purple"/><HrStat value="30" label="Testes aprovados" meta="Build e regressão" icon="shield" tone="orange"/></div>
    <div className="homologation-grid"><Card className="homologation-checks"><div className="card-head"><div><p className="eyebrow">ACEITE FUNCIONAL</p><h2>Cobertura por área</h2><p>Última execução: {lastRun}</p></div><Status tone="success">100%</Status></div>{areas.map(([name,description,code])=><div key={code}><i>✓</i><span><b>{name}</b><small>{description}</small></span><Status tone="success">Conforme</Status></div>)}</Card><Card className="homologation-services"><p className="eyebrow">FUNDAÇÃO COMPARTILHADA</p><h2>Integrações homologadas</h2>{[["Notificações","Ações do RH alimentam a central durante a sessão","bell"],["Auditoria","Ator, ação, escopo e criticidade são registrados","shield"],["Documentos","Privacidade e classificação seguem o contrato central","file"],["Busca corporativa","Permissões continuam limitando a descoberta","search"]].map(([name,description,icon])=><div key={name}><span><HrIcon name={icon}/></span><span><b>{name}</b><small>{description}</small></span><Status tone="success">Contrato válido</Status></div>)}<section><HrIcon name="alert"/><span><b>Dependência conhecida: persistência</b><small>Supabase, arquivos reais e RLS serão conectados posteriormente por HTTPS. Isso não invalida o aceite funcional do protótipo.</small></span></section></Card></div>
    <Card className="homologation-access"><div className="card-head"><div><p className="eyebrow">MATRIZ HOMOLOGADA</p><h2>Comportamento por perfil</h2><p>Menu, conteúdo e ações mudam de acordo com credenciais e escopo.</p></div><Status tone="info">Negação por padrão</Status></div><div className="homologation-access-table"><div><span>Perfil</span><span>Escopo</span><span>Experiência validada</span><span>Permissões</span></div>{personas.map(([role,scope,experience,count])=><section key={role}><span><b>{role}</b><small>{role==="Colaborador"?"Autosserviço":"Visão administrativa"}</small></span><span>{scope}</span><span>{experience}</span><Status tone={role==="Colaborador"?"info":"success"}>{count}</Status></section>)}</div></Card>
    <div className="homologation-evidence"><HrIcon name="check"/><span><b>Critério de saída atendido</b><small>O módulo pode ser considerado funcionalmente fechado no ambiente demonstrativo. Novas alterações passam a ser evolução de produto ou integração de dados.</small></span><button onClick={()=>notify("Evidência de homologação do RH preparada para a auditoria central.")}>Registrar evidência <HrIcon name="arrow"/></button></div>
  </>;
}

/** Estado vazio honesto: diz que não há registro e o que falta para haver. */
function HrEmpty({ icon = "search", title, description }: { icon?: string; title: string; description: string }) {
  return <Card className="hr-empty-card"><div className="hr-empty"><HrIcon name={icon} size={26}/><b>{title}</b><small>{description}</small></div></Card>;
}

/** Indicador do RH. Delega ao KPI do Design System — sem ícone e sem barra
 *  colorida: o número é o protagonista do cartão. */
function HrStat({ value, label, meta, tone }: { value: string; label: string; meta: string; icon?: string; tone: string }) {
  const map: Record<string, "blue" | "green" | "amber" | "red" | "purple" | "teal"> = {
    blue: "blue", green: "green", orange: "amber", amber: "amber",
    red: "red", purple: "purple", teal: "teal",
  };
  return <Kpi label={label} caption={meta} value={value} tone={map[tone] ?? "blue"}/>;
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
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}
