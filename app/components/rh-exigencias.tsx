"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Kpi, KpiGrid, Segmented, Status } from "../../packages/design-system";

/**
 * RH › Saúde e segurança › Exigências por função (R-03). A função diz o que cada colaborador precisa
 * ter (EPI, exames, treinamentos) e a tela mostra quem está pendente. As sugestões vêm por regra do
 * histórico de entregas (EPI entregue a pelo menos metade da função nos últimos 12 meses) e só valem
 * depois de confirmadas por quem aprova SST no RH.
 */

type Tipo = "epi" | "exame" | "treinamento";
type Situacao = "nunca_entregue" | "sem_registro" | "vencido" | "a_vencer" | "em_dia";
type Exigencia = { id: string; position_id: string; tipo: Tipo; ppe_item_id: string | null; titulo: string | null; validade_dias: number | null; origem: "manual" | "historico"; criado_por_nome: string | null };
type Sugestao = { position_id: string; funcao: string; ppe_item_id: string; epi: string; pessoas: number; na_funcao: number };
type Pendencia = { employee_id: string; colaborador: string; setor: string | null; funcao: string; requirement_id: string; tipo: Tipo; exigencia: string; validade_dias: number | null; ultima: string | null; vence: string | null; situacao: Situacao };
type Dados = { podeEditar: boolean; funcoes: { id: string; nome: string; ativos: number }[]; exigencias: Exigencia[]; sugestoes: Sugestao[]; pendencias: Pendencia[]; epis: { id: string; name: string; ca_number: string | null }[] };
type Vista = "Pendências" | "Por função" | "Sugestões";

const SITUACAO: Record<Situacao, [string, "danger" | "attention" | "success" | "neutral"]> = {
  nunca_entregue: ["Nunca entregue", "danger"], sem_registro: ["Sem registro", "danger"], vencido: ["Vencido", "danger"],
  a_vencer: ["A vencer em 30 dias", "attention"], em_dia: ["Em dia", "success"],
};
const TIPO: Record<Tipo, string> = { epi: "EPI", exame: "Exame", treinamento: "Treinamento" };
const data = (v: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const validadeTexto = (d: number | null) => (d ? (d % 365 === 0 ? `${d / 365} ano(s)` : d % 30 === 0 ? `${d / 30} mês(es)` : `${d} dias`) : "sem validade");

async function chamar<T>(init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/rh/exigencias", { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = await r.json().catch(() => null);
    return r.ok ? { ok: true, data: body as T } : { ok: false, error: body?.error ?? "Não foi possível concluir." };
  } catch { return { ok: false, error: "Sem conexão com a plataforma." }; }
}

export function ExigenciasFuncao({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [vista, setVista] = useState<Vista>("Pendências");
  const carregar = useCallback(async () => {
    const r = await chamar<Dados>();
    if (!r.ok) { setErro(r.error); return; }
    setErro(""); setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  const acao = async (corpo: Record<string, unknown>, ok: string) => {
    const r = await chamar<{ ok: true; feitas?: number }>({ method: "POST", body: JSON.stringify(corpo) });
    if (!r.ok) { notify(r.error); return false; }
    notify(r.data.feitas ? `${r.data.feitas} exigência(s) confirmada(s).` : ok);
    await carregar();
    return true;
  };

  if (erro) return <div className="finance-empty"><b>{erro}</b></div>;
  if (!dados) return <div className="finance-empty"><small>Carregando as exigências…</small></div>;

  const comExigencia = new Set(dados.exigencias.map((e) => e.position_id)).size;
  const abertas = dados.pendencias.filter((p) => p.situacao !== "em_dia");
  const conta = (s: Situacao[]) => dados.pendencias.filter((p) => s.includes(p.situacao)).length;
  const sugeridas = new Set(dados.sugestoes.map((s) => s.position_id)).size;

  return (
    <div className="rh-exig">
      <KpiGrid>
        <Kpi label="Funções com exigências" value={`${comExigencia} de ${dados.funcoes.length}`} caption="Funções com colaborador ativo" tone={comExigencia < dados.funcoes.length ? "amber" : "green"} />
        <Kpi label="Faltando" value={conta(["nunca_entregue", "sem_registro"])} caption="EPI nunca entregue ou exame sem registro" tone="red" />
        <Kpi label="Vencidas" value={conta(["vencido"])} caption="Troca de EPI ou exame vencido" tone="red" />
        <Kpi label="A vencer" value={conta(["a_vencer"])} caption="Nos próximos 30 dias" tone="amber" />
      </KpiGrid>
      {!dados.podeEditar && <Callout variant="info" title="Só consulta">Definir as exigências de cada função é de quem aprova em Saúde e segurança no RH.</Callout>}
      <Segmented<Vista> options={[{ value: "Pendências", label: `Pendências (${abertas.length})` }, { value: "Por função", label: "Por função" }, { value: "Sugestões", label: `Sugestões (${dados.sugestoes.length})` }]} value={vista} onChange={setVista} ariaLabel="Exigências por função" compact />
      {vista === "Pendências" && <Pendencias pendencias={dados.pendencias} temExigencia={dados.exigencias.length > 0} irSugestoes={() => setVista("Sugestões")} sugeridas={sugeridas} />}
      {vista === "Por função" && <PorFuncao dados={dados} acao={acao} />}
      {vista === "Sugestões" && <Sugestoes dados={dados} acao={acao} />}
    </div>
  );
}

function Pendencias({ pendencias, temExigencia, irSugestoes, sugeridas }: { pendencias: Pendencia[]; temExigencia: boolean; irSugestoes: () => void; sugeridas: number }) {
  const [filtro, setFiltro] = useState<"abertas" | "todas">("abertas");
  const [setor, setSetor] = useState("");
  const setores = useMemo(() => [...new Set(pendencias.map((p) => p.setor ?? "Sem setor"))].sort((a, b) => a.localeCompare(b, "pt-BR")), [pendencias]);
  const lista = pendencias.filter((p) => (filtro === "todas" || p.situacao !== "em_dia") && (!setor || (p.setor ?? "Sem setor") === setor));
  if (!temExigencia) {
    return (
      <Card className="rh-exig-vazio">
        <b>Nenhuma função tem exigências ainda</b>
        <small>Comece pelas sugestões: os EPIs que já são entregues a pelo menos metade de cada função ({sugeridas} funções têm sugestão).</small>
        <Button onClick={irSugestoes}>Ver sugestões</Button>
      </Card>
    );
  }
  return (
    <Card className="rh-exig-card">
      <div className="rh-exig-filtros">
        <Segmented<"abertas" | "todas"> options={[{ value: "abertas", label: "Só pendentes" }, { value: "todas", label: "Todas" }]} value={filtro} onChange={setFiltro} ariaLabel="Situação" compact />
        <label><span>Setor</span><select className="icms-select" value={setor} onChange={(e) => setSetor(e.target.value)}><option value="">Todos</option>{setores.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </div>
      {lista.length ? (
        <div className="rh-exig-tabela" role="table" aria-label="Pendências por colaborador">
          <div className="cabeca" role="row"><span>Colaborador</span><span>Exigência</span><span>Situação</span><span>Última</span><span>Vence</span></div>
          {lista.map((p) => (
            <div role="row" key={`${p.employee_id}-${p.requirement_id}`}>
              <span className="nome">{p.colaborador}<small>{p.setor ?? "Sem setor"} · {p.funcao}</small></span>
              <span className="nome">{p.exigencia}<small>{TIPO[p.tipo]} · {validadeTexto(p.validade_dias)}</small></span>
              <span><Status tone={SITUACAO[p.situacao][1]}>{SITUACAO[p.situacao][0]}</Status></span>
              <span>{data(p.ultima)}</span>
              <span>{data(p.vence)}</span>
            </div>
          ))}
        </div>
      ) : <div className="finance-empty"><b>Nada pendente{setor ? ` em ${setor}` : ""}</b><small>Todos os colaboradores estão com as exigências da função em dia.</small></div>}
    </Card>
  );
}

function PorFuncao({ dados, acao }: { dados: Dados; acao: (c: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [funcao, setFuncao] = useState(dados.funcoes[0]?.id ?? "");
  const [tipo, setTipo] = useState<Tipo>("epi");
  const [epi, setEpi] = useState("");
  const [titulo, setTitulo] = useState("");
  const [validade, setValidade] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const f = dados.funcoes.find((x) => x.id === funcao);
  const lista = dados.exigencias.filter((e) => e.position_id === funcao);
  const nomeEpi = (id: string | null) => dados.epis.find((x) => x.id === id)?.name ?? "EPI";
  const pend = dados.pendencias.filter((p) => p.funcao === f?.nome && p.situacao !== "em_dia").length;
  const dias = validade.trim() ? Number(validade) : null;
  const valido = Boolean(funcao) && (tipo === "epi" ? Boolean(epi) : titulo.trim().length >= 2) && (dias === null || (Number.isInteger(dias) && dias >= 1 && dias <= 3650));
  const salvar = async () => {
    setOcupado(true);
    const ok = await acao({ acao: "salvar", funcao, tipo, epi: tipo === "epi" ? epi : null, titulo: tipo === "epi" ? null : titulo.trim(), validade: dias }, "Exigência gravada.");
    setOcupado(false);
    if (ok) { setEpi(""); setTitulo(""); setValidade(""); }
  };
  return (
    <Card className="rh-exig-card">
      <div className="rh-exig-filtros">
        <label className="rh-exig-funcao"><span>Função</span>
          <select className="icms-select" value={funcao} onChange={(e) => setFuncao(e.target.value)}>
            {dados.funcoes.map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.ativos})</option>)}
          </select>
        </label>
        {f && <small>{f.ativos} colaborador(es) ativo(s) · {lista.length} exigência(s){pend ? ` · ${pend} pendência(s)` : ""}</small>}
      </div>
      {lista.length ? (
        <div className="rh-exig-lista">
          {lista.map((e) => (
            <div key={e.id}>
              <span className="nome">{e.tipo === "epi" ? nomeEpi(e.ppe_item_id) : e.titulo}<small>{TIPO[e.tipo]} · {validadeTexto(e.validade_dias)} · {e.origem === "historico" ? "confirmada do histórico" : "manual"}{e.criado_por_nome ? ` · ${e.criado_por_nome}` : ""}</small></span>
              {dados.podeEditar && <button type="button" className="almox-link" onClick={() => void acao({ acao: "remover", id: e.id }, "Exigência removida.")}>Remover</button>}
            </div>
          ))}
        </div>
      ) : <div className="finance-empty"><small>Esta função ainda não tem exigências.</small></div>}
      {dados.podeEditar && (
        <div className="rh-exig-form">
          <span className="almox-rotulo">Incluir exigência</span>
          <div className="fiscal-campos">
            <label><span>Tipo</span><select className="icms-select" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}><option value="epi">EPI</option><option value="exame">Exame</option><option value="treinamento">Treinamento</option></select></label>
            {tipo === "epi"
              ? <label className="fiscal-largo"><span>EPI do catálogo</span><select className="icms-select" value={epi} onChange={(e) => setEpi(e.target.value)}><option value="">Escolha…</option>{dados.epis.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              : <label className="fiscal-largo"><span>Nome <small>(igual ao do registro de SST, ex.: ASO periódico)</small></span><input value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} /></label>}
            <label><span>Validade em dias <small>(troca ou periodicidade; opcional)</small></span><input inputMode="numeric" value={validade} onChange={(e) => setValidade(e.target.value.replace(/\D/g, ""))} placeholder="ex.: 365" /></label>
          </div>
          <footer><Button onClick={() => void salvar()} disabled={!valido || ocupado}>{ocupado ? "Gravando…" : "Incluir na função"}</Button></footer>
        </div>
      )}
    </Card>
  );
}

function Sugestoes({ dados, acao }: { dados: Dados; acao: (c: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [validade, setValidade] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const chave = (s: Sugestao) => `${s.position_id}|${s.ppe_item_id}`;
  const grupos = useMemo(() => {
    const m = new Map<string, Sugestao[]>();
    for (const s of dados.sugestoes) m.set(s.funcao, [...(m.get(s.funcao) ?? []), s]);
    return [...m.entries()];
  }, [dados.sugestoes]);
  const alternar = (ks: string[], ligar: boolean) => setMarcadas((atual) => { const n = new Set(atual); for (const k of ks) { if (ligar) n.add(k); else n.delete(k); } return n; });
  const dias = validade.trim() ? Number(validade) : null;
  const confirmar = async () => {
    setOcupado(true);
    const itens = dados.sugestoes.filter((s) => marcadas.has(chave(s))).map((s) => ({ funcao: s.position_id, epi: s.ppe_item_id }));
    const ok = await acao({ acao: "confirmar", itens, validade: dias }, "Sugestões confirmadas.");
    setOcupado(false);
    if (ok) setMarcadas(new Set());
  };
  if (!dados.sugestoes.length) return <Card className="rh-exig-vazio"><b>Nenhuma sugestão em aberto</b><small>Aparecem aqui os EPIs entregues a pelo menos metade dos colaboradores ativos de uma função nos últimos 12 meses que ainda não são exigência dela.</small></Card>;
  return (
    <Card className="rh-exig-card">
      <p className="fiscal-nota-ajuda">Regra: o EPI foi entregue a pelo menos metade dos colaboradores ativos da função nos últimos 12 meses. Nada vira exigência sem confirmação.</p>
      <div className="rh-exig-grupos">
        {grupos.map(([funcao, lista]) => {
          const ks = lista.map(chave);
          const todas = ks.every((k) => marcadas.has(k));
          return (
            <section key={funcao}>
              <header>
                <b>{funcao}</b><small>{lista[0].na_funcao} ativo(s)</small>
                {dados.podeEditar && <button type="button" className="almox-link" onClick={() => alternar(ks, !todas)}>{todas ? "Desmarcar a função" : "Marcar a função"}</button>}
              </header>
              {lista.map((s) => (
                <label key={chave(s)} className="rh-exig-sug">
                  {dados.podeEditar && <input type="checkbox" checked={marcadas.has(chave(s))} onChange={(e) => alternar([chave(s)], e.target.checked)} />}
                  <span>{s.epi}</span>
                  <small>{s.pessoas} de {s.na_funcao} receberam</small>
                </label>
              ))}
            </section>
          );
        })}
      </div>
      {dados.podeEditar && (
        <footer className="rh-exig-confirmar">
          <label><span>Validade em dias para as marcadas <small>(opcional)</small></span><input inputMode="numeric" value={validade} onChange={(e) => setValidade(e.target.value.replace(/\D/g, ""))} placeholder="sem validade" /></label>
          <Button onClick={() => void confirmar()} disabled={!marcadas.size || ocupado || (dias !== null && (dias < 1 || dias > 3650))}>{ocupado ? "Confirmando…" : `Confirmar ${marcadas.size} como exigência`}</Button>
        </footer>
      )}
    </Card>
  );
}
