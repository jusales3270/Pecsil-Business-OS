"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Donut, Kpi, KpiGrid, Legend, Segmented, Status } from "../../packages/design-system";
import { hasPermission, type ModuleAccessContext } from "../../modules";
import type { FinanceSnapshot, FinanceTitle } from "../../lib/data/finance";

const sections = [
  ["Painel", "grid"], ["Contas a pagar", "payable"], ["Contas a receber", "receivable"],
  ["Fluxo de caixa", "chart"], ["Bancos e conciliação", "bank"], ["Centros de custo", "cost"],
  ["Relatórios", "report"], ["Homologação", "check"],
] as const;
type FinanceSection = (typeof sections)[number][0];
type PayableStatus = "Pendente" | "Em aprovação" | "Aprovado" | "Pago" | "Vencido";
type ReceivableStatus = "Em aberto" | "Recebido" | "Vencido" | "Parcial";
type Payable = { id:string|number; supplier:string; document:string; category:string; costCenter:string; due:string; value:number; status:PayableStatus };
type Receivable = { id:string|number; customer:string; document:string; category:string; due:string; value:number; received:number; status:ReceivableStatus };
type HomologationStatus = "Validado" | "Pendente";
type HomologationItem = { id:string; title:string; description:string; owner:string; status:HomologationStatus };

function mapTitleToPayable(title: FinanceTitle): Payable {
  const statusMap: Record<string, PayableStatus> = {
    pending_approval: "Em aprovação",
    approved: "Aprovado",
    settled: "Pago",
    overdue: "Vencido",
    draft: "Pendente",
  };
  return {
    id: title.id,
    supplier: title.counterparty,
    document: title.documentNumber || "—",
    category: title.chartAccount || "Despesa",
    costCenter: title.costCenter || "Administrativo",
    due: title.installments[0]?.dueDate || title.issueDate,
    value: title.originalAmount,
    status: statusMap[title.status] || "Pendente",
  };
}

function mapTitleToReceivable(title: FinanceTitle): Receivable {
  const statusMap: Record<string, ReceivableStatus> = {
    settled: "Recebido",
    partially_settled: "Parcial",
    overdue: "Vencido",
  };
  const received = title.installments.reduce((acc, i) => acc + (i.settledAmount || 0), 0);
  return {
    id: title.id,
    customer: title.counterparty,
    document: title.documentNumber || "—",
    category: title.chartAccount || "Receita",
    due: title.installments[0]?.dueDate || title.issueDate,
    value: title.originalAmount,
    received,
    status: statusMap[title.status] || "Em aberto",
  };
}

const initialHomologation:HomologationItem[]=[
  {id:"payables",title:"Contas a pagar",description:"Cadastro, vencimento, aprovação, pagamento e estorno",owner:"Financeiro",status:"Validado"},
  {id:"receivables",title:"Contas a receber",description:"Recebimento, baixa parcial, atraso e cobrança",owner:"Financeiro",status:"Validado"},
  {id:"approvals",title:"Alçadas de aprovação",description:"Limites por valor, função e substituição de aprovador",owner:"Diretoria",status:"Pendente"},
  {id:"accounts",title:"Plano de contas",description:"Categorias contábeis e classificação gerencial",owner:"Controladoria",status:"Pendente"},
  {id:"cost-centers",title:"Centros de custo",description:"Vínculo de despesas, orçamento e responsáveis",owner:"Controladoria",status:"Validado"},
  {id:"banks",title:"Bancos e conciliação",description:"Importação, correspondência e tratamento de diferenças",owner:"Tesouraria",status:"Validado"},
  {id:"reports",title:"Indicadores da diretoria",description:"Caixa, inadimplência, compromissos e variações",owner:"Diretoria",status:"Pendente"},
  {id:"access",title:"Perfis e auditoria",description:"Segregação de funções, escopo e trilha de ações",owner:"Administrador",status:"Validado"},
];

const initialPayables:Payable[]=[
  {id:1,supplier:"Aços Boituva Ltda.",document:"NF 18452",category:"Matéria-prima",costCenter:"Produção",due:"2026-07-18",value:48290,status:"Em aprovação"},
  {id:2,supplier:"Energia Sul",document:"FAT 07/2026",category:"Energia elétrica",costCenter:"Industrial",due:"2026-07-19",value:27640,status:"Aprovado"},
  {id:3,supplier:"TechMold Serviços",document:"NF 0921",category:"Manutenção",costCenter:"Manutenção",due:"2026-07-15",value:12800,status:"Vencido"},
  {id:4,supplier:"Transportes Rápido SP",document:"CT-e 77108",category:"Fretes",costCenter:"Logística",due:"2026-07-25",value:7450,status:"Pendente"},
  {id:5,supplier:"Office Mais",document:"NF 5528",category:"Material administrativo",costCenter:"Administrativo",due:"2026-07-12",value:2380,status:"Pago"},
];
const initialReceivables:Receivable[]=[
  {id:1,customer:"Vidros Nacional S.A.",document:"NF-e 30218",category:"Venda de moldes",due:"2026-07-18",value:126500,received:0,status:"Em aberto"},
  {id:2,customer:"Cristal Forte",document:"NF-e 30204",category:"Venda de moldes",due:"2026-07-14",value:68400,received:0,status:"Vencido"},
  {id:3,customer:"Glass Brasil",document:"NF-e 30188",category:"Serviços técnicos",due:"2026-07-22",value:45200,received:20000,status:"Parcial"},
  {id:4,customer:"Embalagens Luz",document:"NF-e 30161",category:"Venda de moldes",due:"2026-07-09",value:93750,received:93750,status:"Recebido"},
];
const money=(value:number)=>value.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const moneyShort=(value:number)=>value>=1_000_000
  ? `R$ ${(value/1_000_000).toLocaleString("pt-BR",{maximumFractionDigits:1})} mi`
  : value>=1_000
    ? `R$ ${(value/1_000).toLocaleString("pt-BR",{maximumFractionDigits:0})} mil`
    : money(value);
const date=(value:string)=>new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
const tone=(status:string):"success"|"attention"|"danger"|"info"|"neutral"=>status==="Pago"||status==="Recebido"?"success":status==="Vencido"?"danger":status.includes("aprovação")||status==="Parcial"?"attention":status==="Aprovado"?"info":"neutral";

function FIcon({name,size=18}:{name:string;size?:number}){const paths:Record<string,React.ReactNode>={grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,payable:<><path d="M4 5h16v14H4zM7 9h10M7 13h6"/><path d="m16 16 2 2 3-4"/></>,receivable:<><path d="M4 5h16v14H4zM7 9h10M7 13h6"/><path d="M18 12v6M15 15h6"/></>,chart:<><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></>,bank:<><path d="m3 9 9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/></>,cost:<><circle cx="12" cy="12" r="9"/><path d="M12 6v12M16 9c-1-2-7-2-7 1 0 3 7 1 7 5 0 3-6 3-8 1"/></>,report:<><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h6"/></>,check:<><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,back:<path d="m15 18-6-6 6-6"/>,plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="m9 18 6-6-6-6"/>,close:<path d="m6 6 12 12M18 6 6 18"/>,search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,alert:<><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></>};return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>}

export function FinanceModule({notify,onEvent,onExit,access}:{notify:(message:string)=>void;onEvent:(message:string,module?:string)=>void;onExit:()=>void;access:ModuleAccessContext}){
  const [section,setSection]=useState<FinanceSection>("Painel");
  const [payables,setPayables]=useState<Payable[]>(initialPayables);
  const [receivables,setReceivables]=useState<Receivable[]>(initialReceivables);
  const [modal,setModal]=useState<"payable"|"receivable"|"report"|null>(null);
  const [selected,setSelected]=useState<Payable|Receivable|null>(null);
  const [homologation,setHomologation]=useState(initialHomologation);
  const track=(message:string)=>{notify(message);onEvent(message,"Financeiro")};
  const canCreate=hasPermission(access,"financeiro.create");
  const canApprove=hasPermission(access,"financeiro.approve");
  const canSettle=hasPermission(access,"financeiro.settle");
  const canReconcile=hasPermission(access,"financeiro.reconcile");
  const canExport=hasPermission(access,"financeiro.export");
  const canAdmin=hasPermission(access,"financeiro.admin");
  const accessibleSections=canAdmin?sections:sections.filter(([label])=>label!=="Homologação");

  async function loadFinanceData(signal?: AbortSignal) {
    try {
      const res = await fetch("/api/finance", { cache: "no-store", signal });
      if (!res.ok) return;
      const data = (await res.json()) as FinanceSnapshot;
      if (data && Array.isArray(data.titles)) {
        const pList = data.titles.filter(t => t.direction === "payable").map(mapTitleToPayable);
        const rList = data.titles.filter(t => t.direction === "receivable").map(mapTitleToReceivable);
        if (pList.length > 0 || rList.length > 0) {
          setPayables(pList);
          setReceivables(rList);
        }
      }
    } catch {
      // Keep demo fallback
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadFinanceData(controller.signal);
    return () => controller.abort();
  }, []);

  async function handleSavePayable(entry: Omit<Payable, "id">) {
    try {
      const res = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "payable",
          counterparty: entry.supplier,
          documentNumber: entry.document,
          category: entry.category,
          costCenterName: entry.costCenter,
          dueDate: entry.due,
          amount: entry.value,
        }),
      });
      if (res.ok) {
        track("Conta a pagar salva no Supabase.");
        await loadFinanceData();
        return;
      }
    } catch {
      // fallback local
    }
    setPayables(current => [{ id: Date.now(), ...entry }, ...current]);
    track("Conta a pagar cadastrada.");
  }

  async function handleSaveReceivable(entry: Omit<Receivable, "id">) {
    try {
      const res = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "receivable",
          counterparty: entry.customer,
          documentNumber: entry.document,
          category: entry.category,
          dueDate: entry.due,
          amount: entry.value,
        }),
      });
      if (res.ok) {
        track("Conta a receber salva no Supabase.");
        await loadFinanceData();
        return;
      }
    } catch {
      // fallback local
    }
    setReceivables(current => [{ id: Date.now(), ...entry }, ...current]);
    track("Conta a receber cadastrada.");
  }

  async function handleUpdatePayableStatus(id: string | number, status: PayableStatus) {
    setPayables(current => current.map(x => (x.id === id ? { ...x, status } : x)));
    if (typeof id === "string") {
      try {
        const type = status === "Aprovado" ? "approve" : status === "Pago" ? "settle" : null;
        if (type) {
          await fetch("/api/finance", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, titleId: id }),
          });
          await loadFinanceData();
        }
      } catch {
        // local already updated
      }
    }
    track(`Conta a pagar: situação alterada para ${status}.`);
  }

  async function handleReceive(id: string | number) {
    setReceivables(current => current.map(x => (x.id === id ? { ...x, received: x.value, status: "Recebido" } : x)));
    if (typeof id === "string") {
      try {
        await fetch("/api/finance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "settle", titleId: id }),
        });
        await loadFinanceData();
      } catch {
        // local already updated
      }
    }
    track("Conta a receber: recebimento confirmado.");
  }

  const render=()=>section==="Painel"?<Dashboard payables={payables} receivables={receivables} setSection={setSection} access={access}/>:section==="Contas a pagar"?<Payables data={payables} onUpdateStatus={handleUpdatePayableStatus} canCreate={canCreate} canApprove={canApprove} canSettle={canSettle} openCreate={()=>setModal("payable")} inspect={setSelected} track={track}/>:section==="Contas a receber"?<Receivables data={receivables} onReceive={handleReceive} canCreate={canCreate} canSettle={canSettle} openCreate={()=>setModal("receivable")} inspect={setSelected} track={track}/>:section==="Fluxo de caixa"?<CashFlow payables={payables} receivables={receivables}/>:section==="Bancos e conciliação"?<Banks track={track} canReconcile={canReconcile}/>:section==="Centros de custo"?<CostCenters track={track} canCreate={canCreate}/>:section==="Relatórios"?<Reports open={(title)=>{setSelected({id:0,customer:title,document:"",category:"",due:"",value:0,received:0,status:"Em aberto"});setModal("report")}}/>:<Homologation values={homologation} setValues={setHomologation} track={track}/>;
  const isOwner = access.role === "Proprietário" || access.roleCode === "owner" || access.roleCode === "director";

  return <div className="finance-module">
    <div className="ds-module-bar">
      {isOwner && <Button variant="secondary" compact onClick={onExit}><FIcon name="back"/> Ecossistema</Button>}
      <Segmented options={accessibleSections.map(([label])=>label)} value={section} onChange={setSection} ariaLabel="Seções do módulo Financeiro"/>
      <Status tone="info">{access.scopeLabel}</Status>
    </div>
    <main className="finance-workspace">{render()}</main>
    {modal==="payable"&&<EntryForm kind="payable" onClose={()=>setModal(null)} onSave={(entry)=>{void handleSavePayable(entry as Omit<Payable,"id">);setModal(null)}}/>}{modal==="receivable"&&<EntryForm kind="receivable" onClose={()=>setModal(null)} onSave={(entry)=>{void handleSaveReceivable(entry as Omit<Receivable,"id">);setModal(null)}}/>}{selected&&modal!=="report"&&<Detail item={selected} onClose={()=>setSelected(null)}/>} {modal==="report"&&<ReportDetail title={(selected as Receivable)?.customer??"Relatório financeiro"} canExport={canExport} track={track} onClose={()=>{setModal(null);setSelected(null)}}/>}</div>
}

function Header({eyebrow,title,description,action,onAction}:{eyebrow:string;title:string;description:string;action?:string;onAction?:()=>void}){return <div className="finance-page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action&&<Button onClick={onAction}><FIcon name="plus"/> {action}</Button>}</div>}
/** Cartão de indicador do módulo. Delega ao KPI do Design System — nenhum
 *  módulo desenha o próprio cartão de número. */
function Metric({value,label,meta,toneName}:{value:string;label:string;meta:string;toneName:"blue"|"green"|"amber"|"red"|"purple"|"teal"}){
  return <Kpi label={label} caption={meta} value={value} tone={toneName}/>;
}
function Dashboard({payables,receivables,setSection,access}:{payables:Payable[];receivables:Receivable[];setSection:(v:FinanceSection)=>void;access:ModuleAccessContext}){const payableOpen=payables.filter(x=>x.status!=="Pago").reduce((a,b)=>a+b.value,0);const receiveOpen=receivables.reduce((a,b)=>a+b.value-b.received,0);return <><Header eyebrow={`FINANCEIRO · ${access.role.toUpperCase()}`} title="Visão financeira" description={`Caixa, compromissos e recebíveis autorizados para ${access.scopeLabel.toLowerCase()}.`}/><KpiGrid><Metric value={moneyShort(842350)} label="Saldo disponível" meta="4 contas bancárias" toneName="blue"/><Metric value={moneyShort(receiveOpen)} label="A receber" meta="Próximos 30 dias" toneName="green"/><Metric value={moneyShort(payableOpen)} label="A pagar" meta="Próximos 30 dias" toneName="amber"/><Metric value={moneyShort(126840)} label="Caixa projetado" meta="Fechamento do mês" toneName="purple"/></KpiGrid><div className="finance-dashboard-grid"><Card className="finance-pending"><div className="finance-card-head"><div><p className="eyebrow">CENTRAL FINANCEIRA</p><h2>Ações que exigem atenção</h2><p>Compromissos, cobranças e conciliações pendentes.</p></div><Status tone="attention">5 pendências</Status></div>{[["Pagamento vencido · TechMold","R$ 12.800 · venceu em 15 jul","Contas a pagar"],["Título vencido · Cristal Forte","R$ 68.400 · cobrança pendente","Contas a receber"],["Conciliação bancária","3 lançamentos sem correspondência","Bancos e conciliação"]].map(([title,meta,target],i)=><button key={title} onClick={()=>setSection(target as FinanceSection)}><span><FIcon name={i===0?"payable":i===1?"receivable":"bank"}/></span><span><b>{title}</b><small>{meta}</small></span><Status tone={i<2?"danger":"attention"}>{i<2?"Prioridade":"Conferir"}</Status><FIcon name="arrow"/></button>)}</Card><Card className="finance-position"><p className="eyebrow">POSIÇÃO DO MÊS</p><h2>Entradas e saídas</h2><div className="finance-donut"><Donut slices={[{label:"Receitas previstas",value:842400,tone:"green"},{label:"Despesas previstas",value:715560,tone:"amber"}]} total={126840} caption="saldo projetado" size={170}/></div>
    <Legend slices={[{label:"Receitas previstas",value:842400,tone:"green"},{label:"Despesas previstas",value:715560,tone:"amber"}]}/><dl><div><dt>Receitas previstas</dt><dd>R$ 842.400</dd></div><div><dt>Despesas previstas</dt><dd>R$ 715.560</dd></div><div><dt>Margem de caixa</dt><dd>15,1%</dd></div></dl><button onClick={()=>setSection("Fluxo de caixa")}>Ver fluxo completo <FIcon name="arrow"/></button></Card></div></>}

function Payables({data,onUpdateStatus,canCreate,canApprove,canSettle,openCreate,inspect,track}:{data:Payable[];onUpdateStatus:(id:string|number,status:PayableStatus)=>void;canCreate:boolean;canApprove:boolean;canSettle:boolean;openCreate:()=>void;inspect:(x:Payable)=>void;track:(m:string)=>void}){const[query,setQuery]=useState("");const[filter,setFilter]=useState("Todos");const visible=useMemo(()=>data.filter(x=>(filter==="Todos"||x.status===filter)&&`${x.supplier} ${x.document} ${x.category}`.toLowerCase().includes(query.toLowerCase())),[data,query,filter]);const update=(id:string|number,status:PayableStatus)=>{onUpdateStatus(id,status)};return <><Header eyebrow="FINANCEIRO · OBRIGAÇÕES" title="Contas a pagar" description="Títulos, vencimentos, aprovações e pagamentos por centro de custo." action={canCreate?"Nova conta":undefined} onAction={openCreate}/><div className="finance-toolbar"><label><FIcon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar fornecedor, documento ou categoria..."/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option>Todos</option><option>Pendente</option><option>Em aprovação</option><option>Aprovado</option><option>Pago</option><option>Vencido</option></select></div><Card className="finance-table-card"><div className="finance-table payable"><div className="head"><span>Fornecedor</span><span>Vencimento</span><span>Centro de custo</span><span>Valor</span><span>Situação</span><span/></div>{visible.map(x=><div className="row" key={x.id}><button className="title" onClick={()=>inspect(x)}><b>{x.supplier}</b><small>{x.document} · {x.category}</small></button><span>{date(x.due)}</span><span>{x.costCenter}</span><strong>{money(x.value)}</strong><Status tone={tone(x.status)}>{x.status}</Status><span className="actions">{canApprove&&(x.status==="Pendente"||x.status==="Em aprovação")&&<button onClick={()=>update(x.id,"Aprovado")}>Aprovar</button>}{canSettle&&x.status==="Aprovado"&&<button onClick={()=>update(x.id,"Pago")}>Pagar</button>}<button onClick={()=>inspect(x)} aria-label={`Detalhes de ${x.supplier}`}><FIcon name="arrow"/></button></span></div>)}</div></Card></>}

function Receivables({data,onReceive,canCreate,canSettle,openCreate,inspect,track}:{data:Receivable[];onReceive:(id:string|number)=>void;canCreate:boolean;canSettle:boolean;openCreate:()=>void;inspect:(x:Receivable)=>void;track:(m:string)=>void}){const[query,setQuery]=useState("");const visible=data.filter(x=>`${x.customer} ${x.document}`.toLowerCase().includes(query.toLowerCase()));const receive=(id:string|number)=>{onReceive(id)};return <><Header eyebrow="FINANCEIRO · RECEITAS" title="Contas a receber" description="Títulos, recebimentos, inadimplência e acompanhamento de cobrança." action={canCreate?"Novo recebível":undefined} onAction={openCreate}/><div className="finance-toolbar"><label><FIcon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente ou documento..."/></label><Status tone="danger">1 título vencido</Status></div><Card className="finance-table-card"><div className="finance-table receivable"><div className="head"><span>Cliente</span><span>Vencimento</span><span>Valor</span><span>Recebido</span><span>Situação</span><span/></div>{visible.map(x=><div className="row" key={x.id}><button className="title" onClick={()=>inspect(x)}><b>{x.customer}</b><small>{x.document} · {x.category}</small></button><span>{date(x.due)}</span><strong>{money(x.value)}</strong><span>{money(x.received)}</span><Status tone={tone(x.status)}>{x.status}</Status><span className="actions">{canSettle&&x.status!=="Recebido"&&<button onClick={()=>receive(x.id)}>Receber</button>}<button onClick={()=>inspect(x)} aria-label={`Detalhes de ${x.customer}`}><FIcon name="arrow"/></button></span></div>)}</div></Card></>}

function CashFlow({payables,receivables}:{payables:Payable[];receivables:Receivable[]}){const months=[{m:"JUL",in:842,out:716},{m:"AGO",in:910,out:768},{m:"SET",in:875,out:702},{m:"OUT",in:980,out:824},{m:"NOV",in:1040,out:861},{m:"DEZ",in:1120,out:945}];return <><Header eyebrow="FINANCEIRO · TESOURARIA" title="Fluxo de caixa" description="Visão realizada e projetada das disponibilidades financeiras."/><KpiGrid><Metric value={moneyShort(receivables.reduce((a,b)=>a+b.received,0))} label="Entradas realizadas" meta="Julho de 2026" toneName="green"/><Metric value={moneyShort(payables.filter(x=>x.status==="Pago").reduce((a,b)=>a+b.value,0))} label="Saídas realizadas" meta="Julho de 2026" toneName="amber"/><Metric value="R$ 126,8 mil" label="Resultado projetado" meta="Fechamento mensal" toneName="blue"/></KpiGrid><Card className="cash-chart"><div className="finance-card-head"><div><p className="eyebrow">PROJEÇÃO DE 6 MESES</p><h2>Entradas versus saídas</h2><p>Valores demonstrativos em milhares de reais.</p></div><div className="legend"><span className="in">Entradas</span><span className="out">Saídas</span></div></div><div className="cash-bars">{months.map(x=><div key={x.m}><div><i className="in" style={{height:`${x.in/12}px`}}/><i className="out" style={{height:`${x.out/12}px`}}/></div><b>{x.m}</b><small>+{money((x.in-x.out)*1000).replace(",00","")}</small></div>)}</div></Card></>}

function Banks({track,canReconcile}:{track:(m:string)=>void;canReconcile:boolean}){const[items,setItems]=useState([["Banco do Brasil · 4521-7","Conta corrente","R$ 428.650","Conciliada"],["Itaú · 88304-2","Conta corrente","R$ 296.180","3 pendências"],["Santander · 10298-4","Conta pagamentos","R$ 117.520","Conciliada"],["Caixa · Aplicação","Reserva financeira","R$ 680.000","Atualizada"]]);const reconcile=(index:number)=>{setItems(current=>current.map((x,i)=>i===index?[x[0],x[1],x[2],"Conciliada"]:x));track("Conciliação bancária concluída.")};return <><Header eyebrow="FINANCEIRO · BANCOS" title="Bancos e conciliação" description="Saldos e correspondência demonstrativa entre extrato e lançamentos." action={canReconcile?"Importar extrato":undefined} onAction={()=>track("Extrato OFX demonstrativo importado.")}/><div className="bank-grid">{items.map((x,i)=><Card key={x[0]} className="bank-card"><span><FIcon name="bank"/></span><Status tone={x[3]==="Conciliada"||x[3]==="Atualizada"?"success":"attention"}>{x[3]}</Status><h2>{x[0]}</h2><p>{x[1]}</p><strong>{x[2]}</strong><small>Saldo demonstrativo disponível</small>{canReconcile&&x[3]!=="Conciliada"&&x[3]!=="Atualizada"?<Button onClick={()=>reconcile(i)}>Conciliar agora</Button>:<button onClick={()=>track(`${x[0]}: extrato aberto.`)}>Ver movimentações <FIcon name="arrow"/></button>}</Card>)}</div></>}

function CostCenters({track,canCreate}:{track:(m:string)=>void;canCreate:boolean}){const centers=[["Produção","R$ 382.400","53%","Industrial"],["Manutenção","R$ 96.850","14%","Industrial"],["Administrativo","R$ 82.300","11%","Corporativo"],["Comercial","R$ 71.600","10%","Corporativo"],["Qualidade","R$ 54.200","8%","Industrial"],["RH e SST","R$ 28.210","4%","Corporativo"]];return <><Header eyebrow="FINANCEIRO · CLASSIFICAÇÃO" title="Centros de custo" description="Distribuição gerencial das despesas e orçamento por área." action={canCreate?"Novo centro":undefined} onAction={()=>track("Cadastro demonstrativo de centro de custo iniciado.")}/><div className="cost-grid">{centers.map(([name,value,share,group])=><Card key={name}><span><FIcon name="cost"/></span><Status>{group}</Status><h2>{name}</h2><strong>{value}</strong><small>Realizado no mês · {share} do total</small><div><i style={{width:share}}/></div><button onClick={()=>track(`${name}: lançamentos do centro de custo abertos.`)}>Ver lançamentos <FIcon name="arrow"/></button></Card>)}</div></>}

function Reports({open}:{open:(title:string)=>void}){const reports=[["Posição financeira","Saldos, compromissos e disponibilidades atuais."],["Contas a pagar por vencimento","Agenda financeira e exposição por fornecedor."],["Contas a receber e inadimplência","Recebíveis, atrasos e recuperação de crédito."],["Fluxo de caixa projetado","Entradas e saídas previstas para 12 meses."],["Despesas por centro de custo","Realizado, orçamento e variações por área."],["Conciliação bancária","Correspondências e pendências por conta."]];return <><Header eyebrow="FINANCEIRO · INTELIGÊNCIA" title="Relatórios financeiros" description="Indicadores preparados para a inteligência corporativa do Pecsil Business OS."/><div className="finance-report-grid">{reports.map(([title,desc],i)=><Card key={title}><span><FIcon name="report"/></span><Status tone={i===2||i===5?"attention":"success"}>{i===2||i===5?"Atenção":"Atualizado"}</Status><h2>{title}</h2><p>{desc}</p><button onClick={()=>open(title)}>Abrir relatório <FIcon name="arrow"/></button></Card>)}</div></>}

function Homologation({values,setValues,track}:{values:HomologationItem[];setValues:React.Dispatch<React.SetStateAction<HomologationItem[]>>;track:(m:string)=>void}){
  const [tab,setTab]=useState<"Critérios"|"Alçadas"|"Plano de contas"|"Indicadores"|"Evidências">("Critérios");
  const [evidenceCount,setEvidenceCount]=useState(6);
  const [released,setReleased]=useState(false);
  const done=values.filter(item=>item.status==="Validado").length;
  const progress=Math.round(done/values.length*100);
  const toggle=(id:string)=>setValues(current=>current.map(item=>item.id===id?{...item,status:item.status==="Validado"?"Pendente":"Validado"}:item));
  const validate=(id:string,message:string)=>{
    const pending=values.some(item=>item.id===id&&item.status==="Pendente");
    setValues(current=>current.map(item=>item.id===id?{...item,status:"Validado"}:item));
    if(pending)setEvidenceCount(value=>value+1);
    track(message);
  };
  const saveEvidence=()=>{setEvidenceCount(value=>value+1);track("Homologação: nova evidência funcional registrada.")};
  const release=()=>{if(done!==values.length)return;setReleased(true);track("Módulo Financeiro homologado funcionalmente para o ambiente demonstrativo.")};
  const approvalRows=[
    ["Até R$ 5 mil","Área solicitante","Gestor da área","Dispensada","Financeiro"],
    ["R$ 5 mil a R$ 25 mil","Área solicitante","Gestor da área","Gerência financeira","Financeiro"],
    ["R$ 25 mil a R$ 100 mil","Gestor da área","Gerência financeira","Diretoria","Tesouraria"],
    ["Acima de R$ 100 mil","Gerência","Diretoria","Proprietário","Tesouraria"],
  ];
  const accountGroups=[
    ["1.01","Receitas operacionais","Vendas de moldes e serviços técnicos","Receita","Financeiro"],
    ["2.01","Matéria-prima e produção","Aços, insumos e custos industriais","Despesa","Compras"],
    ["2.02","Despesas administrativas","Serviços, materiais e estrutura corporativa","Despesa","Financeiro"],
    ["2.03","Despesas financeiras","Tarifas, IOF, juros e empréstimos","Despesa","Bancos"],
    ["2.04","Tributos e retenções","PIS, Cofins e demais obrigações fiscais","Despesa","Fiscal"],
    ["2.05","Sócios e pró-labore","Retiradas, pró-labore e baixas parciais","Despesa","Diretoria"],
    ["3.01","Transferências internas","Movimentações entre contas sem efeito no resultado","Transferência","Bancos"],
  ];
  const indicators=[
    ["Saldo disponível","Posição consolidada por conta bancária","Diário","Tesouraria"],
    ["Contas a pagar","Vencido, hoje, 7, 15 e 30 dias","Diário","Financeiro"],
    ["Contas a receber","Aberto, parcial, vencido e recuperado","Diário","Financeiro"],
    ["Fluxo de caixa projetado","Entradas, saídas e saldo acumulado","Semanal","Diretoria"],
    ["Inadimplência","Valor, prazo médio e concentração por cliente","Semanal","Financeiro"],
    ["Conciliação bancária","Correspondidos, divergentes e não identificados","Diário","Tesouraria"],
    ["Base PIS/Cofins","Recebimentos, retenções e valor líquido por competência","Mensal","Fiscal"],
    ["Retiradas de sócios","Pró-labore, retiradas e baixas parciais","Mensal","Diretoria"],
  ];
  return <><Header eyebrow="FINANCEIRO · GOVERNANÇA" title="Homologação funcional" description="Revise regras, responsáveis e evidências antes de encerrar a versão demonstrativa do módulo."/>
    <div className="finance-homologation-summary">
      <Card><p className="eyebrow">PROGRESSO DO ACEITE</p><div className="finance-homologation-score"><strong>{progress}%</strong><Status tone={released?"success":progress===100?"info":"attention"}>{released?"Homologado":progress===100?"Pronto para decisão":"Em validação"}</Status></div><div className="finance-homologation-bar"><i style={{width:`${progress}%`}}/></div><p>{done} de {values.length} critérios confirmados pelos responsáveis.</p></Card>
      <Card><p className="eyebrow">RESPONSÁVEIS</p><strong>5 áreas envolvidas</strong><p>Financeiro, Tesouraria, Controladoria, Diretoria e Administração.</p></Card>
      <Card><p className="eyebrow">EVIDÊNCIAS</p><strong>{evidenceCount} registros</strong><p>Cenários testados, decisões e observações da homologação.</p></Card>
      <Card className="dependency"><p className="eyebrow">DEPENDÊNCIA POSTERIOR</p><strong>Persistência real</strong><p>Supabase, RLS e arquivos não bloqueiam o aceite funcional.</p></Card>
    </div>
    <div className="finance-homologation-tabs">{(["Critérios","Alçadas","Plano de contas","Indicadores","Evidências"] as const).map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}{item==="Critérios"&&<span>{values.length-done}</span>}</button>)}</div>
    {tab==="Critérios"&&<Card className="finance-homologation-panel"><div className="finance-homologation-head"><div><p className="eyebrow">ACEITE POR DOMÍNIO</p><h2>Critérios funcionais</h2><p>Cada item pode ser reaberto enquanto a decisão final não for registrada.</p></div><Status tone={done===values.length?"success":"attention"}>{values.length-done} pendências</Status></div><div className="finance-homologation-list">{values.map((item,index)=><section key={item.id}><button className={item.status==="Validado"?"checked":""} onClick={()=>toggle(item.id)} aria-label={`${item.status==="Validado"?"Reabrir":"Validar"} ${item.title}`}>{item.status==="Validado"?"✓":index+1}</button><span><b>{item.title}</b><small>{item.description}</small></span><span><small>Responsável</small><b>{item.owner}</b></span><Status tone={item.status==="Validado"?"success":"attention"}>{item.status}</Status><button className="review" onClick={()=>{toggle(item.id);track(`${item.title}: critério ${item.status==="Validado"?"reaberto":"validado"}.`)}}>{item.status==="Validado"?"Reabrir":"Validar"}</button></section>)}</div></Card>}
    {tab==="Alçadas"&&<Card className="finance-approval-matrix"><div className="finance-homologation-head"><div><p className="eyebrow">SEGREGAÇÃO DE FUNÇÕES</p><h2>Matriz proposta de aprovação</h2><p>Faixas iniciais preparadas para validação conjunta com a diretoria.</p></div><Button onClick={()=>validate("approvals","Homologação: matriz de alçadas validada e registrada como evidência.")}>{values.find(item=>item.id==="approvals")?.status==="Validado"?"Alçadas validadas":"Validar alçadas"}</Button></div><div className="finance-approval-table"><div><span>Faixa</span><span>Solicitante</span><span>1ª aprovação</span><span>2ª aprovação</span><span>Liquidação</span></div>{approvalRows.map(row=><section key={row[0]}>{row.map(cell=><span key={cell}>{cell}</span>)}</section>)}</div><Callout variant="warning" title="Controle obrigatório">O mesmo usuário não poderá solicitar, aprovar e liquidar o mesmo título. Substituições de aprovador deverão manter a trilha de auditoria.</Callout></Card>}
    {tab==="Plano de contas"&&<Card className="finance-approval-matrix"><div className="finance-homologation-head"><div><p className="eyebrow">CLASSIFICAÇÃO GERENCIAL</p><h2>Plano de contas inicial</h2><p>Estrutura deduzida dos relatórios da Pecsil e preparada para refinamento posterior pela Controladoria.</p></div><Button onClick={()=>validate("accounts","Homologação: plano de contas inicial validado e registrado como evidência.")}>{values.find(item=>item.id==="accounts")?.status==="Validado"?"Plano validado":"Validar estrutura"}</Button></div><div className="finance-account-table"><div><span>Código</span><span>Grupo</span><span>Aplicação</span><span>Natureza</span><span>Origem</span></div>{accountGroups.map(row=><section key={row[0]}>{row.map((cell,index)=><span key={cell}>{index===3?<Status tone={cell==="Receita"?"success":cell==="Despesa"?"attention":"info"}>{cell}</Status>:cell}</span>)}</section>)}</div><Callout variant="warning" title="Limite desta homologação">A estrutura organiza o fluxo financeiro. Regras contábeis, fiscais e lançamentos oficiais serão aprofundados no futuro módulo Contabilidade/Controladoria.</Callout></Card>}
    {tab==="Indicadores"&&<Card className="finance-approval-matrix"><div className="finance-homologation-head"><div><p className="eyebrow">VISÃO EXECUTIVA</p><h2>Indicadores homologáveis</h2><p>Painéis operacionais e executivos derivados dos fluxos e relatórios apresentados pela área financeira.</p></div><Button onClick={()=>validate("reports","Homologação: indicadores executivos validados e registrados como evidência.")}>{values.find(item=>item.id==="reports")?.status==="Validado"?"Indicadores validados":"Validar indicadores"}</Button></div><div className="finance-indicator-grid">{indicators.map(([name,description,frequency,owner],index)=><article key={name}><span><FIcon name={index<3?"payable":index<6?"chart":"report"}/></span><div><b>{name}</b><small>{description}</small></div><Status tone={frequency==="Diário"?"success":frequency==="Semanal"?"info":"attention"}>{frequency}</Status><em>{owner}</em></article>)}</div></Card>}
    {tab==="Evidências"&&<Card className="finance-evidence-panel"><div className="finance-homologation-head"><div><p className="eyebrow">TRILHA DE DECISÃO</p><h2>Evidências da homologação</h2><p>Registros demonstrativos que alimentarão a auditoria central.</p></div><Button onClick={saveEvidence}><FIcon name="plus"/> Registrar evidência</Button></div>{[["Cenário de contas a pagar","Cadastro, aprovação e pagamento executados","Financeiro · hoje"],["Cenário de contas a receber","Recebimento integral e baixa confirmados","Financeiro · hoje"],["Conciliação bancária","Pendência tratada e saldo reconciliado","Tesouraria · hoje"],["Teste de credenciais","Gestor sem acesso ao Financeiro","Administrador · hoje"],["Revisão de indicadores","Dashboard e relatórios apresentados","Diretoria · pendente"]].map(([title,description,meta],index)=><section key={title}><span className={index<4?"done":""}>{index<4?"✓":"!"}</span><span><b>{title}</b><small>{description}</small></span><small>{meta}</small><Status tone={index<4?"success":"attention"}>{index<4?"Registrada":"Aguardando"}</Status></section>)}</Card>}
    <div className={released?"finance-homologation-release released":"finance-homologation-release"}><span><FIcon name="check"/></span><div><b>{released?"Financeiro funcionalmente homologado":"Decisão final de homologação"}</b><small>{released?"O módulo demonstrativo está encerrado e pronto para a etapa de persistência.":done===values.length?"Todos os critérios foram validados. Registre agora a decisão final.":`Conclua os ${values.length-done} critérios pendentes para habilitar o aceite.`}</small></div><Button disabled={done!==values.length||released} onClick={release}>{released?"Homologado":"Homologar versão"}</Button></div>
  </>;
}

function EntryForm({kind,onClose,onSave}:{kind:"payable"|"receivable";onClose:()=>void;onSave:(entry:Omit<Payable,"id">|Omit<Receivable,"id">)=>void}){const[party,setParty]=useState("");const[document,setDocument]=useState("");const[value,setValue]=useState("");const[due,setDue]=useState("2026-07-31");const[category,setCategory]=useState("");const[costCenter,setCostCenter]=useState("Administrativo");const submit=(e:React.FormEvent)=>{e.preventDefault();const numeric=Number(value.replace(/[^0-9,]/g,"").replace(",","."));if(!party||!document||!numeric)return;if(kind==="payable")onSave({supplier:party,document,category:category||"Outras despesas",costCenter,due,value:numeric,status:"Pendente"});else onSave({customer:party,document,category:category||"Outras receitas",due,value:numeric,received:0,status:"Em aberto"})};return <div className="finance-layer" onMouseDown={onClose}><form onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><header><div><p className="eyebrow">FINANCEIRO · NOVO LANÇAMENTO</p><h2>{kind==="payable"?"Nova conta a pagar":"Nova conta a receber"}</h2><p>Registre um título demonstrativo para o fluxo financeiro.</p></div><button type="button" onClick={onClose}><FIcon name="close"/></button></header><div className="finance-form-fields"><label><span>{kind==="payable"?"Fornecedor":"Cliente"} *</span><input value={party} onChange={e=>setParty(e.target.value)}/></label><label><span>Documento *</span><input value={document} onChange={e=>setDocument(e.target.value)} placeholder="Ex.: NF 12345"/></label><label><span>Categoria</span><input value={category} onChange={e=>setCategory(e.target.value)}/></label>{kind==="payable"&&<label><span>Centro de custo</span><select value={costCenter} onChange={e=>setCostCenter(e.target.value)}><option>Administrativo</option><option>Produção</option><option>Manutenção</option><option>Qualidade</option><option>Logística</option></select></label>}<label><span>Vencimento *</span><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label><span>Valor *</span><input value={value} onChange={e=>setValue(e.target.value)} placeholder="0,00" inputMode="decimal"/></label></div><footer><button type="button" onClick={onClose}>Cancelar</button><Button type="submit">Salvar lançamento</Button></footer></form></div>}
function Detail({item,onClose}:{item:Payable|Receivable;onClose:()=>void}){const isPayable="supplier" in item;return <div className="finance-layer" onMouseDown={onClose}><Card className="finance-detail" onMouseDown={e=>e.stopPropagation()}><header><div><p className="eyebrow">DETALHE DO TÍTULO</p><h2>{isPayable?item.supplier:item.customer}</h2><p>{item.document}</p></div><button onClick={onClose}><FIcon name="close"/></button></header><dl><div><dt>Natureza</dt><dd>{isPayable?"Conta a pagar":"Conta a receber"}</dd></div><div><dt>Categoria</dt><dd>{item.category}</dd></div><div><dt>Vencimento</dt><dd>{date(item.due)}</dd></div><div><dt>Valor</dt><dd>{money(item.value)}</dd></div><div><dt>Situação</dt><dd><Status tone={tone(item.status)}>{item.status}</Status></dd></div></dl><Callout variant="info" title="Registro demonstrativo">Documentos, histórico e auditoria serão persistidos quando o Supabase estiver conectado.</Callout></Card></div>}
function ReportDetail({title,onClose,canExport,track}:{title:string;onClose:()=>void;canExport:boolean;track:(m:string)=>void}){return <div className="finance-layer" onMouseDown={onClose}><Card className="finance-detail report" onMouseDown={e=>e.stopPropagation()}><header><div><p className="eyebrow">RELATÓRIO FINANCEIRO</p><h2>{title}</h2><p>Posição consolidada · Julho de 2026</p></div><button onClick={onClose}><FIcon name="close"/></button></header><div className="report-summary"><span><small>Saldo atual</small><b>R$ 842.350</b></span><span><small>Resultado projetado</small><b>R$ 126.840</b></span><span><small>Variação mensal</small><b>+8,4%</b></span></div><div className="report-placeholder"><FIcon name="chart"/><b>Visualização consolidada preparada</b><small>Exportação e dados reais serão ativados na etapa de persistência.</small></div>{canExport&&<footer><Button onClick={()=>track(`${title}: exportação demonstrativa concluída.`)}>Exportar demonstrativo</Button></footer>}</Card></div>}
