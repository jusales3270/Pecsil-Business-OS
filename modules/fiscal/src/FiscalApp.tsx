"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { useModuleNav } from "../../../lib/module-nav-context";
import type { Nfe } from "../../../lib/almoxarifado/nfe-xml";
import type { ModuleRuntimeProps } from "../../runtime";

/**
 * Módulo Fiscal — Painel do ICMS. Substitui a planilha mensal: uma linha por
 * nota de entrada, com centro (F/U/RS) e situação (XML/LACTO/AUT), o crédito
 * de ICMS e o IPI do mês e o livro de apuração. As notas recebidas no
 * Almoxarifado entram sozinhas; as do administrativo e de terceiros, aqui.
 */

type Entrada = {
  id: string; competencia: string; emitida: string | null; recebida: string | null; fornecedor: string; fantasia: string | null;
  cnpj: string | null; nfe: string | null; serie: string | null; chave: string | null;
  valor: number; vlr_cobrado: number; base_icms: number; icms: number; ipi: number; tipo: string | null;
  fundicao: boolean; usinagem: boolean; administrativo: boolean; xml_ok: boolean; lancado: boolean; autorizado: boolean;
  obs: string | null; origem: "almoxarifado" | "manual" | "historico"; created_by_name: string | null;
};
type Linha = { id: string; ordem: number; descricao: string; credito: number; debito: number; saldo: number | null };
type Dados = { mes: string; canEdit: boolean; meses: string[]; entradas: Entrada[]; livro: Linha[] };

type FiltroCentro = "todos" | "fundicao" | "usinagem" | "administrativo" | "sem";
type FiltroSituacao = "todas" | "sem_xml" | "nao_lancada" | "nao_autorizada";
const TIPOS = ["Material", "Uso e consumo", "Serviço", "Ativo imobilizado", "Frete", "Energia", "Outros"];
const ORIGEM: Record<Entrada["origem"], string> = { almoxarifado: "Almoxarifado", manual: "Lançada aqui", historico: "Planilha antiga" };

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const curto = (v: number) => (Math.abs(v) >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : Math.abs(v) >= 10_000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : money(v));
const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
const num = (t: string) => { const s = t.trim().replace(/[R$\s]/g, ""); return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0; };
const campo = (v: number) => (v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch { return { ok: false, error: "Sem conexão com o servidor." }; }
}

export default function FiscalApp({ notify }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [centro, setCentro] = useState<FiltroCentro>("todos");
  const [situacao, setSituacao] = useState<FiltroSituacao>("todas");
  const [busca, setBusca] = useState("");
  const [editar, setEditar] = useState<Entrada | "nova" | null>(null);

  const carregar = useCallback(async (alvo: string) => {
    const res = await api<Dados>(`/api/fiscal/icms?mes=${alvo}`);
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setDados({ ...res.data, entradas: res.data.entradas.map((e) => ({ ...e, valor: Number(e.valor), vlr_cobrado: Number(e.vlr_cobrado), base_icms: Number(e.base_icms), icms: Number(e.icms), ipi: Number(e.ipi) })), livro: res.data.livro.map((l) => ({ ...l, credito: Number(l.credito), debito: Number(l.debito) })) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(mes); }, 0); return () => clearTimeout(t); }, [carregar, mes]);

  useEffect(() => {
    registerNav({ moduleId: "fiscal", moduleName: "Fiscal", sidebarTree: true, items: [{ id: "icms", label: "Painel do ICMS", icon: "file" }], activeId: "icms", onSelect: () => {} });
  }, [registerNav]);
  useEffect(() => () => registerNav(null), [registerNav]);

  const atual = dados?.mes === mes ? dados : null;
  const podeEditar = Boolean(atual?.canEdit);
  const entradas = useMemo(() => atual?.entradas ?? [], [atual]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return entradas.filter((e) => {
      if (centro === "sem" && (e.fundicao || e.usinagem || e.administrativo)) return false;
      if (centro !== "todos" && centro !== "sem" && !e[centro]) return false;
      if (situacao === "sem_xml" && e.xml_ok) return false;
      if (situacao === "nao_lancada" && e.lancado) return false;
      if (situacao === "nao_autorizada" && e.autorizado) return false;
      return !termo || [e.fornecedor, e.fantasia, e.nfe, e.tipo, e.obs].some((v) => (v ?? "").toLowerCase().includes(termo));
    });
  }, [entradas, centro, situacao, busca]);

  const soma = (lista: Entrada[], k: "valor" | "icms" | "ipi") => lista.reduce((a, e) => a + e[k], 0);
  const porCentro = (["fundicao", "usinagem", "administrativo"] as const).map((c) => ({ c, lista: entradas.filter((e) => e[c]) }));
  const pendentes = entradas.filter((e) => !e.xml_ok || !e.lancado || !e.autorizado).length;

  const alternar = async (e: Entrada, chave: "fundicao" | "usinagem" | "administrativo" | "xml_ok" | "lancado" | "autorizado") => {
    if (!podeEditar) return;
    const corpo = { fundicao: "fundicao", usinagem: "usinagem", administrativo: "administrativo", xml_ok: "xmlOk", lancado: "lancado", autorizado: "autorizado" }[chave];
    setDados((d) => d && { ...d, entradas: d.entradas.map((x) => (x.id === e.id ? { ...x, [chave]: !x[chave] } : x)) });
    const res = await api(`/api/fiscal/icms/${e.id}`, { method: "PATCH", body: JSON.stringify({ [corpo]: !e[chave] }) });
    if (!res.ok) { notify(res.error); void carregar(mes); }
  };

  const marca = (e: Entrada, chave: "fundicao" | "usinagem" | "administrativo" | "xml_ok" | "lancado" | "autorizado", rotulo: string) => (
    <button type="button" className={`icms-marca${e[chave] ? " on" : ""}`} onClick={() => void alternar(e, chave)} disabled={!podeEditar} aria-pressed={e[chave]} title={rotulo}>{e[chave] ? "✓" : ""}</button>
  );

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · ICMS</p><h1>Painel do ICMS</h1><p>Notas de entrada de {nomeMes(mes)}: crédito de ICMS, IPI por centro e o livro de apuração. As notas recebidas no Almoxarifado entram sozinhas.</p></div>
        <div className="icms-acoes">
          <label className="almox-mes"><span>Mês</span><input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>
          {podeEditar && <Button onClick={() => setEditar("nova")}>+ Nova nota</Button>}
        </div>
      </div>

      {atual && !atual.canEdit && <Callout variant="info" title="Só leitura">Você acompanha o painel. Lançar e marcar notas é de quem opera o Fiscal.</Callout>}
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!atual && !erro && <div className="finance-empty almox-vazio"><small>Carregando {nomeMes(mes)}…</small></div>}

      {atual && (
        <>
          <KpiGrid>
            <Kpi label="Notas no mês" value={String(entradas.length)} caption={curto(soma(entradas, "valor"))} tone="blue" />
            <Kpi label="Crédito de ICMS" value={curto(soma(entradas, "icms"))} caption={`Base ${curto(entradas.reduce((a, e) => a + e.base_icms, 0))}`} tone="green" />
            <Kpi label="IPI" value={curto(soma(entradas, "ipi"))} caption="Destacado nas notas" tone="amber" />
            <Kpi label="Pendentes" value={String(pendentes)} caption="Sem XML, lançamento ou autorização" tone={pendentes ? "red" : "neutral"} onOpen={() => setSituacao("nao_autorizada")} />
          </KpiGrid>

          <section className="almox-bloco">
            <div className="icms-centros">
              {porCentro.map(({ c, lista }) => (
                <div key={c}><small>{c === "fundicao" ? "Fundição (F)" : c === "usinagem" ? "Usinagem (U)" : "Administrativo (RS)"}</small><b>{money(soma(lista, "icms"))}</b><span>{lista.length} {lista.length === 1 ? "nota" : "notas"} · {curto(soma(lista, "valor"))}</span></div>
              ))}
            </div>
          </section>

          <div className="almox-filtros">
            <Segmented<FiltroCentro> options={[{ value: "todos", label: "Todos" }, { value: "fundicao", label: "Fundição" }, { value: "usinagem", label: "Usinagem" }, { value: "administrativo", label: "Administrativo" }, { value: "sem", label: "Sem centro" }]} value={centro} onChange={setCentro} ariaLabel="Centro" compact />
            <select className="icms-select" value={situacao} onChange={(e) => setSituacao(e.target.value as FiltroSituacao)} aria-label="Situação">
              <option value="todas">Todas as situações</option><option value="sem_xml">Sem XML</option><option value="nao_lancada">Não lançadas</option><option value="nao_autorizada">Não autorizadas</option>
            </select>
            <input className="almox-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, NF, tipo ou obs." aria-label="Buscar nota" />
          </div>

          <section className="almox-bloco">
            {visiveis.length ? (
              <div className="icms-tabela" role="table">
                <div className="cabeca" role="row">
                  <span>Recebida</span><span>Fornecedor</span><span>NF-e</span><span className="r">Valor</span><span className="r">ICMS</span><span className="r">IPI</span><span>Tipo</span>
                  <span className="c" title="Fundição">F</span><span className="c" title="Usinagem">U</span><span className="c" title="Administrativo">RS</span>
                  <span className="c">XML</span><span className="c" title="Lançada">LACTO</span><span className="c" title="Autorizada">AUT</span><span />
                </div>
                {visiveis.map((e) => (
                  <div role="row" key={e.id}>
                    <span>{date(e.recebida)}</span>
                    <span className="nome" title={e.fornecedor}>{e.fantasia || e.fornecedor}<small>{ORIGEM[e.origem]}{e.obs ? ` · ${e.obs}` : ""}</small></span>
                    <span>{e.nfe ?? "—"}</span>
                    <span className="r">{money(e.valor)}</span>
                    <span className="r">{money(e.icms)}</span>
                    <span className="r">{money(e.ipi)}</span>
                    <span>{e.tipo ?? "—"}</span>
                    <span className="c">{marca(e, "fundicao", "Fundição")}</span><span className="c">{marca(e, "usinagem", "Usinagem")}</span><span className="c">{marca(e, "administrativo", "Administrativo")}</span>
                    <span className="c">{marca(e, "xml_ok", "XML")}</span><span className="c">{marca(e, "lancado", "Lançada")}</span><span className="c">{marca(e, "autorizado", "Autorizada")}</span>
                    <span className="c">{podeEditar && <button type="button" className="almox-link" onClick={() => setEditar(e)}>editar</button>}</span>
                  </div>
                ))}
                <div role="row" className="total">
                  <span /><span>{visiveis.length} {visiveis.length === 1 ? "nota" : "notas"}</span><span /><span className="r">{money(soma(visiveis, "valor"))}</span><span className="r">{money(soma(visiveis, "icms"))}</span><span className="r">{money(soma(visiveis, "ipi"))}</span>
                </div>
              </div>
            ) : <div className="finance-empty"><b>{entradas.length ? "Nenhuma nota neste filtro" : `Nenhuma nota em ${nomeMes(mes)}`}</b><small>{entradas.length ? "Troque o centro, a situação ou a busca." : "As notas recebidas no Almoxarifado aparecem aqui sozinhas; as demais, em \"Nova nota\"."}</small></div>}
          </section>

          <Livro mes={mes} linhas={atual.livro} podeEditar={podeEditar} onMudou={() => void carregar(mes)} notify={notify} />
        </>
      )}

      {editar && <NotaModal mes={mes} nota={editar === "nova" ? null : editar} onClose={() => setEditar(null)} onFeito={(msg) => { setEditar(null); notify(msg); void carregar(mes); }} />}
    </div>
  );
}

function Livro({ mes, linhas, podeEditar, onMudou, notify }: { mes: string; linhas: Linha[]; podeEditar: boolean; onMudou: () => void; notify: (m: string) => void }) {
  const [descricao, setDescricao] = useState("");
  const [credito, setCredito] = useState("");
  const [debito, setDebito] = useState("");
  // Saldo corrido: o gravado na linha (planilha antiga) ou crédito − débito acumulado.
  const comSaldo = linhas.reduce<(Linha & { corrido: number })[]>((acc, l) => {
    const anterior = acc.at(-1)?.corrido ?? 0;
    return [...acc, { ...l, corrido: l.saldo ?? anterior + l.credito - l.debito }];
  }, []);
  const saldo = comSaldo.at(-1)?.corrido ?? 0;
  const incluir = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!descricao.trim()) return;
    const res = await api("/api/fiscal/icms/livro", { method: "POST", body: JSON.stringify({ mes, descricao, credito: num(credito), debito: num(debito) }) });
    if (!res.ok) { notify(res.error); return; }
    setDescricao(""); setCredito(""); setDebito(""); onMudou();
  };
  const remover = async (id: string) => { const res = await api(`/api/fiscal/icms/livro/${id}`, { method: "DELETE" }); if (!res.ok) notify(res.error); onMudou(); };
  return (
    <section className="almox-bloco">
      <div className="almox-bloco-topo"><div><p className="eyebrow">APURAÇÃO</p><h2>Livro de apuração do mês</h2></div>{comSaldo.length > 0 && <Status tone={saldo >= 0 ? "success" : "danger"}>Saldo {money(comSaldo.at(-1)!.corrido)}</Status>}</div>
      {comSaldo.length ? (
        <div className="icms-livro" role="table">
          <div className="cabeca" role="row"><span>Descrição</span><span className="r">Crédito</span><span className="r">Débito</span><span className="r">Saldo</span><span /></div>
          {comSaldo.map((l) => (
            <div role="row" key={l.id}><span>{l.descricao}</span><span className="r">{money(l.credito)}</span><span className="r">{money(l.debito)}</span><span className="r"><b>{money(l.corrido)}</b></span>
              <span className="c">{podeEditar && <button type="button" className="almox-link perigo" onClick={() => void remover(l.id)}>remover</button>}</span></div>
          ))}
        </div>
      ) : <div className="finance-empty"><small>Nenhuma linha de apuração neste mês.</small></div>}
      {podeEditar && (
        <form className="icms-livro-form" onSubmit={incluir}>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (ex.: Saldo credor do mês anterior)" aria-label="Descrição" />
          <input value={credito} onChange={(e) => setCredito(e.target.value)} placeholder="Crédito" inputMode="decimal" aria-label="Crédito" />
          <input value={debito} onChange={(e) => setDebito(e.target.value)} placeholder="Débito" inputMode="decimal" aria-label="Débito" />
          <Button type="submit" variant="secondary" compact>Incluir linha</Button>
        </form>
      )}
    </section>
  );
}

function NotaModal({ mes, nota, onClose, onFeito }: { mes: string; nota: Entrada | null; onClose: () => void; onFeito: (msg: string) => void }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [f, setF] = useState(() => ({
    competencia: nota?.competencia?.slice(0, 7) ?? mes,
    emitida: nota?.emitida ?? "", recebida: nota?.recebida ?? hoje(),
    fornecedor: nota?.fornecedor ?? "", fantasia: nota?.fantasia ?? "", cnpj: nota?.cnpj ?? "",
    nfe: nota?.nfe ?? "", serie: nota?.serie ?? "", chave: nota?.chave ?? "",
    valor: campo(nota?.valor ?? 0), vlrCobrado: campo(nota?.vlr_cobrado ?? 0), baseIcms: campo(nota?.base_icms ?? 0), icms: campo(nota?.icms ?? 0), ipi: campo(nota?.ipi ?? 0),
    tipo: nota?.tipo ?? "Uso e consumo",
    fundicao: nota?.fundicao ?? false, usinagem: nota?.usinagem ?? false, administrativo: nota?.administrativo ?? !nota,
    xmlOk: nota?.xml_ok ?? false, lancado: nota?.lancado ?? false, autorizado: nota?.autorizado ?? false, obs: nota?.obs ?? "",
  }));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((a) => ({ ...a, [k]: v }));

  const lerXml = async (file: File | undefined) => {
    if (!file) return;
    setErro("");
    const res = await api<{ nfe: Nfe; jaNoIcms: boolean }>("/api/almoxarifado/nfe", { method: "POST", body: JSON.stringify({ xml: await file.text() }) });
    if (!res.ok) { setErro(res.error); return; }
    if (res.data.jaNoIcms) { setErro("Esta nota já está no painel (mesma chave de acesso)."); return; }
    const n = res.data.nfe;
    setF((a) => ({ ...a, emitida: n.emissao, fornecedor: n.emitente.nome, fantasia: n.emitente.fantasia, cnpj: n.emitente.cnpj, nfe: n.numero, serie: n.serie, chave: n.chave,
      valor: campo(n.valorNota), vlrCobrado: campo(n.valorNota), baseIcms: campo(n.baseIcms), icms: campo(n.icms), ipi: campo(n.ipi), xmlOk: true }));
  };

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!f.fornecedor.trim()) { setErro("Informe o fornecedor."); return; }
    setSalvando(true);
    const corpo = { ...f, valor: num(f.valor), vlrCobrado: num(f.vlrCobrado) || num(f.valor), baseIcms: num(f.baseIcms), icms: num(f.icms), ipi: num(f.ipi), emitida: f.emitida || null, recebida: f.recebida || null };
    const res = nota ? await api(`/api/fiscal/icms/${nota.id}`, { method: "PATCH", body: JSON.stringify(corpo) }) : await api("/api/fiscal/icms", { method: "POST", body: JSON.stringify(corpo) });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    onFeito(nota ? "Nota alterada." : "Nota incluída no painel.");
  };
  const excluir = async () => {
    if (!nota) return;
    setSalvando(true);
    const res = await api(`/api/fiscal/icms/${nota.id}`, { method: "DELETE" });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); setConfirmaExcluir(false); return; }
    onFeito("Nota excluída do painel.");
  };
  const veioDoRecebimento = nota?.origem === "almoxarifado";

  return (
    <Modal eyebrow="Fiscal · Painel do ICMS" title={nota ? `NF ${nota.nfe ?? "—"} · ${nota.fantasia || nota.fornecedor}` : "Nova nota de entrada"} subtitle={nota ? `${ORIGEM[nota.origem]}${nota.created_by_name ? ` por ${nota.created_by_name}` : ""}` : "Anexe o XML ou digite. Use para notas do administrativo, de terceiros e o que não passou pelo Almoxarifado."} onClose={onClose}>
      <form className="almox-form" onSubmit={salvar}>
        {!nota && (
          <div className="almox-arquivo">
            <input ref={arquivo} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => void lerXml(e.target.files?.[0])} />
            <button type="button" onClick={() => arquivo.current?.click()}><b>{f.chave ? "XML lido — conferir abaixo" : "Anexar o XML da NF-e (opcional)"}</b><small>Preenche fornecedor, número, valores, ICMS e IPI.</small></button>
          </div>
        )}
        {veioDoRecebimento && <Callout variant="info" title="Veio do recebimento">Os valores vêm da nota recebida no Almoxarifado. Aqui você ajusta centro, tipo, situação e observação.</Callout>}
        <div className="almox-campos">
          <label><span>Mês</span><input type="month" value={f.competencia} onChange={(e) => set("competencia", e.target.value)} /></label>
          <label><span>Emitida</span><input type="date" value={f.emitida} onChange={(e) => set("emitida", e.target.value)} readOnly={veioDoRecebimento} /></label>
          <label><span>Recebida</span><input type="date" value={f.recebida} onChange={(e) => set("recebida", e.target.value)} readOnly={veioDoRecebimento} /></label>
          <label><span>Tipo</span><select value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>{[...new Set([...TIPOS, f.tipo])].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="almox-largo"><span>Fornecedor *</span><input value={f.fornecedor} onChange={(e) => set("fornecedor", e.target.value)} readOnly={veioDoRecebimento} /></label>
          <label><span>Fantasia</span><input value={f.fantasia} onChange={(e) => set("fantasia", e.target.value)} /></label>
          <label><span>NF-e</span><input value={f.nfe} onChange={(e) => set("nfe", e.target.value)} readOnly={veioDoRecebimento} /></label>
          <label><span>Valor</span><input value={f.valor} onChange={(e) => set("valor", e.target.value)} inputMode="decimal" readOnly={veioDoRecebimento} /></label>
          <label><span>Valor cobrado</span><input value={f.vlrCobrado} onChange={(e) => set("vlrCobrado", e.target.value)} inputMode="decimal" /></label>
          <label><span>Base ICMS</span><input value={f.baseIcms} onChange={(e) => set("baseIcms", e.target.value)} inputMode="decimal" readOnly={veioDoRecebimento} /></label>
          <label><span>ICMS</span><input value={f.icms} onChange={(e) => set("icms", e.target.value)} inputMode="decimal" readOnly={veioDoRecebimento} /></label>
          <label><span>IPI</span><input value={f.ipi} onChange={(e) => set("ipi", e.target.value)} inputMode="decimal" readOnly={veioDoRecebimento} /></label>
        </div>
        <div className="icms-marcas-form">
          <span className="almox-rotulo">Centro</span>
          {([["fundicao", "Fundição (F)"], ["usinagem", "Usinagem (U)"], ["administrativo", "Administrativo (RS)"]] as const).map(([k, l]) => <label key={k} className="almox-marca"><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> <span>{l}</span></label>)}
          <span className="almox-rotulo">Situação</span>
          {([["xmlOk", "XML recebido"], ["lancado", "Lançada"], ["autorizado", "Autorizada"]] as const).map(([k, l]) => <label key={k} className="almox-marca"><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> <span>{l}</span></label>)}
        </div>
        <label className="almox-largo"><span>Observação</span><input value={f.obs} onChange={(e) => set("obs", e.target.value)} /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          {nota && !veioDoRecebimento && (confirmaExcluir
            ? <Button type="button" className="almox-perigo-cheio" onClick={() => void excluir()} disabled={salvando}>Confirmar exclusão</Button>
            : <Button type="button" variant="ghost" className="almox-perigo" onClick={() => setConfirmaExcluir(true)}>Excluir</Button>)}
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Gravando…" : nota ? "Salvar" : "Incluir nota"}</Button>
        </footer>
      </form>
    </Modal>
  );
}
