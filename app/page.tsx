"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Button, Card, Kpi, KpiGrid, Status, ThemeToggle } from "../packages/design-system";
import type { FoundationSummary, OrganizationData, Person } from "../lib/data/foundation";
import { useFoundationData } from "../lib/data/use-foundation-data";
import { canAccessModule, getCatalogModules, getModuleById, getVisibleModules, hasPermission, moduleRegistry, renderModuleComponent, type ModuleAccessContext, type ModuleManifest } from "../modules";
import { useSessionAccess } from "../lib/data/use-session-access";
import { ModuleNavProvider, useModuleNav } from "../lib/module-nav-context";
import { HrModule } from "./components/hr-module";
import { UserManagement } from "./components/user-management";
import { MasterDataView } from "./components/master-data";
import { EventTrailView } from "./components/event-trail";
import { AccountPanel } from "./components/account-panel";
import { ACCESS_CATALOG, ACCESS_LEVELS, LEVEL_LABELS, levelRank, type AccessGrants } from "../modules/access-catalog";
import { usePwa } from "./components/pwa-provider";

type View = "Visão Geral" | "Módulos" | "Pessoas e Acessos" | "Estrutura" | "Cadastros" | "Eventos" | "Permissões e Segurança" | "Busca Corporativa" | "Documentos" | "Notificações" | "Auditoria" | "Banco e Autenticação" | "Configurações";

type OperationalEvent = {
  id: number;
  title: string;
  message: string;
  actor: string;
  module: string;
  time: string;
  tone: "attention" | "info" | "success";
  risk: "Normal" | "Monitorado" | "Sensível";
  icon: string;
};

const nav: { label: View; icon: string }[] = [
  { label: "Visão Geral", icon: "grid" }, { label: "Módulos", icon: "modules" },
  { label: "Pessoas e Acessos", icon: "users" }, { label: "Estrutura", icon: "org" },
  { label: "Cadastros", icon: "briefcase" }, { label: "Eventos", icon: "clock" },
  { label: "Permissões e Segurança", icon: "lock" },
  { label: "Busca Corporativa", icon: "search" },
  { label: "Documentos", icon: "file" }, { label: "Notificações", icon: "bell" },
  { label: "Auditoria", icon: "shield" }, { label: "Banco e Autenticação", icon: "database" }, { label: "Configurações", icon: "settings" },
];

/** Título e subtítulo que o cabeçalho exibe para cada área. Sempre presente:
 *  uma tela sem título contextual obriga o usuário a se localizar sozinho. */
const headerCopy: Record<View, [string, string]> = {
  "Visão Geral": ["Visão geral", "Estado do ecossistema, módulos e indicadores autorizados"],
  "Módulos": ["Módulos", "Catálogo de domínios e estado de cada um"],
  "Pessoas e Acessos": ["Pessoas e acessos", "Usuários e o que cada um pode acessar"],
  "Estrutura": ["Estrutura empresarial", "Empresa, unidades, departamentos, equipes e cargos"],
  "Cadastros": ["Cadastros", "Fornecedores, clientes e centros de custo usados por todos os módulos"],
  "Eventos": ["Eventos", "O que acontece em cada módulo, em ordem"],
  "Permissões e Segurança": ["Permissões e segurança", "O que cada usuário acessa e como o banco isola os dados"],
  "Busca Corporativa": ["Busca corporativa", "Pessoas, estruturas, documentos e eventos autorizados"],
  "Documentos": ["Documentos", "Arquivos versionados, classificados e rastreáveis"],
  "Notificações": ["Notificações", "Alertas e pendências consolidados dos módulos"],
  "Auditoria": ["Auditoria", "Rastreabilidade imutável de acessos e operações críticas"],
  "Banco e Autenticação": ["Banco e autenticação", "Fundação PostgreSQL, RLS e provisionamento"],
  "Configurações": ["Configurações", "Parâmetros centrais herdados por todos os módulos"],
};

/** Áreas exclusivas do proprietário: acessos de usuários, segurança e infraestrutura. */
const OWNER_ONLY_VIEWS: View[] = ["Pessoas e Acessos", "Permissões e Segurança", "Banco e Autenticação", "Configurações"];

const viewPermissions: Partial<Record<View, string>> = {
  "Pessoas e Acessos": "core.people.view",
  "Estrutura": "core.organization.view",
  "Cadastros": "core.cadastros.view",
  "Eventos": "core.eventos.view",
  "Permissões e Segurança": "core.access.view",
  "Busca Corporativa": "core.search.view",
  "Documentos": "core.documents.view",
  "Notificações": "core.notifications.view",
  "Auditoria": "core.audit.view",
  "Banco e Autenticação": "platform.database.view",
  "Configurações": "platform.settings.view",
};

const dashboardCopy: Record<string, [string,string,string]> = {
  "Proprietário": ["VISÃO EXECUTIVA", "Visão geral da empresa", "Toda a operação, os módulos e os indicadores autorizados."],
  "Diretor": ["VISÃO DA DIRETORIA", "Diretoria", "Indicadores e decisões dentro das áreas sob sua responsabilidade."],
  "Gestor": ["VISÃO DA GESTÃO", "Minha área", "Pendências, pessoas e rotinas do seu escopo."],
  "Operador": ["OPERAÇÃO", "Meu painel", "Rotinas e registros do módulo autorizado."],
  "Colaborador": ["MEU ESPAÇO", "Meu espaço", "Seus documentos, solicitações e informações pessoais."],
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    modules: <><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c3 .3 4 2.2 4 5"/></>,
    org: <><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></>,
    file: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h6"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7-.7-2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>, plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="m9 18 6-6-6-6"/>,
    cart: <><path d="M3 4h2l2 12h10l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></>,
    handshake: <><path d="m11 7 2-2 5 4h3v7h-2l-4 4-3-3"/><path d="M3 9h3l4-4 3 3-3 3 2 2"/><path d="m7 15 2 2"/></>,
    factory: <><path d="M3 21V9l6 3V8l6 4V4h6v17z"/><path d="M7 17h2M12 17h2M17 17h2"/></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>, chart: <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, back: <path d="m15 18-6-6 6-6"/>,
    "panel-close": <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M16 9l-3 3 3 3"/></>,
    "panel-open": <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9l3 3-3 3"/></>,
    building: <><path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-4h6v4M8 9h1M15 9h1M8 13h1M15 13h1"/></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5c0-1 1-2 2-2h4c1 0 2 1 2 2v2M3 12h18M10 12v2h4v-2"/></>,
    team: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-4 2-6 6-6s6 2 6 6M14 15c4 0 7 1.5 7 5"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M13 10l3 3"/></>,
    filter: <path d="M4 5h16l-6 7v5l-4 2v-7z"/>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></>,
    alert: <><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    inbox: <><path d="M4 5h16l2 10v5H2v-5L4 5Z"/><path d="M2 15h6l2 2h4l2-2h6"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
    heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>,
    payable: <><path d="M4 5h16v14H4zM7 9h10M7 13h6"/><path d="m16 16 2 2 3-4"/></>,
    receivable: <><path d="M4 5h16v14H4zM7 9h10M7 13h6"/><path d="M18 12v6M15 15h6"/></>,
    bank: <><path d="m3 9 9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/></>,
    cost: <><circle cx="12" cy="12" r="9"/><path d="M12 6v12M16 9c-1-2-7-2-7 1 0 3 7 1 7 5 0 3-6 3-8 1"/></>,
    report: <><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h6"/></>,
    tree: <><rect x="3" y="3" width="6" height="5" rx="1"/><rect x="13" y="10" width="8" height="4" rx="1"/><rect x="13" y="17" width="8" height="4" rx="1"/><path d="M6 8v11h7M6 12h7"/></>,
    truck: <><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function Overview({ setView, summary, onOpenModule, access, catalogModules, visibleModules }: { setView: (v: View) => void; summary: FoundationSummary; onOpenModule: (moduleId: string) => void; access: ModuleAccessContext; catalogModules: ModuleManifest[]; visibleModules: ModuleManifest[] }) {
  const [eyebrow,title,description]=dashboardCopy[access.role] ?? dashboardCopy.Proprietário;
  // Indicadores do cadastro real; sem números fixos por perfil.
  const metricItems: [string,string,string,string,string][] = [
    ["modules",String(visibleModules.length),visibleModules.length===1?"Módulo autorizado":"Módulos autorizados","Conforme suas credenciais","blue"],
    ["users",String(summary.employees),"Colaboradores","Cadastro funcional","green"],
    ["org",String(summary.departments),"Departamentos",`${summary.teams} ${summary.teams===1?"equipe":"equipes"}`,"purple"],
    ["key",String(summary.users),"Contas de acesso",`${summary.roles} ${summary.roles===1?"perfil":"perfis"}`,"orange"],
  ];
  return <>
    <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><Button onClick={() => setView("Módulos")}><Icon name="modules"/> Explorar módulos</Button></div>
    <KpiGrid>
      {metricItems.map(([,value,label,meta,color]) => <Kpi key={label} label={label} caption={meta} value={value} tone={(color==="orange"?"amber":color) as "blue"|"green"|"amber"|"purple"}/>)}
    </KpiGrid>
    <div className="overview-grid">
      <Card className="executive-card"><div className="card-head"><div><p className="eyebrow">ECOSSISTEMA</p><h2>Mapa da plataforma</h2></div><Status tone="info">Fundação v1</Status></div><div className="system-map"><div className="core"><span><Icon name="grid"/></span><b>Núcleo Pecsil</b><small>Identidade · Acessos · Dados · Auditoria</small></div><div className="connector"/><div className="module-row">{catalogModules.slice(0,5).map(m=><button key={m.name} className={`map-module ${m.color}`} onClick={()=>m.enabled?onOpenModule(m.id):setView("Módulos")}><Icon name={m.icon}/><span>{m.short}</span></button>)}</div><div className="intelligence"><span>S</span><div><b>SARA</b><small>Inteligência transversal — lê a trilha de eventos dos módulos (fase futura)</small></div><Status>Planejado</Status></div></div></Card>
      <Card className="foundation-card"><div className="card-head"><div><p className="eyebrow">ECOSSISTEMA</p><h2>Módulos da plataforma</h2></div><Status tone="info">{moduleRegistry.filter(manifest=>manifest.enabled).length} de {moduleRegistry.length}</Status></div><ul className="check-list">{moduleRegistry.map(manifest=><li key={manifest.id} className={manifest.enabled?"done":""}><span>{manifest.enabled?"✓":"•"}</span><div><b>{manifest.name}</b><small>{manifest.enabled?"Integrado":"Planejado"}</small></div></li>)}</ul></Card>
    </div>
    <Card className="module-preview"><div className="card-head"><div><p className="eyebrow">MÓDULOS AUTORIZADOS</p><h2>Seu ambiente de trabalho</h2><p>O catálogo e o menu respeitam o perfil e o escopo selecionados.</p></div><button className="link-button" onClick={()=>setView("Módulos")}>Ver catálogo <Icon name="arrow"/></button></div><div className="module-strip">{catalogModules.slice(0,4).map(m=><button key={m.name} onClick={()=>m.enabled?onOpenModule(m.id):setView("Módulos")}><span className={`module-icon ${m.color}`}><Icon name={m.icon}/></span><span><b>{m.name}</b><small>{m.status}</small></span><Icon name="arrow"/></button>)}</div></Card>
  </>;
}

function ModuleCatalog({ onOpenModule, modules, access }: { onOpenModule: (moduleId: string) => void; modules: ModuleManifest[]; access: ModuleAccessContext }) {
  const [selected,setSelected] = useState(modules[0]);
  return <><div className="page-head"><div><p className="eyebrow">CATÁLOGO CENTRAL</p><h1>Módulos do ecossistema</h1><p>{access.role === "Proprietário" ? "Visão dos domínios que compõem o ecossistema Pecsil." : `Somente módulos autorizados para ${access.scopeLabel.toLowerCase()}.`}</p></div></div><div className="catalog-layout"><div className="catalog-grid">{modules.map(m=><button className={`module-card ${selected.name===m.name?"selected":""}`} key={m.name} onClick={()=>setSelected(m)}><span className={`module-icon ${m.color}`}><Icon name={m.icon}/></span><Status tone={m.tone}>{m.status}</Status><h2>{m.name}</h2><p>{m.desc}</p><div className="mini-progress"><i style={{width:`${m.progress}%`}}/></div><small>{m.progress ? `${m.progress}% estruturado` : "Aguardando priorização"}</small></button>)}</div><Card className="detail-panel"><span className={`module-icon large ${selected.color}`}><Icon name={selected.icon} size={25}/></span><p className="eyebrow">MÓDULO SELECIONADO</p><h2>{selected.name}</h2><p>{selected.desc}</p><dl><div><dt>Código</dt><dd>{selected.code}</dd></div><div><dt>Estado</dt><dd>{selected.status}</dd></div><div><dt>Rota contratada</dt><dd>{selected.route}</dd></div><div><dt>Permissão de entrada</dt><dd>{selected.access.entryPermission}</dd></div><div><dt>Escopo atual</dt><dd>{access.scopeLabel}</dd></div><div><dt>Serviços centrais</dt><dd>{selected.sharedServices.length} integrações declaradas</dd></div></dl>{selected.enabled?<Button onClick={()=>onOpenModule(selected.id)}>Abrir módulo <Icon name="arrow"/></Button>:<Button variant="secondary">Aguardando ativação <Icon name="lock"/></Button>}</Card></div></>;
}

const organizationTabs = ["Visão geral","Unidades","Departamentos","Equipes","Cargos"] as const;
type OrgTab = typeof organizationTabs[number];

const metricTones = ["blue","green","purple","amber"] as const;

function MetricCards({ items }: { items:[string,string,string][] }) {
  return <KpiGrid>{items.map(([value,label,meta],index)=><Kpi key={label} label={label} caption={meta} value={value} tone={metricTones[index%metricTones.length]}/>)}</KpiGrid>;
}

function OrganizationView({ notify, organizationData, summary, organizationName }: { notify:(message:string)=>void; organizationData: OrganizationData; summary: FoundationSummary; organizationName: string }) {
  const [tab,setTab]=useState<OrgTab>("Visão geral");
  const [selected,setSelected]=useState<string | null>(null);
  const cards = tab === "Visão geral" ? [] : organizationData[tab];
  return <>
    <div className="page-head"><div><p className="eyebrow">ETAPA 2 · ORGANIZAÇÃO</p><h1>Estrutura empresarial</h1><p>Fonte única para empresa, unidades, departamentos, equipes e cargos.</p></div><Button onClick={()=>notify(`Cadastro de ${tab === "Visão geral" ? "estrutura" : tab.toLowerCase()} preparado para a integração com o banco.`)}><Icon name="plus"/> Novo registro</Button></div>
    <MetricCards items={[["1","Empresa",organizationName],[String(summary.units),"Unidades","Estrutura cadastrada"],[String(summary.departments),"Departamentos","Estrutura ativa"],[String(summary.positions),"Cargos","Catálogo mestre"]]}/>
    <div className="section-tabs" role="tablist">{organizationTabs.map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>{setTab(item);setSelected(null)}} key={item}>{item}</button>)}</div>
    {tab === "Visão geral" ? <div className="org-overview">
      <Card className="org-tree-card"><div className="card-head"><div><p className="eyebrow">MAPA ORGANIZACIONAL</p><h2>{organizationName}</h2><p>Estrutura mestre compartilhada por todos os módulos.</p></div><Status tone="success">Ativa</Status></div><div className="org-tree"><button className="company-node" onClick={()=>setSelected(organizationName)}><span><Icon name="building"/></span><div><b>{organizationName}</b><small>Empresa</small></div></button><div className="tree-line"/><div className="unit-nodes">{organizationData.Unidades.map(u=><button key={u.name} onClick={()=>setSelected(u.name)}><span><Icon name={u.icon}/></span><div><b>{u.name}</b><small>{u.count}</small></div></button>)}</div><div className="department-summary"><span><b>{summary.departments}</b><small>Departamentos</small></span><i/><span><b>{summary.teams}</b><small>Equipes</small></span><i/><span><b>{summary.positions}</b><small>Cargos</small></span></div></div></Card>
      <Card className="integrity-card"><p className="eyebrow">INTEGRIDADE DOS DADOS</p><h2>Cadastro mestre saudável</h2><div className="integrity-score"><strong>94%</strong><span><i style={{width:"94%"}}/></span></div><ul><li><span>✓</span><div><b>Empresa identificada</b><small>Razão social e marca centralizadas</small></div></li><li><span>✓</span><div><b>Unidades vinculadas</b><small>Todos os departamentos possuem unidade</small></div></li><li><span>✓</span><div><b>Gestores definidos</b><small>7 de 8 departamentos com responsável</small></div></li><li className="warning"><span>!</span><div><b>1 vínculo pendente</b><small>Comercial sem equipe formalizada</small></div></li></ul></Card>
    </div> : <Card className="entity-card"><div className="table-tools"><div><h2>{tab}</h2><p>{cards.length} registros</p></div><label className="inline-search"><Icon name="search"/><input placeholder={`Buscar em ${tab.toLowerCase()}...`}/></label><button className="filter-button"><Icon name="filter"/> Filtros</button></div><div className="entity-grid">{cards.map(item=><button className={selected===item.name?"selected":""} key={item.name} onClick={()=>setSelected(item.name)}><span className="list-symbol"><Icon name={item.icon}/></span><span><b>{item.name}</b><small>{item.meta}</small><em>{item.detail}</em></span><Status>{item.count}</Status><Icon name="arrow"/></button>)}</div></Card>}
    {selected&&<div className="selection-bar"><span><Icon name="check"/></span><div><b>{selected}</b><small>Registro selecionado · pronto para edição na etapa de persistência</small></div><button onClick={()=>setSelected(null)} aria-label="Fechar seleção"><Icon name="close"/></button></div>}
  </>;
}

function PeopleAccessView({ notify, people, summary }: { notify:(message:string)=>void; people: Person[]; summary: FoundationSummary }) {
  const [tab,setTab]=useState<"Colaboradores"|"Usuários">("Usuários");
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("Todos");
  const [selected,setSelected]=useState<Person | null>(null);
  const filtered=useMemo(()=>people.filter(p=>(status==="Todos"||p.status===status)&&`${p.name} ${p.role} ${p.department}`.toLowerCase().includes(query.toLowerCase())),[people,query,status]);
  const featureCount=ACCESS_CATALOG.reduce((total,module)=>total+module.features.length,0);
  return <>
    <div className="page-head"><div><p className="eyebrow">ETAPA 2 · IDENTIDADE</p><h1>Pessoas e acessos</h1><p>Quem acessa a plataforma e o que cada pessoa pode fazer: módulos e, dentro deles, funcionalidades com nível.</p></div></div>
    <MetricCards items={[[String(summary.employees),"Colaboradores",`${summary.activeEmployees} ativos`],[String(summary.users),"Usuários","Contas cadastradas"],[String(featureCount),"Funcionalidades","Liberáveis por usuário"],[String(Math.max(summary.employees-summary.activeEmployees,0)),"Pendências","Exigem revisão"]]}/>
    <div className="section-tabs" role="tablist">{(["Usuários","Colaboradores"] as const).map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}</button>)}</div>
    {tab==="Usuários" ? <UserManagement notify={notify}/> : <Card className="people-card"><div className="table-tools"><label className="inline-search"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, cargo ou departamento..."/></label><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filtrar por status"><option>Todos</option><option>Ativo</option><option>Pendente</option><option>Bloqueado</option></select><button className="filter-button"><Icon name="filter"/> Mais filtros</button></div><div className="people-table"><div className="people-header"><span>Colaborador</span><span>Cargo e departamento</span><span>Perfil</span><span>Status</span><span/></div>{filtered.map(p=><button key={p.email} onClick={()=>setSelected(p)}><span className="person-cell"><i>{p.initials}</i><span><b>{p.name}</b><small>{p.unit}</small></span></span><span><b>{p.role}</b><small>{p.department}</small></span><Status>{p.profile}</Status><Status tone={p.status==="Ativo"?"success":p.status==="Pendente"?"info":"neutral"}>{p.status}</Status><Icon name="arrow"/></button>)}</div>{!filtered.length&&<div className="empty-state"><Icon name="search" size={28}/><b>Nenhum registro encontrado</b><small>Ajuste a busca ou os filtros.</small></div>}</Card>}
    {selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="person-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)} aria-label="Fechar"><Icon name="close"/></button><span className="drawer-avatar">{selected.initials}</span><p className="eyebrow">CADASTRO MESTRE</p><h2>{selected.name}</h2><p>{selected.email}</p><Status tone={selected.status==="Ativo"?"success":"info"}>{selected.status}</Status><dl><div><dt>Cargo</dt><dd>{selected.role}</dd></div><div><dt>Departamento</dt><dd>{selected.department}</dd></div><div><dt>Unidade</dt><dd>{selected.unit}</dd></div><div><dt>Acesso à plataforma</dt><dd>{selected.profile}</dd></div></dl><Button variant="secondary" onClick={()=>{setSelected(null);setTab("Usuários")}}><Icon name="key"/> Ver usuários e acessos</Button></aside></div>}
  </>;
}




function SecurityView({ access }: { notify:(message:string)=>void; access: ModuleAccessContext }) {
  // Leitura do modelo em uso: o acesso é de cada usuário (módulos →
  // funcionalidades → nível), gravado em user_feature_grants e aplicado pelo RLS.
  const [users,setUsers]=useState<AccessMatrixUser[]|null>(null);
  useEffect(()=>{
    if(!access.isOwner) return;
    const controller=new AbortController();
    fetch("/api/admin/users",{cache:"no-store",signal:controller.signal})
      .then(response=>response.ok?response.json():{users:[]})
      .then(payload=>setUsers(payload.users??[]))
      .catch(()=>{});
    return ()=>controller.abort();
  },[access.isOwner]);
  return <>
    <div className="page-head"><div><p className="eyebrow">GOVERNANÇA</p><h1>Permissões e segurança</h1><p>O que cada usuário acessa, por módulo, com o nível mais alto liberado. Tudo é conferido pelo banco em cada consulta.</p></div><Status tone="success">Negação por padrão</Status></div>
    <Card className="rls-card"><div className="card-head"><div><p className="eyebrow">ACESSO POR USUÁRIO</p><h2>Matriz de acesso</h2><p>Para alterar, abra o usuário em Pessoas e Acessos.</p></div><Status tone="info">{users?`${users.length} usuários`:"Carregando…"}</Status></div>
      <div className="access-matrix">{(users??[]).map(user=><div key={user.id} className="access-matrix-row"><span className="access-matrix-person"><b>{user.fullName}</b><small>{user.employee?.name ?? user.email}</small></span><span className="access-chips">{user.isOwner?<em>Proprietário · acesso total</em>:ACCESS_CATALOG.filter(module=>module.features.some(feature=>user.grants[feature.code])).map(module=>{
        const granted=module.features.filter(feature=>user.grants[feature.code]);
        const top=granted.reduce((best,feature)=>Math.max(best,levelRank(user.grants[feature.code])),0);
        return <em key={module.code}>{module.label}: {LEVEL_LABELS[ACCESS_LEVELS[top-1]]} · {granted.length}/{module.features.length}</em>;
      })}{!user.isOwner&&!Object.keys(user.grants).length&&<em>Sem acesso</em>}</span></div>)}</div>
    </Card>
    <Card className="security-contract"><div><span><Icon name="lock"/></span><div><p className="eyebrow">CONTRATO DE SEGURANÇA</p><h2>O frontend nunca decide sozinho</h2><p>Identidade, organização, funcionalidade e nível são verificados no PostgreSQL. Uma chamada direta à API continua limitada pelo RLS.</p></div></div></Card>
  </>;
}
type AccessMatrixUser = { id:string; fullName:string; email:string; isOwner:boolean; employee:{name:string}|null; grants:AccessGrants };
function CorporateSearchView({ initialQuery, setView, people, modules, organizationData, onOpenModule }: { initialQuery:string; setView:(view:View)=>void; people: Person[]; modules: ModuleManifest[]; organizationData: OrganizationData; onOpenModule:(moduleId:string)=>void }) {
  const [query,setQuery]=useState(initialQuery);
  // Busca sobre o cadastro real: pessoas, módulos e estrutura.
  const results=useMemo(()=>{
    const term=query.trim().toLowerCase();
    if(term.length<2) return [] as { key:string; title:string; meta:string; type:string; icon:string; open:()=>void }[];
    const matches:{ key:string; title:string; meta:string; type:string; icon:string; open:()=>void }[]=[];
    for(const person of people){
      if(`${person.name} ${person.role} ${person.department}`.toLowerCase().includes(term)) matches.push({ key:`p-${person.id ?? person.email}`, title:person.name, meta:`${person.role} · ${person.department}`, type:"Colaborador", icon:"users", open:()=>setView("Pessoas e Acessos") });
    }
    for(const manifest of modules){
      if(`${manifest.name} ${manifest.desc}`.toLowerCase().includes(term)) matches.push({ key:`m-${manifest.id}`, title:manifest.name, meta:manifest.status, type:"Módulo", icon:manifest.icon, open:()=>manifest.enabled?onOpenModule(manifest.id):setView("Módulos") });
    }
    for(const [group,items] of Object.entries(organizationData)){
      for(const item of items){
        if(`${item.name} ${item.meta}`.toLowerCase().includes(term)) matches.push({ key:`o-${group}-${item.name}`, title:item.name, meta:item.meta, type:group.replace(/s$/,""), icon:item.icon, open:()=>setView("Estrutura") });
      }
    }
    return matches.slice(0,40);
  },[query,people,modules,organizationData,setView,onOpenModule]);
  return <><div className="page-head"><div><p className="eyebrow">SERVIÇO CENTRAL</p><h1>Busca corporativa</h1><p>Encontre pessoas, módulos e estruturas autorizadas em um só lugar.</p></div><Status tone="success">Respeita permissões</Status></div>
    <Card className="search-hero"><Icon name="search" size={24}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome, cargo, departamento ou módulo..."/><span>⌘ K</span></Card>
    <div className="search-filter-row"><span>{query.trim().length<2?"Digite ao menos 2 caracteres":`${results.length} ${results.length===1?"resultado":"resultados"} autorizados`}</span></div>
    {results.length>0&&<Card className="search-results">{results.map(item=><button key={item.key} onClick={item.open}><span className="result-icon"><Icon name={item.icon}/></span><span><b>{item.title}</b><small>{item.meta}</small></span><Status>{item.type}</Status><Icon name="arrow"/></button>)}</Card>}
    {query.trim().length>=2&&!results.length&&<Card className="hr-empty-card"><div className="hr-empty"><Icon name="search" size={28}/><b>Nenhum resultado autorizado</b><small>Tente outro termo.</small></div></Card>}
  </>;
}

function DocumentsView() {
  // A central de documentos da Fundação lê a tabela `documents`; enquanto não
  // houver arquivo enviado, a tela mostra vazio em vez de um acervo fictício.
  return <><div className="page-head"><div><p className="eyebrow">SERVIÇO CENTRAL</p><h1>Central de documentos</h1><p>Arquivos versionados, classificados e vinculados aos registros autorizados.</p></div></div>
    <Card className="hr-empty-card"><div className="hr-empty"><Icon name="file" size={28}/><b>Nenhum documento arquivado</b><small>Documentos de colaboradores são enviados em Recursos Humanos › Documentos, com armazenamento privado e URL assinada.</small></div></Card>
  </>;
}

function NotificationsView({ events }: { notify:(message:string)=>void; events:OperationalEvent[] }) {
  // Só eventos reais desta sessão: a lista fixa de alertas saiu.
  return <><div className="page-head"><div><p className="eyebrow">SERVIÇO CENTRAL</p><h1>Central de notificações</h1><p>Alertas e pendências consolidados dos módulos.</p></div><Status tone={events.length?"attention":"success"}>{events.length?`${events.length} ${events.length===1?"evento":"eventos"}`:"Sem alertas"}</Status></div>
    {events.length
      ? <Card className="notification-feed">{events.map(event=><article key={event.id}><span className="notice-main"><span className={`notice-icon ${event.tone}`}><Icon name={event.icon}/></span><span><b>{event.title}</b><small>{event.message}</small><em>{event.module} · {event.time}</em></span></span></article>)}</Card>
      : <Card className="hr-empty-card"><div className="hr-empty"><Icon name="bell" size={28}/><b>Nenhuma notificação</b><small>Aprovações, vencimentos e alertas dos módulos aparecerão aqui.</small></div></Card>}
  </>;
}

function AuditView({ events }: { notify:(message:string)=>void; events:OperationalEvent[] }) {
  // A trilha completa fica em `audit_logs`, no banco; aqui aparecem os eventos
  // desta sessão. A lista de exemplos foi removida.
  return <><div className="page-head"><div><p className="eyebrow">GOVERNANÇA</p><h1>Auditoria central</h1><p>Rastreabilidade de acessos, dados sensíveis e operações críticas.</p></div></div>
    {events.length
      ? <Card className="audit-timeline">{events.map(event=><button key={event.id}><span className="audit-icon"><Icon name={event.icon}/></span><span><b>{event.title}</b><small>{event.actor} · {event.module}</small></span><small>{event.time}</small><Status tone={event.risk==="Sensível"?"info":"success"}>{event.risk}</Status><Icon name="arrow"/></button>)}</Card>
      : <Card className="hr-empty-card"><div className="hr-empty"><Icon name="shield" size={28}/><b>Nenhum evento nesta sessão</b><small>Toda operação sensível é gravada em audit_logs no banco, com autor, horário e escopo.</small></div></Card>}
  </>;
}
function PersistenceView({ dataSource, summary, organizationName }: { dataSource: "demo" | "supabase"; summary: FoundationSummary; organizationName: string }) {
  const connected = dataSource === "supabase";
  return <>
    <div className="page-head"><div><p className="eyebrow">PLATAFORMA</p><h1>Banco e autenticação</h1><p>Estado da conexão com o PostgreSQL da Pecsil e do cadastro carregado.</p></div><Status tone={connected?"success":"attention"}>{connected?"Supabase conectado":"Sem dados reais"}</Status></div>
    <MetricCards items={[[String(summary.employees),"Colaboradores","Cadastro funcional"],[String(summary.users),"Contas de acesso",`${summary.roles} ${summary.roles===1?"perfil":"perfis"}`],[String(summary.departments),"Departamentos",`${summary.teams} ${summary.teams===1?"equipe":"equipes"}`],[String(summary.positions),"Cargos","Catálogo"]]}/>
    <div className={`connection-banner ${connected?"connected":"pending"}`}><span><Icon name={connected?"check":"database"}/></span><div><b>{connected?`Dados reais de ${organizationName}`:"Nenhum dado real carregado"}</b><small>{connected?"As consultas passam pelo gateway /sb e são filtradas pelo RLS, por papel e escopo.":"Entre com uma conta da organização para carregar o cadastro."}</small></div></div>
    <Card className="security-contract"><div><span><Icon name="lock"/></span><div><p className="eyebrow">ACESSO AO BANCO</p><h2>Supabase fechado para fora</h2><p>O PostgreSQL não é publicado na internet: o navegador fala com o Business OS, que repassa as chamadas na rede interna. Toda tabela tem Row Level Security ativa.</p></div></div></Card>
  </>;
}

function AdminView({ view, organizationName, summary }: { view: View; organizationName: string; summary: FoundationSummary }) {
  return <>
    <div className="page-head"><div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>{view}</h1><p>Parâmetros centrais herdados por todos os módulos.</p></div></div>
    <Card className="data-card"><div className="card-head"><div><p className="eyebrow">EMPRESA</p><h2>{organizationName}</h2><p>Estrutura cadastrada no banco.</p></div></div>
      <div className="data-list">
        {[["Unidades",String(summary.units)],["Departamentos",String(summary.departments)],["Equipes",String(summary.teams)],["Cargos",String(summary.positions)],["Módulos ativos",String(moduleRegistry.filter(manifest=>manifest.enabled).length)]].map(([label,value])=>
          <div key={label} className="holiday-row"><span className="holiday-name"><b>{label}</b></span><Status>{value}</Status></div>)}
      </div>
    </Card>
    <Card className="hr-empty-card"><div className="hr-empty"><Icon name="settings" size={28}/><b>Nenhum parâmetro editável ainda</b><small>Marca, política de sessão, classificação de dados e ambientes serão configuráveis aqui.</small></div></Card>
  </>;
}
function AccessDenied({ target, access, onBack }: { target: string; access: ModuleAccessContext; onBack: () => void }) {
  return <div className="access-denied"><Card><span><Icon name="lock" size={30}/></span><p className="eyebrow">ACESSO CONTROLADO</p><h1>Esta área não faz parte do seu perfil</h1><p><b>{target}</b> não está disponível para {access.role.toLowerCase()} no escopo <b>{access.scopeLabel}</b>.</p><div><Status tone="attention">Negado por padrão</Status><small>A interface oculta o recurso e o PostgreSQL repetirá a validação quando a conexão real estiver ativa.</small></div><Button onClick={onBack}><Icon name="back"/> Voltar à visão autorizada</Button></Card></div>;
}

function HomeContent() {
  const { navState } = useModuleNav();
  const [view,setView]=useState<View>("Visão Geral"); const [mobile,setMobile]=useState(false); const [toast,setToast]=useState(""); const [globalQuery,setGlobalQuery]=useState("");
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [activeModuleId,setActiveModuleId]=useState<string | null>(null);
  // Área dentro do departamento (ex.: "compras" dentro de "comercial").
  const [moduleArea,setModuleArea]=useState<string | null>(null);
  const [accountMenu,setAccountMenu]=useState(false);
  const [deniedTarget,setDeniedTarget]=useState<string | null>(null);
  const [operationalEvents,setOperationalEvents]=useState<OperationalEvent[]>([]);
  const { snapshot, loading, error } = useFoundationData();
  // Identidade real do usuário autenticado (papel, permissões e escopo do banco).
  // Enquanto carrega, ou com o Supabase inacessível, cai no contexto demonstrativo.
  const { access, real: realAccess, loading: accessLoading, profile: sessionProfile, reload: reloadIdentity } = useSessionAccess();
  const { canInstall, promptInstall } = usePwa();
  const [accountPanel,setAccountPanel]=useState(false);
  // Visão executiva (Visão Geral, catálogo de módulos) é do proprietário; os
  // demais entram direto nos módulos liberados a eles.
  const isOwner = access.isOwner;
  const isExecutive = isOwner;
  const modules=useMemo(()=>getCatalogModules(access,moduleRegistry),[access]);
  const visibleModules=useMemo(()=>getVisibleModules(access,moduleRegistry),[access]);

  // Módulo setorial de destino do usuário não executivo
  const targetedModule = useMemo(() => {
    if (isExecutive) return null;
    return visibleModules[0]?.id ?? null;
  }, [isExecutive, visibleModules]);

  const [routedInitialModule, setRoutedInitialModule] = useState(false);

  // Roteamento inicial, uma única vez e só com as permissões reais carregadas
  // (o contexto demonstrativo tem acesso total e abriria módulos indevidos):
  // 1. Atalho do aplicativo instalado (manifest `shortcuts`): `/?module=compras`.
  // 2. Usuário não executivo vai direto para o módulo do seu escopo.
  useEffect(() => {
    if (routedInitialModule || accessLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("module") || params.has("view")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    const requested = params.get("module");
    const shortcut = requested ? getModuleById(requested) : undefined;
    if (shortcut) {
      // Atalho antigo de uma área (`/?module=compras`) abre o departamento dela.
      const department = shortcut.department ? getModuleById(shortcut.department) : undefined;
      const allowed = canAccessModule(access, shortcut);
      setActiveModuleId(allowed ? (department ? department.id : shortcut.id) : null);
      setModuleArea(allowed && department ? shortcut.id : null);
      setDeniedTarget(allowed ? null : shortcut.name);
    } else if (!isExecutive && targetedModule) {
      setActiveModuleId(targetedModule);
      setModuleArea(null);
      setDeniedTarget(null);
    }
    setRoutedInitialModule(true);
  }, [routedInitialModule, accessLoading, access, isExecutive, targetedModule]);

  const foundationNav=useMemo(()=>{
    // Áreas do proprietário ficam fora para os demais; o resto segue a
    // funcionalidade liberada (Estrutura, Auditoria) ou é comum a todos.
    return nav.slice(2).filter(item=>(!OWNER_ONLY_VIEWS.includes(item.label)||isOwner)&&(!viewPermissions[item.label]||hasPermission(access,viewPermissions[item.label]!)));
  },[access, isOwner]);

  const notify=(message:string)=>{setToast(message);setTimeout(()=>setToast(""),2600)};
  const recordOperationalEvent=(message:string,module="Recursos Humanos")=>{const lower=message.toLowerCase();const sensitive=lower.includes("aprov")||lower.includes("reprov")||lower.includes("conforme")||lower.includes("situação alterada");const monitored=lower.includes("export")||lower.includes("documento")||lower.includes("cadastro");const title=message.split(":")[0].replace(/\.$/,"");setOperationalEvents(current=>[{id:Date.now(),title,message,actor:access.name,module,time:"Agora",tone:(sensitive?"attention":"info") as OperationalEvent["tone"],risk:(sensitive?"Sensível":monitored?"Monitorado":"Normal") as OperationalEvent["risk"],icon:sensitive?"shield":lower.includes("export")?"download":"bell"},...current].slice(0,20));};
  const change=(v:View)=>{
    if (!isExecutive && (v === "Visão Geral" || v === "Módulos")) {
      if (targetedModule) {
        openModule(targetedModule);
        return;
      }
    }
    const permission=viewPermissions[v];
    if((OWNER_ONLY_VIEWS.includes(v)&&!isOwner)||(permission&&!hasPermission(access,permission))){setDeniedTarget(v);setActiveModuleId(null);setModuleArea(null);setMobile(false);return}
    setDeniedTarget(null);setActiveModuleId(null);setModuleArea(null);setView(v);setMobile(false);
  };
  // Abrir uma área (ex.: Compras) é abrir o departamento dela já naquela área.
  const openModule=(moduleId:string)=>{
    const manifest=getModuleById(moduleId);
    if(!manifest||!canAccessModule(access,manifest)){setDeniedTarget(manifest?.name??"Módulo");setActiveModuleId(null);setMobile(false);return}
    const department=manifest.department?getModuleById(manifest.department):undefined;
    setDeniedTarget(null);
    setActiveModuleId(department?department.id:manifest.id);
    setModuleArea(department?manifest.id:null);
    setMobile(false);
  };
  const handleModuleExit = () => {
    if (isExecutive) {
      change("Módulos");
    } else if (visibleModules.length > 1) {
      const next = visibleModules.find(m => m.id !== activeModuleId) ?? visibleModules[0];
      if (next) openModule(next.id);
    }
  };
  const openSearch=()=>change("Busca Corporativa");
  const signOut=async()=>{setAccountMenu(false);const form=document.createElement("form");form.method="POST";form.action="/auth/signout";document.body.appendChild(form);form.submit()};
  const activeModule=activeModuleId?getModuleById(activeModuleId):undefined;
  const [headerTitle,headerSubtitle]=deniedTarget
    ? ["Acesso controlado","Este recurso não faz parte do seu perfil"]
    : activeModule
      ? [activeModule.name,activeModule.desc]
      : headerCopy[view];
  return <div className={sidebarCollapsed?"app-shell collapsed":"app-shell"}>
    <aside className={mobile?"sidebar open":"sidebar"}>
      <div className="brand">
        <img className="brand-logo light" src="/pecsil-logo.png?v=2" alt="Pecsil — Molds for Glass"/><img className="brand-logo dark" src="/pecsil-logo-dark.png?v=2" alt="" aria-hidden="true"/>
        <b>Business OS</b>
        <button className="close-menu" onClick={()=>setMobile(false)} aria-label="Fechar menu"><Icon name="close"/></button>
      </div>
      <nav>
        {activeModule && !navState?.areas && !navState?.sidebarTree && navState && navState.items && navState.items.length > 0 && (
          <div className="sidebar-module-nav">
            <p>Seções · {activeModule.name}</p>
            <div className="sidebar-subitem-list">
              {navState.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-subitem ${navState.activeId === item.id ? "active" : ""}`}
                  onClick={() => {
                    navState.onSelect(item.id);
                    setMobile(false);
                  }}
                >
                  {item.icon && <Icon name={item.icon} size={18} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {isExecutive && <>
          <p>Plataforma</p>
          {nav.slice(0,2).map(n=><button key={n.label} title={n.label} aria-label={n.label} className={!activeModuleId&&!deniedTarget&&view===n.label?"active":""} onClick={()=>change(n.label)}><Icon name={n.icon}/><span>{n.label}</span></button>)}
        </>}
        {visibleModules.length>0&&<><p>Módulos</p>
          {visibleModules.map(module=>{
            // Departamento aberto: as áreas (e as seções da área aberta) viram
            // submenu recuado aqui mesmo, em qualquer largura de tela.
            const arvore = activeModuleId===module.id && navState?.areas?.length ? navState : null;
            // Módulo com menu próprio (Portaria): as seções viram submenu aqui.
            const secoes = activeModuleId===module.id && !navState?.areas?.length && navState?.sidebarTree && navState.items.length ? navState : null;
            return <Fragment key={module.id}>
              <button title={module.name} aria-label={module.name} className={activeModuleId===module.id?"active":""} onClick={()=>openModule(module.id)}><Icon name={module.icon}/><span>{module.name}</span></button>
              {secoes&&<div className="sidebar-tree">
                {secoes.items.map(item=>
                  <button
                    key={item.id}
                    type="button"
                    className={`sidebar-area sidebar-leaf ${secoes.activeId===item.id?"active":""}`}
                    aria-current={secoes.activeId===item.id?"page":undefined}
                    onClick={()=>{secoes.onSelect(item.id);setMobile(false)}}
                  >
                    {item.icon&&<Icon name={item.icon} size={18}/>}
                    <span>{item.label}</span>
                    {item.badge!==undefined&&<i className={`sidebar-count ${item.badgeTone==="attention"?"sidebar-count-alert":""}`}>{item.badge}</i>}
                  </button>
                )}
              </div>}
              {arvore&&<div className="sidebar-tree">
                {arvore.areas!.map(area=><Fragment key={area.id}>
                  <button
                    type="button"
                    className={`sidebar-area ${arvore.activeAreaId===area.id?"active":""}`}
                    aria-current={arvore.activeAreaId===area.id?"true":undefined}
                    onClick={()=>{arvore.onSelectArea?.(area.id);setMobile(false)}}
                  >
                    {area.icon&&<Icon name={area.icon} size={18}/>}
                    <span>{area.label}</span>
                  </button>
                  {arvore.activeAreaId===area.id&&arvore.items.map(item=>
                    <button
                      key={item.id}
                      type="button"
                      className={`sidebar-section ${arvore.activeId===item.id?"active":""}`}
                      onClick={()=>{arvore.onSelect(item.id);setMobile(false)}}
                    >
                      {item.icon&&<Icon name={item.icon} size={16}/>}
                      <span>{item.label}</span>
                    </button>
                  )}
                </Fragment>)}
              </div>}
            </Fragment>;
          })}
        </>}
        {foundationNav.length>0&&<><p>Fundação</p>
          {foundationNav.map(n=><button key={n.label} title={n.label} aria-label={n.label} className={!activeModuleId&&!deniedTarget&&view===n.label?"active":""} onClick={()=>change(n.label)}><Icon name={n.icon}/><span>{n.label}</span>{n.label==="Notificações"&&operationalEvents.length>0&&<i>{operationalEvents.length}</i>}</button>)}
        </>}
      </nav>
      <div className="foundation-status complete" title={`Escopo protegido · ${access.scopeLabel}`}>
        <span><i/></span>
        <div><b>Escopo protegido</b><small>{access.scopeLabel}</small></div>
      </div>
      <button className="sidebar-collapse" onClick={()=>setSidebarCollapsed(value=>!value)} aria-pressed={sidebarCollapsed} title={sidebarCollapsed?"Expandir menu lateral":"Recolher menu lateral"}>
        <Icon name={sidebarCollapsed?"panel-open":"panel-close"} size={18}/><span>Recolher</span>
      </button>
    </aside>
    {mobile&&<button className="scrim" onClick={()=>setMobile(false)} aria-label="Fechar menu"/>}
    <main className="main">
      <header>
        <button className="menu-button" onClick={()=>setMobile(true)} aria-label="Abrir menu"><Icon name="menu"/></button>
        <div className="header-title"><h1>{headerTitle}</h1><p>{headerSubtitle}</p></div>
        <Status tone={loading?"neutral":snapshot.source==="supabase"?"success":"attention"}>{loading?"Sincronizando":snapshot.source==="supabase"?"Supabase":"Demonstrativo"}</Status>
        <form className="search" onSubmit={e=>{e.preventDefault();openSearch()}}><Icon name="search" size={16}/><input value={globalQuery} onChange={e=>setGlobalQuery(e.target.value)} placeholder="Pessoa, documento, módulo..."/></form>
        {canInstall&&<button className="header-install" onClick={()=>promptInstall()} title="Instalar o Pecsil OS neste dispositivo" aria-label="Instalar aplicativo"><Icon name="download" size={16}/><span>Instalar app</span></button>}
        <ThemeToggle/>
        {hasPermission(access,"core.notifications.view")&&<button className="header-icon" aria-label="Notificações" onClick={()=>change("Notificações")}><Icon name="bell" size={18}/><i/></button>}
        <div className="persona-switcher">
          <button className="user-card" onClick={()=>setAccountMenu(value=>!value)} aria-expanded={accountMenu} aria-label={`Conta: ${access.name}, ${access.role}`} title={`${access.name} · ${access.role}`}>
            {sessionProfile.avatarUrl ? <img className="avatar top avatar-photo" src={sessionProfile.avatarUrl} alt=""/> : <span className="avatar top">{access.initials}</span>}
            <span><b>{access.name}</b><small>{access.role}</small></span>
          </button>
          {accountMenu&&<div className="persona-menu account-menu"><p>{realAccess?"Conta":"Modo demonstrativo"}</p><div className="account-identity">{sessionProfile.avatarUrl ? <img className="avatar-photo" src={sessionProfile.avatarUrl} alt=""/> : <span>{access.initials}</span>}<span><b>{access.name}</b><small>{access.role} · {access.scopeLabel}</small></span></div><button className="account-item" onClick={()=>{setAccountMenu(false);setAccountPanel(true)}}><Icon name="users" size={16}/> Minha conta</button>{canInstall && <button className="account-item" onClick={()=>{setAccountMenu(false);promptInstall();}}><Icon name="download" size={16}/> Instalar aplicativo</button>}<button className="account-signout" onClick={signOut}><Icon name="lock" size={16}/> Sair da plataforma</button></div>}
        </div>
      </header>
      <div className="content">{error&&<div className="connection-banner pending"><span><Icon name="alert"/></span><div><b>Modo demonstrativo preservado</b><small>{error}</small></div></div>}{deniedTarget?<AccessDenied target={deniedTarget} access={access} onBack={()=>{setDeniedTarget(null);if(!isExecutive&&targetedModule){setActiveModuleId(targetedModule)}else{setView("Visão Geral")}}}/>:activeModuleId==="rh"?<HrModule key={snapshot.loadedAt} people={snapshot.people} summary={snapshot.summary} notify={notify} onEvent={recordOperationalEvent} onExit={handleModuleExit} access={access}/>:activeModuleId?renderModuleComponent(activeModuleId,{notify,onEvent:recordOperationalEvent,onExit:handleModuleExit,access,initialArea:moduleArea??undefined}):view==="Visão Geral"?<Overview setView={change} summary={snapshot.summary} onOpenModule={openModule} access={access} catalogModules={modules} visibleModules={visibleModules}/>:view==="Módulos"?<ModuleCatalog onOpenModule={openModule} modules={modules} access={access}/>:view==="Pessoas e Acessos"?<PeopleAccessView notify={notify} people={snapshot.people} summary={snapshot.summary}/>:view==="Estrutura"?<OrganizationView notify={notify} organizationData={snapshot.organizationData} summary={snapshot.summary} organizationName={snapshot.organization.name}/>:view==="Permissões e Segurança"?<SecurityView notify={notify} access={access}/>:view==="Busca Corporativa"?<CorporateSearchView initialQuery={globalQuery} setView={change} people={snapshot.people} modules={modules} organizationData={snapshot.organizationData} onOpenModule={openModule}/>:view==="Cadastros"?<MasterDataView notify={notify}/>:view==="Eventos"?<EventTrailView/>:view==="Documentos"?<DocumentsView/>:view==="Notificações"?<NotificationsView notify={notify} events={operationalEvents}/>:view==="Auditoria"?<AuditView notify={notify} events={operationalEvents}/>:view==="Banco e Autenticação"?<PersistenceView dataSource={snapshot.source} summary={snapshot.summary} organizationName={snapshot.organization.name}/>:<AdminView view={view} organizationName={snapshot.organization.name} summary={snapshot.summary}/>}</div>
      <nav className="mobile-bottom-nav" aria-label="Navegação rápida móvel">
        <button
          type="button"
          className={`mobile-bottom-nav-item ${!activeModuleId && !deniedTarget && view === "Visão Geral" ? "active" : ""}`}
          onClick={() => change("Visão Geral")}
          aria-label="Início"
        >
          <Icon name="grid" size={20} />
          <span>Início</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-nav-item ${activeModuleId || (!deniedTarget && view === "Módulos") ? "active" : ""}`}
          onClick={() => {
            if (isExecutive) {
              change("Módulos");
            } else if (targetedModule) {
              openModule(targetedModule);
            } else if (visibleModules.length > 0) {
              openModule(visibleModules[0].id);
            } else {
              change("Módulos");
            }
          }}
          aria-label="Módulos"
        >
          <Icon name="modules" size={20} />
          <span>Módulos</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-nav-item ${!activeModuleId && !deniedTarget && view === "Busca Corporativa" ? "active" : ""}`}
          onClick={() => change("Busca Corporativa")}
          aria-label="Buscar"
        >
          <Icon name="search" size={20} />
          <span>Buscar</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-nav-item ${!activeModuleId && !deniedTarget && view === "Notificações" ? "active" : ""}`}
          onClick={() => change("Notificações")}
          aria-label="Alertas"
        >
          <Icon name="bell" size={20} />
          {operationalEvents.length > 0 && <i className="badge">{operationalEvents.length}</i>}
          <span>Alertas</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-nav-item ${mobile ? "active" : ""}`}
          onClick={() => setMobile(true)}
          aria-label="Menu"
        >
          <Icon name="menu" size={20} />
          <span>Menu</span>
        </button>
      </nav>
    </main>{accountPanel&&<AccountPanel access={access} profile={sessionProfile} onClose={()=>setAccountPanel(false)} onSaved={reloadIdentity} notify={notify}/>}
      {toast&&<div className="toast"><span>✓</span>{toast}</div>}
  </div>;
}

export default function Home() {
  return (
    <ModuleNavProvider>
      <HomeContent />
    </ModuleNavProvider>
  );
}
