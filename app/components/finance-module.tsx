"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Kpi, KpiGrid, Segmented, Status } from "../../packages/design-system";
import { canUseFeature, type ModuleAccessContext } from "../../modules";
import type { FinanceSnapshot, FinanceTitle } from "../../lib/data/finance";
import { useModuleNav } from "../../lib/module-nav-context";
import { FinanceChart } from "./finance-chart";
import { FinancePainelGraficos } from "./finance-painel-graficos";
import { FinanceTitles } from "./finance-titles";
import { FinanceCashFlow, FinanceExpenseReport } from "./finance-reports";
import { situacaoRecebivel } from "../../lib/finance/recebiveis-core";

const sections = [
  ["Painel", "grid"], ["Contas a pagar", "payable"], ["Contas a receber", "receivable"],
  ["Fluxo de caixa", "chart"], ["Bancos e conciliação", "bank"], ["Centros de custo", "cost"],
  ["Plano de contas", "tree"],
  ["Relatórios", "report"], ["Homologação", "check"],
] as const;
type FinanceSection = (typeof sections)[number][0];
/** Funcionalidade que libera cada seção. O Painel aparece para quem tem o Financeiro. */
const SECTION_FEATURE: Partial<Record<FinanceSection, string>> = {
  "Contas a pagar": "financeiro.pagar",
  "Contas a receber": "financeiro.receber",
  "Fluxo de caixa": "financeiro.fluxo",
  "Bancos e conciliação": "financeiro.bancos",
  "Centros de custo": "financeiro.centros",
  // Plano de contas: todo mundo do Financeiro consulta (é a lista de contas dos
  // lançamentos); incluir, editar, mover e excluir exigem financeiro.plano (operar).
  "Relatórios": "financeiro.relatorios",
  "Homologação": "financeiro.homologacao",
};
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
  const received = title.installments.reduce((acc, i) => acc + (i.settledAmount || 0), 0);
  const situacao = situacaoRecebivel(title, hoje());
  return {
    id: title.id,
    customer: title.counterparty,
    document: title.documentNumber || "—",
    category: title.chartAccount || "Receita",
    due: title.installments[0]?.dueDate || title.issueDate,
    value: title.originalAmount,
    // Título quitado sem valor na parcela (baixa antiga) conta como recebido por inteiro.
    received: situacao === "Recebido" ? title.originalAmount : received,
    status: situacao === "Cancelado" ? "Recebido" : situacao === "Em aprovação" ? "Em aberto" : situacao,
  };
}

const initialHomologation:HomologationItem[]=[
  {id:"payables",title:"Contas a pagar",description:"Cadastro, vencimento, aprovação, pagamento e estorno",owner:"Financeiro",status:"Pendente"},
  {id:"receivables",title:"Contas a receber",description:"Recebimento, baixa parcial, atraso e cobrança",owner:"Financeiro",status:"Pendente"},
  {id:"approvals",title:"Alçadas de aprovação",description:"Limites por valor, função e substituição de aprovador",owner:"Diretoria",status:"Pendente"},
  {id:"accounts",title:"Plano de contas",description:"Categorias contábeis e classificação gerencial",owner:"Controladoria",status:"Pendente"},
  {id:"cost-centers",title:"Centros de custo",description:"Vínculo de despesas, orçamento e responsáveis",owner:"Controladoria",status:"Pendente"},
  {id:"banks",title:"Bancos e conciliação",description:"Importação, correspondência e tratamento de diferenças",owner:"Tesouraria",status:"Pendente"},
  {id:"reports",title:"Indicadores da diretoria",description:"Caixa, inadimplência, compromissos e variações",owner:"Diretoria",status:"Pendente"},
  {id:"access",title:"Perfis e auditoria",description:"Segregação de funções, escopo e trilha de ações",owner:"Administrador",status:"Pendente"},
];

const money=(value:number)=>value.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const moneyShort=(value:number)=>value>=1_000_000
  ? `R$ ${(value/1_000_000).toLocaleString("pt-BR",{maximumFractionDigits:1})} mi`
  : value>=1_000
    ? `R$ ${(value/1_000).toLocaleString("pt-BR",{maximumFractionDigits:0})} mil`
    : money(value);
const date=(value:string)=>/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10).split("-").reverse().join("/"):"—";
const hoje=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
const plural=(n:number,um:string,varios:string)=>`${n} ${n===1?um:varios}`;

function FIcon({name,size=18}:{name:string;size?:number}){const paths:Record<string,React.ReactNode>={grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,payable:<><path d="M4 5h16v14H4zM7 9h10M7 13h6"/><path d="m16 16 2 2 3-4"/></>,receivable:<><path d="M4 5h16v14H4zM7 9h10M7 13h6"/><path d="M18 12v6M15 15h6"/></>,chart:<><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></>,bank:<><path d="m3 9 9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/></>,cost:<><circle cx="12" cy="12" r="9"/><path d="M12 6v12M16 9c-1-2-7-2-7 1 0 3 7 1 7 5 0 3-6 3-8 1"/></>,report:<><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h6"/></>,check:<><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,back:<path d="m15 18-6-6 6-6"/>,plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="m9 18 6-6-6-6"/>,close:<path d="m6 6 12 12M18 6 6 18"/>,search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,alert:<><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></>};return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>}

export function FinanceModule({notify,onEvent,onExit,access,initialSection}:{notify:(message:string)=>void;onEvent:(message:string,module?:string)=>void;onExit:()=>void;access:ModuleAccessContext;initialSection?:string}){
  // Aviso "nova conta a pagar" abre direto em Contas a pagar.
  const [section,setSection]=useState<FinanceSection>(()=>sections.some(([label])=>label===initialSection)?initialSection as FinanceSection:"Painel");
  // Só dados do banco. Sem título, a lista fica vazia (nunca exemplo).
  const [payables,setPayables]=useState<Payable[]>([]);
  const [receivables,setReceivables]=useState<Receivable[]>([]);
  const [snapshot,setSnapshot]=useState<FinanceSnapshot|null>(null);
  const [modal,setModal]=useState<"payable"|"receivable"|"report"|null>(null);
  const [selected,setSelected]=useState<Payable|Receivable|null>(null);
  const [homologation,setHomologation]=useState(initialHomologation);
  const track=(message:string)=>{notify(message);onEvent(message,"Financeiro")};
  // Cada seção e cada botão saem da funcionalidade liberada ao usuário.
  const canCreatePayable=canUseFeature(access,"financeiro.pagar","operar");
  const canApprovePayable=canUseFeature(access,"financeiro.pagar","aprovar");
  const canCreateReceivable=canUseFeature(access,"financeiro.receber","operar");
  const canSettleReceivable=canUseFeature(access,"financeiro.receber","aprovar");
        const accessibleSections=useMemo(()=>sections.filter(([label])=>{
    const feature=SECTION_FEATURE[label];
    return !feature||canUseFeature(access,feature);
  }),[access]);
  const { registerNav } = useModuleNav();

  useEffect(() => {
    registerNav({
      moduleId: "financeiro",
      moduleName: "Financeiro",
      // Seções também no menu lateral, sob o Financeiro: a barra de cima rola e
      // esconde as últimas abas quando não cabem.
      sidebarTree: true,
      items: accessibleSections.map(([label, icon]) => ({ id: label, label, icon })),
      activeId: section,
      onSelect: (id) => setSection(id as FinanceSection),
    });
    return () => registerNav(null);
  }, [accessibleSections, section, registerNav]);

  // Seção aberta pelo menu lateral: a barra de cima rola até a aba ativa.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".ds-module-bar > .ds-segmented");
    const ativa = bar?.querySelector<HTMLElement>("button.active");
    if (bar && ativa) bar.scrollTo({ left: ativa.offsetLeft - (bar.clientWidth - ativa.offsetWidth) / 2, behavior: "smooth" });
  }, [section]);

  async function loadFinanceData(signal?: AbortSignal) {
    try {
      const res = await fetch("/api/finance", { cache: "no-store", signal });
      if (!res.ok) return;
      const data = (await res.json()) as FinanceSnapshot;
      if (data && Array.isArray(data.titles)) {
        setSnapshot(data);
        setPayables(data.titles.filter(t => t.direction === "payable" && !t.isForecast && !t.historical && t.status !== "cancelled").map(mapTitleToPayable));
        // Painel e fluxo de caixa usam só o que tem nota: previsão e cancelado ficam de fora.
        setReceivables(data.titles.filter(t => t.direction === "receivable" && !t.isForecast && !t.historical && t.status !== "cancelled").map(mapTitleToReceivable));
      }
    } catch {
      // Sem conexão: as listas ficam como estavam (vazias no início).
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
        track("Conta a pagar registrada.");
        await loadFinanceData();
        return;
      }
    } catch {
      // segue para o aviso de falha
    }
    track("Não foi possível salvar a conta a pagar. Nada foi gravado; confira sua permissão e tente de novo.");
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
        track("Conta a receber registrada.");
        await loadFinanceData();
        return;
      }
    } catch {
      // segue para o aviso de falha
    }
    track("Não foi possível salvar a conta a receber. Nada foi gravado; confira sua permissão e tente de novo.");
  }

  // Depois de qualquer alteração em título (baixa, edição, exclusão…): recarrega e avisa.
  const reloadAfter=async(message:string)=>{await loadFinanceData();track(message)};

  const render=()=>section==="Painel"?<Dashboard payables={payables} receivables={receivables} snapshot={snapshot} setSection={setSection} access={access}/>:section==="Contas a pagar"?<FinanceTitles key="payable" direction="payable" titles={(snapshot?.titles??[]).filter(t=>t.direction==="payable")} accounts={snapshot?.chartAccounts??[]} onChanged={reloadAfter} canCreate={canCreatePayable} canSettle={canApprovePayable} openCreate={()=>setModal("payable")}/>:section==="Contas a receber"?<FinanceTitles key="receivable" direction="receivable" titles={(snapshot?.titles??[]).filter(t=>t.direction==="receivable")} accounts={snapshot?.chartAccounts??[]} onChanged={reloadAfter} canCreate={canCreateReceivable} canSettle={canSettleReceivable} openCreate={()=>setModal("receivable")}/>:section==="Fluxo de caixa"?<FinanceCashFlow/>:section==="Bancos e conciliação"?<Banks accounts={snapshot?.bankAccounts??[]} unreconciled={snapshot?.summary.unreconciledEntries??0}/>:section==="Centros de custo"?<CostCenters centers={snapshot?.costCenters??[]} payables={payables}/>:section==="Plano de contas"?<FinanceChart notify={track}/>:section==="Relatórios"?<Reports canExpense={canUseFeature(access,"financeiro.relatorios")} open={(title)=>{setSelected({id:0,customer:title,document:"",category:"",due:"",value:0,received:0,status:"Em aberto"});setModal("report")}}/>:<Homologation values={homologation} setValues={setHomologation} track={track}/>;
  const isOwner = access.isOwner;

  return <div className="finance-module">
    <div className="ds-module-bar">
      {isOwner && <Button variant="secondary" compact onClick={onExit}><FIcon name="back"/> Ecossistema</Button>}
      <Segmented options={accessibleSections.map(([label])=>label)} value={section} onChange={setSection} ariaLabel="Seções do módulo Financeiro"/>
      <Status tone="info">{access.scopeLabel}</Status>
    </div>
    <main className="finance-workspace">{render()}</main>
    {modal==="payable"&&<EntryForm kind="payable" centers={snapshot?.costCenters??[]} accounts={snapshot?.chartAccounts??[]} onClose={()=>setModal(null)} onSave={(entry)=>{void handleSavePayable(entry as Omit<Payable,"id">);setModal(null)}}/>}{modal==="receivable"&&<EntryForm kind="receivable" centers={snapshot?.costCenters??[]} accounts={snapshot?.chartAccounts??[]} onClose={()=>setModal(null)} onSave={(entry)=>{void handleSaveReceivable(entry as Omit<Receivable,"id">);setModal(null)}}/>}{modal==="report"&&<ReportDetail title={(selected as Receivable)?.customer??"Relatório financeiro"} snapshot={snapshot} payables={payables} receivables={receivables} onClose={()=>{setModal(null);setSelected(null)}}/>}</div>
}

function Header({eyebrow,title,description,action,onAction}:{eyebrow:string;title:string;description:string;action?:string;onAction?:()=>void}){return <div className="finance-page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action&&<Button onClick={onAction}><FIcon name="plus"/> {action}</Button>}</div>}
/** Cartão de indicador do módulo. Delega ao KPI do Design System — nenhum
 *  módulo desenha o próprio cartão de número. */
function Metric({value,label,meta,toneName}:{value:string;label:string;meta:string;toneName:"blue"|"green"|"amber"|"red"|"purple"|"teal"}){
  return <Kpi label={label} caption={meta} value={value} tone={toneName}/>;
}
function Dashboard({payables,receivables,snapshot,setSection,access}:{payables:Payable[];receivables:Receivable[];snapshot:FinanceSnapshot|null;setSection:(v:FinanceSection)=>void;access:ModuleAccessContext}){
  const payableOpen=payables.filter(x=>x.status!=="Pago").reduce((a,b)=>a+b.value,0);
  const receiveOpen=receivables.reduce((a,b)=>a+b.value-b.received,0);
  const banks=snapshot?.bankAccounts.length??0;
  const balance=snapshot?.summary.availableBalance??0;
  const today=hoje();
  const vencidosPagar=payables.filter(x=>x.status!=="Pago"&&x.due&&x.due<today);
  const vencidosReceber=receivables.filter(x=>x.status!=="Recebido"&&x.due&&x.due<today);
  // Pendências de verdade: títulos vencidos, aprovações e conciliação.
  const pendencias:[string,string,FinanceSection,"payable"|"receivable"|"bank"][]=[
    ...(vencidosPagar.length>3?[[`${vencidosPagar.length} contas a pagar vencidas`,`${money(vencidosPagar.reduce((a,x)=>a+x.value,0))} · a mais antiga venceu em ${date(vencidosPagar.map(x=>x.due).sort()[0])}`,"Contas a pagar","payable"] as [string,string,FinanceSection,"payable"]]:vencidosPagar.map(x=>[`Pagamento vencido · ${x.supplier}`,`${money(x.value)} · venceu em ${date(x.due)}`,"Contas a pagar","payable"] as [string,string,FinanceSection,"payable"])),
    ...(vencidosReceber.length>3?[[`${vencidosReceber.length} títulos a receber vencidos`,`${money(vencidosReceber.reduce((a,x)=>a+x.value-x.received,0))} · o mais antigo venceu em ${date(vencidosReceber.map(x=>x.due).sort()[0])}`,"Contas a receber","receivable"] as [string,string,FinanceSection,"receivable"]]:vencidosReceber.map(x=>[`Título vencido · ${x.customer}`,`${money(x.value-x.received)} · venceu em ${date(x.due)}`,"Contas a receber","receivable"] as [string,string,FinanceSection,"receivable"])),
    // Histórico do sistema antigo à espera de conferência (fora dos totais acima).
    ...(["payable","receivable"] as const).flatMap(dir=>{const lista=(snapshot?.titles??[]).filter(t=>t.direction===dir&&t.historical);return lista.length?[[`${plural(lista.length,"título antigo","títulos antigos")} a conferir · ${dir==="payable"?"a pagar":"a receber"}`,`${money(lista.reduce((acc,t)=>acc+t.originalAmount,0))} · em aberto no sistema antigo antes de 2026, fora dos totais · aba Histórico a conferir`,dir==="payable"?"Contas a pagar":"Contas a receber",dir] as [string,string,FinanceSection,"payable"|"receivable"]]:[]}),
    ...((snapshot?.summary.pendingApprovals??0)>0?[["Aprovações pendentes",plural(snapshot!.summary.pendingApprovals,"título aguardando","títulos aguardando"),"Contas a pagar","payable"] as [string,string,FinanceSection,"payable"]]:[]),
    ...((snapshot?.summary.unreconciledEntries??0)>0?[["Conciliação bancária",plural(snapshot!.summary.unreconciledEntries,"lançamento sem correspondência","lançamentos sem correspondência"),"Bancos e conciliação","bank"] as [string,string,FinanceSection,"bank"]]:[]),
  ];
  return <><Header eyebrow={`FINANCEIRO · ${access.role.toUpperCase()}`} title="Visão financeira" description={`Caixa, compromissos e recebíveis autorizados para ${access.scopeLabel.toLowerCase()}.`}/>
    <KpiGrid>
      <Metric value={banks?moneyShort(balance):"—"} label="Saldo disponível" meta={banks?plural(banks,"conta bancária","contas bancárias"):"Nenhuma conta bancária cadastrada"} toneName="blue"/>
      <Metric value={moneyShort(receiveOpen)} label="A receber" meta={`${plural(receivables.filter(x=>x.status!=="Recebido").length,"título em aberto","títulos em aberto")}${(snapshot?.summary.receivableForecast??0)>0?` · previsões à parte: ${moneyShort(snapshot!.summary.receivableForecast)}`:""}`} toneName="green"/>
      <Metric value={moneyShort(payableOpen)} label="A pagar" meta={`${plural(payables.filter(x=>x.status!=="Pago").length,"título em aberto","títulos em aberto")}${(snapshot?.summary.payableForecast??0)>0?` · previsões à parte: ${moneyShort(snapshot!.summary.payableForecast)}`:""}`} toneName="amber"/>
      <Metric value={banks?moneyShort(balance+receiveOpen-payableOpen):moneyShort(receiveOpen-payableOpen)} label="Saldo projetado" meta={banks?"Saldo + a receber − a pagar":"A receber − a pagar"} toneName="purple"/>
    </KpiGrid>
    <FinancePainelGraficos receiveOpen={receiveOpen} payableOpen={payableOpen} podeFluxo={canUseFeature(access,"financeiro.fluxo")||canUseFeature(access,"financeiro.relatorios")} abrirFluxo={()=>setSection("Fluxo de caixa")}/>
      <Card className="finance-pending fin-pendencias"><div className="finance-card-head"><div><p className="eyebrow">CENTRAL FINANCEIRA</p><h2>Ações que exigem atenção</h2><p>Compromissos, cobranças e conciliações pendentes.</p></div><Status tone={pendencias.length?"attention":"success"}>{pendencias.length?plural(pendencias.length,"pendência","pendências"):"Sem pendências"}</Status></div>
        {pendencias.slice(0,6).map(([title,meta,target,icon])=><button key={title+meta} onClick={()=>setSection(target)}><span><FIcon name={icon}/></span><span><b>{title}</b><small>{meta}</small></span><Status tone={icon==="bank"?"attention":"danger"}>{icon==="bank"?"Conferir":"Prioridade"}</Status><FIcon name="arrow"/></button>)}
        {!pendencias.length&&<div className="finance-empty"><b>Nenhuma pendência</b><small>Títulos vencidos, aprovações e conciliações aparecem aqui.</small></div>}
      </Card>
    </>}
function Banks({accounts,unreconciled}:{accounts:FinanceSnapshot["bankAccounts"];unreconciled:number}){
  return <><Header eyebrow="FINANCEIRO · BANCOS" title="Bancos e conciliação" description="Contas bancárias da empresa e conciliação com os lançamentos."/>
    {accounts.length?<div className="bank-grid">{accounts.map(x=><Card key={x.id} className="bank-card"><span><FIcon name="bank"/></span><Status tone={x.active?"success":"neutral"}>{x.active?"Ativa":"Inativa"}</Status><h2>{x.name}</h2><p>Agência {x.branch} · Conta {x.accountNumber}</p><strong>{money(x.balance)}</strong><small>Saldo inicial cadastrado</small></Card>)}</div>
    :<Card className="finance-empty-card"><div className="finance-empty"><b>Nenhuma conta bancária cadastrada</b><small>As contas bancárias da empresa entram aqui na implantação do Financeiro, com o saldo de abertura.</small></div></Card>}
    {unreconciled>0&&<Callout variant="warning" title="Conciliação pendente">{plural(unreconciled,"lançamento do extrato ainda não tem correspondência","lançamentos do extrato ainda não têm correspondência")}.</Callout>}
  </>}
function CostCenters({centers,payables}:{centers:FinanceSnapshot["costCenters"];payables:Payable[]}){
  const total=payables.reduce((a,b)=>a+b.value,0)||1;
  return <><Header eyebrow="FINANCEIRO · CLASSIFICAÇÃO" title="Centros de custo" description="Despesas lançadas por centro de custo."/>
    {centers.length?<div className="cost-grid">{centers.map(c=>{const value=payables.filter(x=>x.costCenter===c.name).reduce((a,b)=>a+b.value,0);const share=`${Math.round(value/total*100)}%`;return <Card key={c.id}><span><FIcon name="cost"/></span>{c.code&&<Status>{c.code}</Status>}<h2>{c.name}</h2><strong>{money(value)}</strong><small>Contas a pagar lançadas · {share} do total</small><div><i style={{width:share}}/></div></Card>})}</div>
    :<Card className="finance-empty-card"><div className="finance-empty"><b>Nenhum centro de custo cadastrado</b><small>Os centros de custo entram junto com o plano de contas da PecSil (decisão D1 do plano de custo e margem).</small></div></Card>}
  </>}
function Reports({open,canExpense}:{open:(title:string)=>void;canExpense:boolean}){
  const [expense,setExpense]=useState(false);
  const reports=[["Posição financeira","Saldos, compromissos e disponibilidades atuais."],["Contas a pagar por vencimento","Agenda financeira e exposição por fornecedor."],["Contas a receber e inadimplência","Recebíveis, atrasos e recuperação de crédito."],["Fluxo de caixa projetado","Entradas e saídas previstas pelos vencimentos."],["Despesas por centro de custo","Realizado por área."],["Conciliação bancária","Correspondências e pendências por conta."]];
  if(expense)return <FinanceExpenseReport onBack={()=>setExpense(false)}/>;
  return <><Header eyebrow="FINANCEIRO · INTELIGÊNCIA" title="Relatórios financeiros" description="Indicadores calculados a partir dos títulos e contas lançados."/><div className="finance-report-grid">
    {canExpense&&<Card><span><FIcon name="report"/></span><h2>Gasto por conta do plano</h2><p>Custos, despesas e investimentos mês a mês, pelo rateio das contas a pagar.</p><button onClick={()=>setExpense(true)}>Abrir relatório <FIcon name="arrow"/></button></Card>}
    {reports.map(([title,desc])=><Card key={title}><span><FIcon name="report"/></span><h2>{title}</h2><p>{desc}</p><button onClick={()=>open(title)}>Abrir relatório <FIcon name="arrow"/></button></Card>)}</div></>}
function Homologation({values,setValues,track}:{values:HomologationItem[];setValues:React.Dispatch<React.SetStateAction<HomologationItem[]>>;track:(m:string)=>void}){
  const [tab,setTab]=useState<"Critérios"|"Alçadas"|"Plano de contas"|"Indicadores"|"Evidências">("Critérios");
  const [evidenceCount,setEvidenceCount]=useState(0);
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
    {tab==="Evidências"&&<Card className="finance-evidence-panel"><div className="finance-homologation-head"><div><p className="eyebrow">TRILHA DE DECISÃO</p><h2>Evidências da homologação</h2><p>Registros demonstrativos que alimentarão a auditoria central.</p></div><Button onClick={saveEvidence}><FIcon name="plus"/> Registrar evidência</Button></div>{evidenceCount?<div className="finance-empty"><b>{plural(evidenceCount,"evidência registrada nesta sessão","evidências registradas nesta sessão")}</b><small>As evidências ainda não são gravadas no banco.</small></div>:<div className="finance-empty"><b>Nenhuma evidência registrada</b><small>Cenários testados e decisões da homologação aparecem aqui.</small></div>}</Card>}
    <div className={released?"finance-homologation-release released":"finance-homologation-release"}><span><FIcon name="check"/></span><div><b>{released?"Financeiro funcionalmente homologado":"Decisão final de homologação"}</b><small>{released?"O módulo demonstrativo está encerrado e pronto para a etapa de persistência.":done===values.length?"Todos os critérios foram validados. Registre agora a decisão final.":`Conclua os ${values.length-done} critérios pendentes para habilitar o aceite.`}</small></div><Button disabled={done!==values.length||released} onClick={release}>{released?"Homologado":"Homologar versão"}</Button></div>
  </>;
}

function EntryForm({kind,centers,accounts,onClose,onSave}:{kind:"payable"|"receivable";centers:FinanceSnapshot["costCenters"];accounts:FinanceSnapshot["chartAccounts"];onClose:()=>void;onSave:(entry:Omit<Payable,"id">|Omit<Receivable,"id">)=>void}){const[party,setParty]=useState("");const[document,setDocument]=useState("");const[value,setValue]=useState("");const[due,setDue]=useState(hoje);const[category,setCategory]=useState("");const[costCenter,setCostCenter]=useState(centers[0]?.name??"");const postable=accounts.filter(a=>a.allowsPosting);const submit=(e:React.FormEvent)=>{e.preventDefault();const numeric=Number(value.replace(/[^0-9,]/g,"").replace(",","."));if(!party||!document||!numeric)return;if(kind==="payable")onSave({supplier:party,document,category:category||"Outras despesas",costCenter,due,value:numeric,status:"Pendente"});else onSave({customer:party,document,category:category||"Outras receitas",due,value:numeric,received:0,status:"Em aberto"})};return <div className="finance-layer"><form onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><header><div><p className="eyebrow">FINANCEIRO · NOVO LANÇAMENTO</p><h2>{kind==="payable"?"Nova conta a pagar":"Nova conta a receber"}</h2><p>Registre o título com o documento e o vencimento.</p></div><button type="button" onClick={onClose}><FIcon name="close"/></button></header><div className="finance-form-fields"><label><span>{kind==="payable"?"Fornecedor":"Cliente"} *</span><input value={party} onChange={e=>setParty(e.target.value)}/></label><label><span>Documento *</span><input value={document} onChange={e=>setDocument(e.target.value)} placeholder="Ex.: NF 12345"/></label><label><span>Categoria</span>{postable.length?<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Selecione a conta</option>{postable.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>:<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Plano de contas ainda não cadastrado"/>}</label>{kind==="payable"&&<label><span>Centro de custo</span>{centers.length?<select value={costCenter} onChange={e=>setCostCenter(e.target.value)}>{centers.map(c=><option key={c.id} value={c.name}>{c.code?`${c.code} · `:""}{c.name}</option>)}</select>:<div className="finance-readonly">Nenhum centro de custo cadastrado</div>}</label>}<label><span>Vencimento *</span><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label><span>Valor *</span><input value={value} onChange={e=>setValue(e.target.value)} placeholder="0,00" inputMode="decimal"/></label></div><footer><button type="button" onClick={onClose}>Cancelar</button><Button type="submit">Salvar lançamento</Button></footer></form></div>}
function ReportDetail({title,snapshot,payables,receivables,onClose}:{title:string;snapshot:FinanceSnapshot|null;payables:Payable[];receivables:Receivable[];onClose:()=>void}){const payableOpen=payables.filter(x=>x.status!=="Pago").reduce((a,b)=>a+b.value,0);const receiveOpen=receivables.reduce((a,b)=>a+b.value-b.received,0);const banks=snapshot?.bankAccounts.length??0;return <div className="finance-layer"><Card className="finance-detail report" onMouseDown={e=>e.stopPropagation()}><header><div><p className="eyebrow">RELATÓRIO FINANCEIRO</p><h2>{title}</h2><p>Posição em {date(hoje())}</p></div><button onClick={onClose}><FIcon name="close"/></button></header><div className="report-summary"><span><small>Saldo disponível</small><b>{banks?money(snapshot!.summary.availableBalance):"Sem conta bancária"}</b></span><span><small>A receber em aberto</small><b>{money(receiveOpen)}</b></span><span><small>A pagar em aberto</small><b>{money(payableOpen)}</b></span></div><div className="report-placeholder"><FIcon name="chart"/><b>Relatório detalhado ainda não disponível</b><small>Os números acima já são dos títulos e contas lançados. O detalhamento e a exportação entram numa próxima etapa.</small></div></Card></div>}
