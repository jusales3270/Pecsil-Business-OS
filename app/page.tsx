"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Kpi, KpiGrid, Status, ThemeToggle } from "../packages/design-system";
import type { FoundationSummary, OrganizationData, Person } from "../lib/data/foundation";
import { useFoundationData } from "../lib/data/use-foundation-data";
import { canAccessModule, getCatalogModules, getModuleById, getVisibleModules, hasPermission, moduleRegistry, renderModuleComponent, type ModuleAccessContext, type ModuleManifest } from "../modules";
import { useSessionAccess } from "../lib/data/use-session-access";
import { HrModule } from "./components/hr-module";
import { UserManagement } from "./components/user-management";
import { AccountPanel } from "./components/account-panel";

type View = "Visão Geral" | "Módulos" | "Pessoas e Acessos" | "Estrutura" | "Permissões e Segurança" | "Busca Corporativa" | "Documentos" | "Notificações" | "Auditoria" | "Banco e Autenticação" | "Configurações";

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
  "Pessoas e Acessos": ["Pessoas e acessos", "Cadastro mestre de colaboradores, contas e perfis"],
  "Estrutura": ["Estrutura empresarial", "Empresa, unidades, departamentos, equipes e cargos"],
  "Permissões e Segurança": ["Permissões e segurança", "Papéis, escopos, ações e isolamento de dados"],
  "Busca Corporativa": ["Busca corporativa", "Pessoas, estruturas, documentos e eventos autorizados"],
  "Documentos": ["Documentos", "Arquivos versionados, classificados e rastreáveis"],
  "Notificações": ["Notificações", "Alertas e pendências consolidados dos módulos"],
  "Auditoria": ["Auditoria", "Rastreabilidade imutável de acessos e operações críticas"],
  "Banco e Autenticação": ["Banco e autenticação", "Fundação PostgreSQL, RLS e provisionamento"],
  "Configurações": ["Configurações", "Parâmetros centrais herdados por todos os módulos"],
};

const viewPermissions: Partial<Record<View, string>> = {
  "Pessoas e Acessos": "core.people.view",
  "Estrutura": "core.organization.view",
  "Permissões e Segurança": "core.access.view",
  "Busca Corporativa": "core.search.view",
  "Documentos": "core.documents.view",
  "Notificações": "core.notifications.view",
  "Auditoria": "core.audit.view",
  "Banco e Autenticação": "platform.database.view",
  "Configurações": "platform.settings.view",
};

const dashboardCopy: Record<string, [string,string,string]> = {
  "Proprietário": ["VISÃO EXECUTIVA", "Visão geral da empresa", "Toda a operação, os módulos e os indicadores estratégicos autorizados."],
  "Diretora": ["VISÃO DA DIRETORIA", "Diretoria Industrial", "Indicadores e decisões dentro das unidades e áreas sob sua responsabilidade."],
  "Gestor": ["VISÃO DA GESTÃO", "Produção e equipes", "Pendências, pessoas e rotinas limitadas ao seu departamento."],
  "RH": ["GESTÃO DE PESSOAS", "Central do RH", "Pessoas, documentos e rotinas de RH em âmbito corporativo."],
  "Colaborador": ["MEU ESPAÇO", "Olá, Lucas", "Seus documentos, solicitações e informações pessoais em um único lugar."],
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
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function Overview({ setView, summary, onOpenModule, access, catalogModules, visibleModules }: { setView: (v: View) => void; summary: FoundationSummary; onOpenModule: (moduleId: string) => void; access: ModuleAccessContext; catalogModules: ModuleManifest[]; visibleModules: ModuleManifest[] }) {
  const [eyebrow,title,description]=dashboardCopy[access.role] ?? dashboardCopy.Proprietário;
  const metricItems = access.role === "Colaborador"
    ? [["file","12","Meus documentos","11 válidos · 1 pendente","blue"],["calendar","18 dias","Saldo de férias","Próximo período aquisitivo","green"],["clock","8h","Banco de horas","Saldo pessoal","purple"],["bell","3","Meus avisos","1 exige atenção","orange"]]
    : access.role === "Gestor"
      ? [["modules",String(visibleModules.length),"Módulo autorizado","Conforme credenciais","blue"],["users","32","Pessoas no escopo","Produção · Equipes A e B","green"],["check","4","Aprovações","Aguardando decisão","purple"],["bell","3","Alertas da área","Prioridades atuais","orange"]]
      : access.role === "Diretora"
        ? [["modules",String(visibleModules.length),"Módulo autorizado","Diretoria Industrial","blue"],["users","142","Pessoas no escopo","Unidades autorizadas","green"],["shield","3","Áreas acompanhadas","Indicadores consolidados","purple"],["bell","5","Pontos de atenção","Decisões e riscos","orange"]]
        : [["modules",String(visibleModules.length),"Módulo ativo","Visível conforme credenciais","blue"],["users",String(summary.employees),"Colaboradores mapeados","Cadastro mestre inicial","green"],["shield",String(summary.roles),"Perfis de acesso","Modelo definido","purple"],["bell","4","Serviços centrais","Base da Fundação","orange"]];
  return <>
    <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><Button onClick={() => setView("Módulos")}><Icon name="modules"/> Explorar módulos</Button></div>
    <KpiGrid>
      {metricItems.map(([,value,label,meta,color]) => <Kpi key={label} label={label} caption={meta} value={value} tone={(color==="orange"?"amber":color) as "blue"|"green"|"amber"|"purple"}/>)}
    </KpiGrid>
    <div className="overview-grid">
      <Card className="executive-card"><div className="card-head"><div><p className="eyebrow">ECOSSISTEMA</p><h2>Mapa da plataforma</h2></div><Status tone="info">Fundação v1</Status></div><div className="system-map"><div className="core"><span><Icon name="grid"/></span><b>Núcleo Pecsil</b><small>Identidade · Acessos · Dados · Auditoria</small></div><div className="connector"/><div className="module-row">{catalogModules.slice(0,5).map(m=><button key={m.name} className={`map-module ${m.color}`} onClick={()=>m.enabled?onOpenModule(m.id):setView("Módulos")}><Icon name={m.icon}/><span>{m.short}</span></button>)}</div><div className="intelligence"><span>J</span><div><b>Jarvis Business</b><small>Inteligência transversal — preparado para fase futura</small></div><Status>Planejado</Status></div></div></Card>
      <Card className="foundation-card"><div className="card-head"><div><p className="eyebrow">ETAPA 4</p><h2>Fundação do sistema</h2></div><span className="progress-value">100%</span></div><div className="big-progress stage-four"><i/></div><ul className="check-list"><li className="done"><span>✓</span><div><b>Shell e Design System</b><small>Experiência Pecsil consolidada</small></div></li><li className="done"><span>✓</span><div><b>Identidade e organização</b><small>Cadastros mestres estruturados</small></div></li><li className="done"><span>✓</span><div><b>Permissões e RLS</b><small>Matriz e políticas preparadas</small></div></li><li className="done"><span>✓</span><div><b>Serviços centrais</b><small>Busca, documentos, alertas e auditoria</small></div></li><li><span>5</span><div><b>Persistência real</b><small>Próximo marco</small></div></li></ul></Card>
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
    </div> : <Card className="entity-card"><div className="table-tools"><div><h2>{tab}</h2><p>{cards.length} registros demonstrativos</p></div><label className="inline-search"><Icon name="search"/><input placeholder={`Buscar em ${tab.toLowerCase()}...`}/></label><button className="filter-button"><Icon name="filter"/> Filtros</button></div><div className="entity-grid">{cards.map(item=><button className={selected===item.name?"selected":""} key={item.name} onClick={()=>setSelected(item.name)}><span className="list-symbol"><Icon name={item.icon}/></span><span><b>{item.name}</b><small>{item.meta}</small><em>{item.detail}</em></span><Status>{item.count}</Status><Icon name="arrow"/></button>)}</div></Card>}
    {selected&&<div className="selection-bar"><span><Icon name="check"/></span><div><b>{selected}</b><small>Registro selecionado · pronto para edição na etapa de persistência</small></div><button onClick={()=>setSelected(null)} aria-label="Fechar seleção"><Icon name="close"/></button></div>}
  </>;
}

function PeopleAccessView({ notify, people, summary }: { notify:(message:string)=>void; people: Person[]; summary: FoundationSummary }) {
  const [tab,setTab]=useState<"Colaboradores"|"Usuários"|"Perfis de acesso">("Colaboradores");
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("Todos");
  const [selected,setSelected]=useState<Person | null>(null);
  const filtered=useMemo(()=>people.filter(p=>(status==="Todos"||p.status===status)&&`${p.name} ${p.role} ${p.department}`.toLowerCase().includes(query.toLowerCase())),[people,query,status]);
  const profiles=[
    ["Proprietário","Empresa completa","Visão estratégica transversal","1 usuário"],
    ["Diretor","Áreas autorizadas","Indicadores e decisões","3 usuários"],
    ["Gestor","Equipe ou departamento","Gestão e aprovações","18 usuários"],
    ["Operador","Área designada","Execução operacional","54 usuários"],
    ["Colaborador","Próprio registro","Autosserviço","172 usuários"],
    ["Administrador","Plataforma","Configuração técnica","2 usuários"],
  ];
  return <>
    <div className="page-head"><div><p className="eyebrow">ETAPA 2 · IDENTIDADE</p><h1>Pessoas e acessos</h1><p>Cadastro mestre de colaboradores, contas e perfis que sustentará todo o ecossistema.</p></div><Button onClick={()=>notify("Novo colaborador preparado para a futura gravação no banco.")}><Icon name="plus"/> Novo colaborador</Button></div>
    <MetricCards items={[[String(summary.employees),"Colaboradores",`${summary.activeEmployees} ativos`],[String(summary.users),"Usuários","Contas cadastradas"],[String(summary.roles),"Perfis-base","Modelo corporativo"],[String(Math.max(summary.employees-summary.activeEmployees,0)),"Pendências","Exigem revisão"]]}/>
    <div className="section-tabs" role="tablist">{(["Colaboradores","Usuários","Perfis de acesso"] as const).map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}</button>)}</div>
    {tab==="Usuários" ? <UserManagement notify={notify}/> : tab!=="Perfis de acesso" ? <Card className="people-card"><div className="table-tools"><label className="inline-search"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, cargo ou departamento..."/></label><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filtrar por status"><option>Todos</option><option>Ativo</option><option>Pendente</option><option>Bloqueado</option></select><button className="filter-button"><Icon name="filter"/> Mais filtros</button></div><div className="people-table"><div className="people-header"><span>Colaborador</span><span>Cargo e departamento</span><span>Perfil</span><span>Status</span><span/></div>{filtered.map(p=><button key={p.email} onClick={()=>setSelected(p)}><span className="person-cell"><i>{p.initials}</i><span><b>{p.name}</b><small>{p.unit}</small></span></span><span><b>{p.role}</b><small>{p.department}</small></span><Status>{p.profile}</Status><Status tone={p.status==="Ativo"?"success":p.status==="Pendente"?"info":"neutral"}>{p.status}</Status><Icon name="arrow"/></button>)}</div>{!filtered.length&&<div className="empty-state"><Icon name="search" size={28}/><b>Nenhum registro encontrado</b><small>Ajuste a busca ou os filtros.</small></div>}</Card> : <div className="profile-grid">{profiles.map(([name,scope,desc,count])=><Card key={name}><span className="profile-icon"><Icon name="key"/></span><Status>{count}</Status><h2>{name}</h2><p>{desc}</p><dl><dt>Escopo padrão</dt><dd>{scope}</dd></dl><button onClick={()=>notify(`Matriz do perfil ${name} aberta para a próxima etapa.`)}>Ver matriz de permissões <Icon name="arrow"/></button></Card>)}</div>}
    {selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="person-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)} aria-label="Fechar"><Icon name="close"/></button><span className="drawer-avatar">{selected.initials}</span><p className="eyebrow">CADASTRO MESTRE</p><h2>{selected.name}</h2><p>{selected.email}</p><Status tone={selected.status==="Ativo"?"success":"info"}>{selected.status}</Status><dl><div><dt>Cargo</dt><dd>{selected.role}</dd></div><div><dt>Departamento</dt><dd>{selected.department}</dd></div><div><dt>Unidade</dt><dd>{selected.unit}</dd></div><div><dt>Perfil-base</dt><dd>{selected.profile}</dd></div></dl><Button onClick={()=>notify("Edição do cadastro preparada para a integração com o banco.")}>Editar cadastro</Button><Button variant="secondary" onClick={()=>setTab("Perfis de acesso")}><Icon name="key"/> Revisar acessos</Button></aside></div>}
  </>;
}

const securityRoles = [
  { name:"Proprietário", users:1, scope:"Empresa completa", tone:"owner", note:"Visão transversal e decisões estratégicas" },
  { name:"Diretor", users:3, scope:"Diretorias autorizadas", tone:"director", note:"Indicadores, aprovações e gestão" },
  { name:"Gestor", users:18, scope:"Departamento e equipes", tone:"manager", note:"Operação e aprovações da área" },
  { name:"Operador", users:54, scope:"Módulo e unidade", tone:"operator", note:"Execução de rotinas autorizadas" },
  { name:"Colaborador", users:172, scope:"Próprio registro", tone:"employee", note:"Autosserviço e consultas pessoais" },
  { name:"Administrador", users:2, scope:"Configuração técnica", tone:"admin", note:"Mantém a plataforma sem dados executivos" },
];

const permissionModules = [
  { name:"Núcleo", icon:"grid", default:["ver","criar","editar","aprovar","exportar"] },
  { name:"Recursos Humanos", icon:"users", default:["ver","criar","editar","aprovar"] },
  { name:"Compras", icon:"cart", default:["ver","aprovar","exportar"] },
  { name:"Produção", icon:"factory", default:["ver","criar","editar","exportar"] },
  { name:"Qualidade", icon:"check", default:["ver","criar","editar","aprovar","exportar"] },
  { name:"Financeiro", icon:"chart", default:["ver","aprovar","exportar"] },
];

const permissionLabels: Record<string,{label:string;icon:string}> = {
  ver:{label:"Visualizar",icon:"eye"}, criar:{label:"Criar",icon:"plus"}, editar:{label:"Editar",icon:"edit"}, aprovar:{label:"Aprovar",icon:"check"}, exportar:{label:"Exportar",icon:"download"},
};

function SecurityView({ notify }: { notify:(message:string)=>void }) {
  const [tab,setTab]=useState<"Matriz de acesso"|"Escopos"|"Políticas RLS"|"Sessões">("Matriz de acesso");
  const [role,setRole]=useState("Gestor");
  const [permissions,setPermissions]=useState<Record<string,string[]>>(()=>Object.fromEntries(permissionModules.map(m=>[m.name,[...m.default]])));
  const currentRole=securityRoles.find(r=>r.name===role)!;
  const toggle=(module:string,permission:string)=>setPermissions(old=>({...old,[module]:old[module].includes(permission)?old[module].filter(p=>p!==permission):[...old[module],permission]}));
  const tabs=["Matriz de acesso","Escopos","Políticas RLS","Sessões"] as const;
  return <>
    <div className="page-head"><div><p className="eyebrow">ETAPA 3 · GOVERNANÇA</p><h1>Permissões e segurança</h1><p>Controle central de papéis, escopos, ações e isolamento de dados.</p></div><Button onClick={()=>notify("Nova versão da política preparada para futura persistência e auditoria.")}><Icon name="plus"/> Nova política</Button></div>
    <MetricCards items={[["6","Papéis-base","Modelo corporativo"],["250","Contas protegidas","236 ativas"],["18","Políticas RLS","Preparadas"],["0","Riscos críticos","Ambiente íntegro"]]}/>
    <div className="security-summary"><div><span className="security-pulse"><Icon name="shield"/></span><div><b>Postura de segurança saudável</b><small>Princípio do menor privilégio · negação por padrão · auditoria obrigatória</small></div></div><Status tone="success">Conforme</Status></div>
    <div className="section-tabs" role="tablist">{tabs.map(item=><button role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}</button>)}</div>
    {tab==="Matriz de acesso"&&<div className="security-layout">
      <Card className="role-list"><div className="security-card-head"><div><p className="eyebrow">PAPÉIS</p><h2>Perfis corporativos</h2></div><Status>{securityRoles.reduce((sum,r)=>sum+r.users,0)} vínculos</Status></div>{securityRoles.map(r=><button key={r.name} className={role===r.name?"active":""} onClick={()=>setRole(r.name)}><span className={`role-mark ${r.tone}`}>{r.name.slice(0,2).toUpperCase()}</span><span><b>{r.name}</b><small>{r.scope}</small></span><em>{r.users}</em><Icon name="arrow"/></button>)}</Card>
      <Card className="permission-matrix"><div className="matrix-head"><div><p className="eyebrow">MATRIZ DE ACESSO</p><h2>{role}</h2><p>{currentRole.note}</p></div><div><Status tone="info">{currentRole.scope}</Status><Button variant="secondary" onClick={()=>notify(`Alterações do perfil ${role} salvas como rascunho demonstrativo.`)}>Salvar matriz</Button></div></div><div className="matrix-table"><div className="matrix-row matrix-header"><span>Módulo</span>{Object.entries(permissionLabels).map(([key,p])=><span key={key}><Icon name={p.icon}/>{p.label}</span>)}</div>{permissionModules.map(m=><div className="matrix-row" key={m.name}><span><i><Icon name={m.icon}/></i><b>{m.name}</b></span>{Object.keys(permissionLabels).map(p=>{const on=permissions[m.name].includes(p);return <button key={p} className={on?"permission-on":"permission-off"} onClick={()=>toggle(m.name,p)} aria-label={`${permissionLabels[p].label} em ${m.name}`}><span>{on?"✓":"—"}</span></button>})}</div>)}</div><div className="matrix-note"><Icon name="alert"/><span><b>Regra de proteção</b><small>Permissões sensíveis exigem escopo válido e são registradas na auditoria.</small></span></div></Card>
    </div>}
    {tab==="Escopos"&&<div className="scope-grid">{[
      ["Empresa","Acesso transversal","1 perfil","Proprietário","building"],
      ["Unidade","Matriz ou Industrial","4 perfis","Diretor · Gestor","factory"],
      ["Departamento","Área específica","18 perfis","Gestor","org"],
      ["Equipe","Turno ou célula","12 perfis","Gestor · Operador","team"],
      ["Próprio registro","Dados pessoais","172 perfis","Colaborador","users"],
      ["Módulo","Domínio autorizado","54 perfis","Operador","modules"],
    ].map(([name,desc,count,roles,icon])=><Card key={name}><span className="scope-icon"><Icon name={icon}/></span><Status>{count}</Status><h2>{name}</h2><p>{desc}</p><dl><dt>Aplicado a</dt><dd>{roles}</dd></dl><button onClick={()=>notify(`Escopo ${name} selecionado para revisão.`)}>Revisar vínculos <Icon name="arrow"/></button></Card>)}</div>}
    {tab==="Políticas RLS"&&<Card className="rls-card"><div className="card-head"><div><p className="eyebrow">ROW LEVEL SECURITY</p><h2>Políticas preparadas</h2><p>O banco filtrará cada registro pelo usuário, papel e escopo organizacional.</p></div><Status tone="success">18 de 18 definidas</Status></div><div className="rls-flow"><span><Icon name="users"/><b>Usuário</b><small>Identidade</small></span><i>→</i><span><Icon name="key"/><b>Papel</b><small>Permissão</small></span><i>→</i><span><Icon name="org"/><b>Escopo</b><small>Organização</small></span><i>→</i><span><Icon name="shield"/><b>RLS</b><small>Registro permitido</small></span></div><div className="policy-list">{[
      ["profiles_select_own","Perfis","Leitura do próprio perfil","Ativa"],
      ["employees_by_org_scope","Colaboradores","Leitura limitada à estrutura autorizada","Ativa"],
      ["documents_by_classification","Documentos","Filtro por classificação e vínculo","Ativa"],
      ["audit_insert_only","Auditoria","Somente inserção pelo sistema","Ativa"],
      ["owner_business_overview","Indicadores","Visão consolidada exclusiva do proprietário","Preparada"],
    ].map(([code,domain,desc,state])=><button key={code}><span className="policy-status"><i/></span><span><b>{code}</b><small>{domain} · {desc}</small></span><Status tone={state==="Ativa"?"success":"info"}>{state}</Status><Icon name="arrow"/></button>)}</div></Card>}
    {tab==="Sessões"&&<div className="session-layout"><Card className="session-policy"><p className="eyebrow">CONTROLES DE SESSÃO</p><h2>Política corporativa</h2>{[["Duração padrão","8 horas"],["Inatividade","30 minutos"],["MFA","Obrigatório para perfis sensíveis"],["Bloqueio","5 tentativas inválidas"],["Revogação","Imediata ao desligamento"]].map(([k,v])=><div key={k}><span><b>{k}</b><small>{v}</small></span><Status tone="success">Ativo</Status></div>)}</Card><Card className="access-health"><p className="eyebrow">MONITORAMENTO</p><h2>Saúde dos acessos</h2><div className="health-score"><strong>98</strong><span>/100</span></div><ul><li><span>✓</span> Nenhuma sessão suspeita</li><li><span>✓</span> Perfis sensíveis com MFA</li><li><span>!</span> 2 convites aguardando ativação</li></ul><Button variant="secondary" onClick={()=>notify("Relatório de sessões preparado para exportação.")}><Icon name="download"/> Exportar relatório</Button></Card></div>}
  </>;
}

const corporateSearchItems = [
  { title:"Mariana Costa", meta:"Gerente de RH · Matriz Boituva", type:"Colaborador", icon:"users", target:"Pessoas e Acessos" as View },
  { title:"Unidade Industrial", meta:"166 colaboradores · Boituva", type:"Unidade", icon:"factory", target:"Estrutura" as View },
  { title:"Política de Segurança da Informação", meta:"Versão 3.2 · Corporativo", type:"Documento", icon:"file", target:"Documentos" as View },
  { title:"Recursos Humanos", meta:"Módulo · Protótipo pronto", type:"Módulo", icon:"modules", target:"Módulos" as View },
  { title:"Gestor", meta:"Perfil-base · 18 usuários", type:"Perfil", icon:"key", target:"Permissões e Segurança" as View },
  { title:"Treinamento NR-12", meta:"Vencimento em 18 dias · Produção", type:"Pendência", icon:"alert", target:"Notificações" as View },
  { title:"Exportação de colaboradores", meta:"Hoje, 09:42 · Júnior Sales", type:"Auditoria", icon:"shield", target:"Auditoria" as View },
];

function CorporateSearchView({ initialQuery, setView }: { initialQuery:string; setView:(view:View)=>void }) {
  const [query,setQuery]=useState(initialQuery);
  const [type,setType]=useState("Todos");
  const filtered=corporateSearchItems.filter(item=>(type==="Todos"||item.type===type)&&`${item.title} ${item.meta} ${item.type}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="page-head"><div><p className="eyebrow">SERVIÇO CENTRAL</p><h1>Busca corporativa</h1><p>Encontre pessoas, estruturas, documentos, módulos e eventos em um só lugar.</p></div><Status tone="success">Respeita permissões</Status></div><Card className="search-hero"><Icon name="search" size={24}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="O que você procura na Pecsil?"/><span>⌘ K</span></Card><div className="search-filter-row"><span>{filtered.length} resultados autorizados</span><div>{["Todos","Colaborador","Documento","Módulo","Pendência","Auditoria"].map(item=><button key={item} className={type===item?"active":""} onClick={()=>setType(item)}>{item}</button>)}</div></div><Card className="search-results">{filtered.map(item=><button key={item.title} onClick={()=>setView(item.target)}><span className="result-icon"><Icon name={item.icon}/></span><span><b>{item.title}</b><small>{item.meta}</small></span><Status>{item.type}</Status><Icon name="arrow"/></button>)}{!filtered.length&&<div className="empty-state"><Icon name="search" size={30}/><b>Nenhum resultado autorizado</b><small>Tente outro termo ou ajuste o filtro.</small></div>}</Card></>;
}

const documentItems = [
  { name:"Política de Segurança da Informação", category:"Corporativo", owner:"TI e Governança", version:"v3.2", updated:"12 jul 2026", status:"Vigente", tone:"success" as const },
  { name:"Procedimento de Inspeção Final", category:"Qualidade", owner:"Camila Ferreira", version:"v2.1", updated:"10 jul 2026", status:"Vigente", tone:"success" as const },
  { name:"Programa de Gerenciamento de Riscos", category:"Saúde e Segurança", owner:"Mariana Costa", version:"v4.0", updated:"08 jul 2026", status:"Revisão próxima", tone:"attention" as const },
  { name:"Contrato Fornecedor Atlas", category:"Contrato", owner:"Compras", version:"v1.0", updated:"02 jul 2026", status:"Restrito", tone:"info" as const },
  { name:"Manual de Integração", category:"Colaborador", owner:"Recursos Humanos", version:"v5.3", updated:"28 jun 2026", status:"Vigente", tone:"success" as const },
  { name:"Instrução de Trabalho — Usinagem", category:"Operacional", owner:"Produção", version:"v2.7", updated:"18 jun 2026", status:"Revisão pendente", tone:"danger" as const },
];

function DocumentsView({ notify }: { notify:(message:string)=>void }) {
  const [tab,setTab]=useState<"Todos"|"Recentes"|"Vencimentos"|"Categorias">("Todos");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<typeof documentItems[number]|null>(null);
  const docs=documentItems.filter(d=>`${d.name} ${d.category} ${d.owner}`.toLowerCase().includes(query.toLowerCase())&&(tab!=="Vencimentos"||d.status.includes("Revis")));
  return <><div className="page-head"><div><p className="eyebrow">ETAPA 4 · DOCUMENTOS</p><h1>Central de documentos</h1><p>Arquivos versionados, classificados e vinculados aos registros autorizados.</p></div><Button onClick={()=>notify("Upload preparado para a futura conexão com o armazenamento privado.")}><Icon name="plus"/> Novo documento</Button></div><MetricCards items={[["284","Documentos","278 vigentes"],["8","Categorias","Catálogo central"],["6","Revisões","Próximos 30 dias"],["100%","Rastreáveis","Versão e responsável"]]}/><div className="section-tabs">{(["Todos","Recentes","Vencimentos","Categorias"] as const).map(item=><button className={tab===item?"active":""} onClick={()=>setTab(item)} key={item}>{item}</button>)}</div>{tab==="Categorias"?<div className="document-category-grid">{[["Corporativo","42","building"],["Colaborador","96","users"],["Contrato","38","briefcase"],["Saúde e Segurança","51","shield"],["Qualidade","33","check"],["Operacional","24","factory"]].map(([name,count,icon])=><Card key={name}><span><Icon name={icon}/></span><div><b>{name}</b><small>{count} documentos</small></div><Icon name="arrow"/></Card>)}</div>:<Card className="document-card"><div className="table-tools"><label className="inline-search"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar documento, categoria ou responsável..."/></label><button className="filter-button"><Icon name="filter"/> Classificação</button></div><div className="document-table"><div className="document-header"><span>Documento</span><span>Categoria</span><span>Versão</span><span>Atualização</span><span>Status</span><span/></div>{docs.map(doc=><button key={doc.name} onClick={()=>setSelected(doc)}><span className="document-name"><i><Icon name="file"/></i><span><b>{doc.name}</b><small>{doc.owner}</small></span></span><Status>{doc.category}</Status><b>{doc.version}</b><small>{doc.updated}</small><Status tone={doc.tone}>{doc.status}</Status><Icon name="arrow"/></button>)}</div></Card>}{selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="person-drawer document-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)}><Icon name="close"/></button><span className="document-drawer-icon"><Icon name="file" size={28}/></span><p className="eyebrow">DOCUMENTO CONTROLADO</p><h2>{selected.name}</h2><p>{selected.category} · {selected.owner}</p><Status tone={selected.tone}>{selected.status}</Status><dl><div><dt>Versão vigente</dt><dd>{selected.version}</dd></div><div><dt>Última atualização</dt><dd>{selected.updated}</dd></div><div><dt>Classificação</dt><dd>Interno · Acesso por escopo</dd></div><div><dt>Auditoria</dt><dd>Download e visualização registrados</dd></div></dl><Button onClick={()=>notify("Visualização segura preparada para o armazenamento real.")}><Icon name="eye"/> Visualizar</Button><Button variant="secondary"><Icon name="clock"/> Histórico de versões</Button></aside></div>}</>;
}

type Notice={id:number;title:string;meta:string;module:string;time:string;tone:"danger"|"attention"|"info"|"success";read:boolean;action?:string};
const initialNotices:Notice[]=[
  {id:1,title:"Treinamento NR-12 próximo do vencimento",meta:"12 colaboradores da Produção exigem renovação.",module:"Saúde e Segurança",time:"Há 18 min",tone:"danger",read:false,action:"Revisar pendência"},
  {id:2,title:"Aprovação de férias aguardando decisão",meta:"Solicitação de Lucas Martins para 03–17 ago.",module:"Recursos Humanos",time:"Há 42 min",tone:"attention",read:false,action:"Analisar solicitação"},
  {id:3,title:"Política corporativa atualizada",meta:"Segurança da Informação avançou para a versão 3.2.",module:"Documentos",time:"Hoje, 08:35",tone:"info",read:false},
  {id:4,title:"Integridade cadastral recuperada",meta:"Todos os departamentos agora possuem gestor definido.",module:"Estrutura",time:"Ontem, 16:10",tone:"success",read:true},
  {id:5,title:"Novo usuário aguardando ativação",meta:"Convite enviado para Fernanda Rocha — Qualidade.",module:"Acessos",time:"Ontem, 14:22",tone:"info",read:true,action:"Revisar acesso"},
];

function NotificationsView({ notify, events }: { notify:(message:string)=>void; events:OperationalEvent[] }) {
  const eventNotices:Notice[]=events.map(event=>({id:100000+event.id,title:event.title,meta:event.message,module:event.module,time:event.time,tone:event.tone,read:false,action:event.risk==="Sensível"?"Revisar evento":undefined}));
  const [items,setItems]=useState<Notice[]>(()=>[...eventNotices,...initialNotices]);const [filter,setFilter]=useState("Todas");
  const visible=items.filter(n=>filter==="Todas"||(filter==="Não lidas"&&!n.read)||(filter==="Críticas"&&n.tone==="danger")||(filter==="Aprovações"&&!!n.action));
  const markAll=()=>{setItems(old=>old.map(n=>({...n,read:true})));notify("Todas as notificações foram marcadas como lidas.")};
  return <><div className="page-head"><div><p className="eyebrow">ETAPA 4 · NOTIFICAÇÕES</p><h1>Central de notificações</h1><p>Alertas, aprovações e pendências consolidados de todos os módulos.</p></div><Button variant="secondary" onClick={markAll}><Icon name="check"/> Marcar todas como lidas</Button></div><MetricCards items={[[String(items.filter(n=>!n.read).length),"Não lidas","Exigem atenção"],["1","Crítica","Prazo regulatório"],["2","Aprovações","Ações atribuídas"],["5","Fontes","Módulos conectados"]]}/><div className="notification-layout"><Card className="notification-feed"><div className="notification-filter">{["Todas","Não lidas","Críticas","Aprovações"].map(item=><button className={filter===item?"active":""} onClick={()=>setFilter(item)} key={item}>{item}</button>)}</div>{visible.map(n=><article className={n.read?"read":""} key={n.id}><button className="notice-main" onClick={()=>setItems(old=>old.map(item=>item.id===n.id?{...item,read:true}:item))}><span className={`notice-icon ${n.tone}`}><Icon name={n.tone==="danger"?"alert":n.tone==="attention"?"clock":n.tone==="success"?"check":"bell"}/></span><span><b>{n.title}</b><small>{n.meta}</small><em>{n.module} · {n.time}</em></span>{!n.read&&<i/>}</button>{n.action&&<button className="notice-action" onClick={()=>notify(`${n.action}: fluxo demonstrativo aberto.`)}>{n.action}<Icon name="arrow"/></button>}</article>)}</Card><Card className="notification-settings"><p className="eyebrow">PRIORIDADES</p><h2>Distribuição atual</h2>{[["Críticas","1","danger"],["Atenção","1","attention"],["Informativas","2","info"],["Resolvidas","1","success"]].map(([name,count,tone])=><div key={name}><span className={`priority-dot ${tone}`}/><span><b>{name}</b><small>Notificações consolidadas</small></span><strong>{count}</strong></div>)}<button onClick={()=>notify("Preferências preparadas para configuração individual.")}><Icon name="settings"/> Preferências de alerta</button></Card></div></>;
}

const auditEvents=[
  {event:"Exportação de colaboradores",actor:"Júnior Sales",module:"Recursos Humanos",time:"Hoje, 09:42",risk:"Monitorado",icon:"download"},
  {event:"Perfil de acesso alterado",actor:"Administrador",module:"Segurança",time:"Hoje, 09:18",risk:"Sensível",icon:"key"},
  {event:"Documento visualizado",actor:"Camila Ferreira",module:"Documentos",time:"Hoje, 08:51",risk:"Normal",icon:"eye"},
  {event:"Usuário bloqueado",actor:"Sistema",module:"Autenticação",time:"Ontem, 17:36",risk:"Atenção",icon:"lock"},
  {event:"Departamento atualizado",actor:"Mariana Costa",module:"Estrutura",time:"Ontem, 15:04",risk:"Normal",icon:"org"},
  {event:"Matriz de permissões revisada",actor:"Júnior Sales",module:"Segurança",time:"12 jul, 16:22",risk:"Sensível",icon:"shield"},
];

function AuditView({ notify, events }: { notify:(message:string)=>void; events:OperationalEvent[] }) {
  const combinedEvents=[...events.map(event=>({event:event.title,actor:event.actor,module:event.module,time:event.time,risk:event.risk,icon:event.icon})),...auditEvents];
  const [risk,setRisk]=useState("Todos");const visible=combinedEvents.filter(e=>risk==="Todos"||e.risk===risk);
  return <><div className="page-head"><div><p className="eyebrow">ETAPA 4 · GOVERNANÇA</p><h1>Auditoria central</h1><p>Rastreabilidade imutável para acessos, dados sensíveis e operações críticas.</p></div><Button variant="secondary" onClick={()=>notify("Relatório de auditoria preparado para exportação segura.")}><Icon name="download"/> Exportar relatório</Button></div><MetricCards items={[["1.284","Eventos","Últimos 30 dias"],["0","Críticos","Nenhum incidente"],["14","Sensíveis","Todos justificados"],["100%","Rastreáveis","Ator, ação e horário"]]}/><div className="audit-layout"><Card className="audit-timeline"><div className="table-tools"><div><h2>Atividade recente</h2><p>Eventos demonstrativos do ecossistema</p></div><select value={risk} onChange={e=>setRisk(e.target.value)}><option>Todos</option><option>Normal</option><option>Monitorado</option><option>Sensível</option><option>Atenção</option></select></div>{visible.map(event=><button key={`${event.event}-${event.time}`}><span className="audit-icon"><Icon name={event.icon}/></span><span><b>{event.event}</b><small>{event.actor} · {event.module}</small></span><small>{event.time}</small><Status tone={event.risk==="Atenção"?"attention":event.risk==="Sensível"?"info":event.risk==="Normal"?"success":"neutral"}>{event.risk}</Status><Icon name="arrow"/></button>)}</Card><Card className="audit-health"><p className="eyebrow">GOVERNANÇA</p><h2>Integridade do registro</h2><div className="audit-score"><span><Icon name="shield" size={30}/></span><strong>100%</strong><small>Eventos íntegros</small></div><ul><li><span>✓</span> Inserção somente pelo sistema</li><li><span>✓</span> Registros não editáveis</li><li><span>✓</span> Retenção definida por categoria</li><li><span>✓</span> Exportações monitoradas</li></ul></Card></div></>;
}

function PersistenceView({ dataSource }: { dataSource: "demo" | "supabase" }) {
  const publicConnectionReady=Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)&&dataSource==="supabase";
  const entities=[
    ["Organização","Empresa e unidades","building","5 tabelas"],
    ["Identidade","Perfis e colaboradores","users","2 tabelas"],
    ["Autorização","Papéis, permissões e escopos","key","4 tabelas"],
    ["Módulos","Catálogo e ativação por empresa","modules","2 tabelas"],
    ["Serviços","Documentos e notificações","modules","2 tabelas"],
    ["Governança","Auditoria imutável","shield","1 tabela"],
  ];
  return <><div className="page-head"><div><p className="eyebrow">ETAPA 5 · PERSISTÊNCIA REAL</p><h1>Banco e autenticação</h1><p>Fundação PostgreSQL preparada para substituir os dados demonstrativos com segurança.</p></div><Status tone={publicConnectionReady?"success":"attention"}>{publicConnectionReady?"Supabase conectado":"Aguardando credenciais"}</Status></div><MetricCards items={[["16","Tabelas centrais","Schema versionado"],["5","Funções de segurança","Permissão, escopo e módulo"],["16","Tabelas com RLS","Negação por padrão"],["85%","Etapa preparada",dataSource==="supabase"?"Dados reais ativos":"Conexão adiada com segurança"]]}/><div className={`connection-banner ${publicConnectionReady?"connected":"pending"}`}><span><Icon name={publicConnectionReady?"check":"database"}/></span><div><b>{publicConnectionReady?"Conexão pública configurada":"Pacote pronto; conexão pendente"}</b><small>{publicConnectionReady?"URL e chave pública disponíveis no ambiente de produção.":"Migrations, testes e dados iniciais foram preparados sem armazenar credenciais nem alterar o servidor."}</small></div><Status tone={publicConnectionReady?"success":"attention"}>{publicConnectionReady?"Pronta":"Pendente"}</Status></div><div className="persistence-grid"><Card className="data-foundation"><div className="card-head"><div><p className="eyebrow">MODELO DE DADOS</p><h2>Núcleo empresarial</h2><p>Entidades compartilhadas por todos os módulos.</p></div><Status tone="success">Pacote validado</Status></div><div className="entity-foundation-list">{entities.map(([name,desc,icon,count])=><div key={name}><span><Icon name={icon}/></span><span><b>{name}</b><small>{desc}</small></span><Status>{count}</Status></div>)}</div></Card><Card className="deployment-checklist"><p className="eyebrow">IMPLANTAÇÃO</p><h2>Progresso da etapa</h2><div className="deployment-progress"><span><i style={{width:"85%"}}/></span><strong>85%</strong></div><ul><li className="done"><span>✓</span><div><b>Schema PostgreSQL</b><small>16 tabelas e índices</small></div></li><li className="done"><span>✓</span><div><b>Políticas RLS</b><small>Papel, escopo e módulo</small></div></li><li className="done"><span>✓</span><div><b>Clientes Supabase</b><small>Browser e servidor</small></div></li><li className="done"><span>✓</span><div><b>Supabase Auth</b><small>Login, callback e saída</small></div></li><li className="done"><span>✓</span><div><b>Provisionamento inicial</b><small>Empresa, estrutura, módulos e proprietário</small></div></li><li className="done"><span>✓</span><div><b>Validação prévia</b><small>Contrato verificável sem conexão</small></div></li><li><span>7</span><div><b>Conectar projeto</b><small>Requer HTTPS e credenciais</small></div></li><li><span>8</span><div><b>Aplicar e testar</b><small>Quando houver acesso ao servidor</small></div></li></ul><Button onClick={()=>window.location.assign("/login")}><Icon name="lock"/> Abrir tela de login</Button></Card></div><Card className="security-contract"><div><span><Icon name="lock"/></span><div><p className="eyebrow">CONTRATO DE SEGURANÇA</p><h2>O frontend nunca decide sozinho</h2><p>Cada consulta será validada no PostgreSQL por identidade, organização, módulo habilitado, papel, permissão e escopo. Mesmo uma chamada direta à API continuará limitada pelo RLS.</p></div></div><div className="security-pipeline"><span><b>Auth</b><small>Usuário</small></span><i>→</i><span><b>Empresa</b><small>Módulo ativo</small></span><i>→</i><span><b>Papel</b><small>Ação</small></span><i>→</i><span><b>Escopo</b><small>Registro</small></span></div></Card></>;
}

const adminViews: Record<string,{eyebrow:string;title:string;desc:string;stats:string[][];items:string[][]}> = {
  "Documentos": { eyebrow:"SERVIÇO CENTRAL", title:"Documentos", desc:"Arquivos privados, versionados e vinculados aos registros autorizados.", stats:[["8","Categorias"],["0","Arquivos"],["100%","Privado"],["0","Pendências"]], items:[["Corporativo","Categoria","Políticas e documentos institucionais"],["Colaborador","Categoria","Documentos pessoais autorizados"],["Contrato","Categoria","Acordos e vínculos"],["Saúde e Segurança","Categoria","ASOs, treinamentos e termos"],["Fiscal","Categoria","Documentos fiscais"],["Operacional","Categoria","Procedimentos e evidências"]] },
  "Notificações": { eyebrow:"SERVIÇO CENTRAL", title:"Notificações", desc:"Alertas e pendências consolidados de todos os módulos.", stats:[["7","Tipos"],["0","Novas"],["0","Críticas"],["0","Aprovações"]], items:[["Informativa","Tipo","Atualizações sem ação obrigatória"],["Atenção","Tipo","Prazo ou desvio próximo"],["Crítica","Tipo","Risco que exige resposta"],["Aprovação","Tipo","Decisão atribuída ao usuário"],["Vencimento","Tipo","Prazo regulamentar ou operacional"],["Tarefa atribuída","Tipo","Ação com responsável e prazo"]] },
  "Auditoria": { eyebrow:"GOVERNANÇA", title:"Auditoria", desc:"Rastreabilidade imutável para acessos e operações críticas.", stats:[["10","Eventos-base"],["0","Registros"],["0","Alertas"],["100%","Rastreável"]], items:[["Autenticação","Evento","Login, logout e falhas relevantes"],["Acessos","Evento","Concessão e remoção de permissões"],["Dados sensíveis","Evento","Consulta autorizada"],["Exportações","Evento","Download e extração de dados"],["Aprovações","Evento","Decisão e justificativa"],["Configurações","Evento","Alteração estrutural da plataforma"]] },
  "Configurações": { eyebrow:"ADMINISTRAÇÃO", title:"Configurações", desc:"Parâmetros centrais que serão herdados por todos os módulos.", stats:[["6","Categorias"],["1","Empresa"],["1","Idioma"],["3","Ambientes"]], items:[["Empresa e marca","Configuração","Logo, nome e identidade visual"],["Módulos","Configuração","Ativação e ordem de navegação"],["Segurança","Configuração","Sessão e políticas corporativas"],["Dados","Configuração","Classificação e retenção"],["Notificações","Configuração","Regras e prioridades"],["Ambientes","Configuração","Desenvolvimento, homologação e produção"]] },
};

function AdminView({ view }: { view: View }) {
  const d=adminViews[view];
  return <><div className="page-head"><div><p className="eyebrow">{d.eyebrow}</p><h1>{d.title}</h1><p>{d.desc}</p></div><Button><Icon name="plus"/> Novo registro</Button></div><div className="admin-stats">{d.stats.map(([v,l])=><Card key={l}><strong>{v}</strong><span>{l}</span></Card>)}</div><Card className="data-card"><div className="card-head"><div><h2>Estrutura inicial</h2><p>Dados demonstrativos da especificação da Fundação.</p></div><Button variant="secondary">Filtros</Button></div><div className="data-list">{d.items.map(([name,type,desc])=><button key={name}><span className="list-symbol"><Icon name={view==="Pessoas e Acessos"?"users":view==="Estrutura"?"org":view==="Documentos"?"file":view==="Notificações"?"bell":view==="Auditoria"?"shield":"settings"}/></span><span><b>{name}</b><small>{desc}</small></span><Status>{type}</Status><Icon name="arrow"/></button>)}</div></Card></>;
}

function AccessDenied({ target, access, onBack }: { target: string; access: ModuleAccessContext; onBack: () => void }) {
  return <div className="access-denied"><Card><span><Icon name="lock" size={30}/></span><p className="eyebrow">ACESSO CONTROLADO</p><h1>Esta área não faz parte do seu perfil</h1><p><b>{target}</b> não está disponível para {access.role.toLowerCase()} no escopo <b>{access.scopeLabel}</b>.</p><div><Status tone="attention">Negado por padrão</Status><small>A interface oculta o recurso e o PostgreSQL repetirá a validação quando a conexão real estiver ativa.</small></div><Button onClick={onBack}><Icon name="back"/> Voltar à visão autorizada</Button></Card></div>;
}

export default function Home() {
  const [view,setView]=useState<View>("Visão Geral"); const [mobile,setMobile]=useState(false); const [toast,setToast]=useState(""); const [globalQuery,setGlobalQuery]=useState("");
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [activeModuleId,setActiveModuleId]=useState<string | null>(null);
  const [accountMenu,setAccountMenu]=useState(false);
  const [deniedTarget,setDeniedTarget]=useState<string | null>(null);
  const [operationalEvents,setOperationalEvents]=useState<OperationalEvent[]>([]);
  const { snapshot, loading, error } = useFoundationData();
  // Identidade real do usuário autenticado (papel, permissões e escopo do banco).
  // Enquanto carrega, ou com o Supabase inacessível, cai no contexto demonstrativo.
  const { access, real: realAccess, profile: sessionProfile, reload: reloadIdentity } = useSessionAccess();
  const [accountPanel,setAccountPanel]=useState(false);
  const isExecutive = access.roleCode === "owner" || access.roleCode === "admin" || access.role === "Proprietário" || access.role === "Administrador";
  const modules=useMemo(()=>getCatalogModules(access,moduleRegistry),[access]);
  const visibleModules=useMemo(()=>getVisibleModules(access,moduleRegistry),[access]);

  // Módulo setorial de destino do usuário não executivo
  const targetedModule = useMemo(() => {
    if (isExecutive) return null;
    const explicitModule = access.scopes.find(s => s.type === "module" && s.moduleCode)?.moduleCode;
    if (explicitModule && visibleModules.some(m => m.id === explicitModule)) {
      return explicitModule;
    }
    return visibleModules[0]?.id ?? null;
  }, [isExecutive, access.scopes, visibleModules]);

  const [routedInitialModule, setRoutedInitialModule] = useState(false);

  // Direciona imediatamente para o módulo do usuário apenas no carregamento inicial
  useEffect(() => {
    if (!isExecutive && targetedModule && !routedInitialModule) {
      setActiveModuleId(targetedModule);
      setDeniedTarget(null);
      setRoutedInitialModule(true);
    }
  }, [isExecutive, targetedModule, routedInitialModule]);

  const foundationNav=useMemo(()=>{
    if (!isExecutive) {
      const isRh = targetedModule === "rh" || access.scopes.some(s => s.moduleCode === "rh");
      return nav.slice(2).filter((item) => {
        // Pessoas e Acessos só é relevante para quem atua no RH
        if (item.label === "Pessoas e Acessos") return isRh && hasPermission(access, "core.people.view");
        // Áreas de governança e infra são exclusivas de proprietário e admin
        if (
          item.label === "Estrutura" ||
          item.label === "Permissões e Segurança" ||
          item.label === "Banco e Autenticação" ||
          item.label === "Auditoria" ||
          item.label === "Configurações"
        ) {
          return false;
        }
        return !viewPermissions[item.label] || hasPermission(access, viewPermissions[item.label]!);
      });
    }
    return nav.slice(2).filter(item=>!viewPermissions[item.label]||hasPermission(access,viewPermissions[item.label]!));
  },[access, isExecutive, targetedModule]);

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
    if(permission&&!hasPermission(access,permission)){setDeniedTarget(v);setActiveModuleId(null);setMobile(false);return}
    setDeniedTarget(null);setActiveModuleId(null);setView(v);setMobile(false);
  };
  const openModule=(moduleId:string)=>{const manifest=getModuleById(moduleId);if(!manifest||!canAccessModule(access,manifest)){setDeniedTarget(manifest?.name??"Módulo");setActiveModuleId(null);setMobile(false);return}setDeniedTarget(null);setActiveModuleId(moduleId);setMobile(false)};
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
        <img className="brand-logo light" src="/pecsil-logo.png" alt="Pecsil — Molds for Glass"/><img className="brand-logo dark" src="/pecsil-logo-dark.png" alt="" aria-hidden="true"/>
        <b>Business OS</b>
        <button className="close-menu" onClick={()=>setMobile(false)} aria-label="Fechar menu"><Icon name="close"/></button>
      </div>
      <nav>
        {isExecutive && <>
          <p>Plataforma</p>
          {nav.slice(0,2).map(n=><button key={n.label} title={n.label} aria-label={n.label} className={!activeModuleId&&!deniedTarget&&view===n.label?"active":""} onClick={()=>change(n.label)}><Icon name={n.icon}/><span>{n.label}</span></button>)}
        </>}
        {visibleModules.length>0&&<><p>Módulos</p>
          {visibleModules.map(module=><button key={module.id} title={module.name} aria-label={module.name} className={activeModuleId===module.id?"active":""} onClick={()=>openModule(module.id)}><Icon name={module.icon}/><span>{module.name}</span></button>)}
        </>}
        {foundationNav.length>0&&<><p>Fundação</p>
          {foundationNav.map(n=><button key={n.label} title={n.label} aria-label={n.label} className={!activeModuleId&&!deniedTarget&&view===n.label?"active":""} onClick={()=>change(n.label)}><Icon name={n.icon}/><span>{n.label}</span>{n.label==="Notificações"&&<i>{3+operationalEvents.length}</i>}</button>)}
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
        <ThemeToggle/>
        {hasPermission(access,"core.notifications.view")&&<button className="header-icon" aria-label="Notificações" onClick={()=>change("Notificações")}><Icon name="bell" size={18}/><i/></button>}
        <div className="persona-switcher">
          <button className="user-card" onClick={()=>setAccountMenu(value=>!value)} aria-expanded={accountMenu} aria-label={`Conta: ${access.name}, ${access.role}`} title={`${access.name} · ${access.role}`}>
            {sessionProfile.avatarUrl ? <img className="avatar top avatar-photo" src={sessionProfile.avatarUrl} alt=""/> : <span className="avatar top">{access.initials}</span>}
            <span><b>{access.name}</b><small>{access.role}</small></span>
          </button>
          {accountMenu&&<div className="persona-menu account-menu"><p>{realAccess?"Conta":"Modo demonstrativo"}</p><div className="account-identity">{sessionProfile.avatarUrl ? <img className="avatar-photo" src={sessionProfile.avatarUrl} alt=""/> : <span>{access.initials}</span>}<span><b>{access.name}</b><small>{access.role} · {access.scopeLabel}</small></span></div><button className="account-item" onClick={()=>{setAccountMenu(false);setAccountPanel(true)}}><Icon name="users" size={16}/> Minha conta</button><button className="account-signout" onClick={signOut}><Icon name="lock" size={16}/> Sair da plataforma</button></div>}
        </div>
      </header>
      <div className="content">{error&&<div className="connection-banner pending"><span><Icon name="alert"/></span><div><b>Modo demonstrativo preservado</b><small>{error}</small></div></div>}{deniedTarget?<AccessDenied target={deniedTarget} access={access} onBack={()=>{setDeniedTarget(null);if(!isExecutive&&targetedModule){setActiveModuleId(targetedModule)}else{setView("Visão Geral")}}}/>:activeModuleId==="rh"?<HrModule people={snapshot.people} summary={snapshot.summary} notify={notify} onEvent={recordOperationalEvent} onExit={handleModuleExit} access={access}/>:activeModuleId?renderModuleComponent(activeModuleId,{notify,onEvent:recordOperationalEvent,onExit:handleModuleExit,access}):view==="Visão Geral"?<Overview setView={change} summary={snapshot.summary} onOpenModule={openModule} access={access} catalogModules={modules} visibleModules={visibleModules}/>:view==="Módulos"?<ModuleCatalog onOpenModule={openModule} modules={modules} access={access}/>:view==="Pessoas e Acessos"?<PeopleAccessView notify={notify} people={snapshot.people} summary={snapshot.summary}/>:view==="Estrutura"?<OrganizationView notify={notify} organizationData={snapshot.organizationData} summary={snapshot.summary} organizationName={snapshot.organization.name}/>:view==="Permissões e Segurança"?<SecurityView notify={notify}/>:view==="Busca Corporativa"?<CorporateSearchView initialQuery={globalQuery} setView={change}/>:view==="Documentos"?<DocumentsView notify={notify}/>:view==="Notificações"?<NotificationsView notify={notify} events={operationalEvents}/>:view==="Auditoria"?<AuditView notify={notify} events={operationalEvents}/>:view==="Banco e Autenticação"?<PersistenceView dataSource={snapshot.source}/>:<AdminView view={view}/>}</div>
    </main>{accountPanel&&<AccountPanel access={access} profile={sessionProfile} onClose={()=>setAccountPanel(false)} onSaved={reloadIdentity} notify={notify}/>}
      {toast&&<div className="toast"><span>✓</span>{toast}</div>}
  </div>;
}
