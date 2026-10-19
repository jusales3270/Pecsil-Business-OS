"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FAMILIAS, TIPOS, TIPOS_INICIAIS, type LigacaoGrafo, type NoGrafo, type Subgrafo,
  dataBR, filtrar, linhasDaFicha, resumoDaLigacao, rotuloLigacao, tipoDe,
} from "../../../lib/cerebro/visual";
import { type ApiCena, Cena3D, type Margens, type OpcoesCena } from "./Cena3D";

/**
 * War Room › Segundo Cérebro: o grafo da empresa em 3D (docs/PLANO-WAR-ROOM-CEREBRO.md). A cena ocupa a
 * tela; filtros, ficha e visões flutuam por cima e abrem quando pedidos. Cada evento dos módulos, consulta
 * das SARAs ou ligação nova vira um pulso na cena. Quem tem o War Room vê tudo (W2), com os valores (W4).
 */

type Foco =
  | { modo: "vizinhanca"; no: string; nome: string; profundidade: number }
  | { modo: "dependencias"; no: string; nome: string; sentido: "jusante" | "montante" }
  | { modo: "caminho"; de: string; para: string; nomes: [string, string] };
type Filtros = { tipos: string[]; familias: string[]; desde: string | null; foco: Foco | null };
type Visao = { id: string; nome: string; filtros: Filtros; criado_por_nome: string | null; updated_at: string };
type Situacao = { ultima: { inicio: string; fim: string | null; ms: number | null; nos: { total: number } | null; ligacoes: { total: number } | null } | null; visoes: Visao[]; podeRefazer: boolean };
type Registro = { id: string; tipo: string; data: string | null; titulo: string; detalhe: string; valor?: number; valor_unit?: number; link: string };
type Pulso = { em: string; tipo: "evento" | "sara" | "ligacao"; setor?: string; texto: string; ligacao?: string; origem?: string; destino?: string };
type Painel = "filtros" | "visoes" | null;

async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = String(j?.error ?? ""); return { ok: false, error: e === "FORBIDDEN" ? "Sem acesso ao Segundo Cérebro." : e && !/^[A-Z_]+$/.test(e) ? e : "Não foi possível consultar o grafo." }; }
    return { ok: true, data: j as T };
  } catch { return { ok: false, error: "Sem conexão com a plataforma." }; }
}

const PERIODOS = [{ v: "", r: "Todo o histórico" }, { v: "365", r: "Último ano" }, { v: "90", r: "90 dias" }, { v: "30", r: "30 dias" }];
const desdeDe = (dias: string) => (dias ? new Date(Date.now() - Number(dias) * 86_400_000).toISOString().slice(0, 10) : null);
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const haQuanto = (iso: string, agora: number) => {
  const s = Math.max(0, (agora - Date.parse(iso)) / 1000);
  return s < 60 ? "agora" : s < 3600 ? `há ${Math.round(s / 60)} min` : s < 86_400 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86_400)} d`;
};

function useCelular() {
  const [c, setC] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const ler = () => setC(mq.matches);
    const t = setTimeout(ler, 0);
    mq.addEventListener("change", ler);
    return () => { clearTimeout(t); mq.removeEventListener("change", ler); };
  }, []);
  return c;
}

const Icone = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const I = {
  filtro: "M4 5h16l-6 7v5l-4 2v-7z", visoes: "M6 4h12v16l-6-4-6 4z", centro: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  girar: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4", texto: "M5 6h14M12 6v12M8 18h8", particulas: "M3 12h2M8 12h2M13 12h2M18 12h3M5 7l1.5 1.5M17.5 15.5 19 17",
  refazer: "M4 4v6h6M20 20v-6h-6M5.6 15A8 8 0 0 0 19 17M18.4 9A8 8 0 0 0 5 7", fechar: "M6 6l12 12M18 6 6 18",
  cheia: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", sair: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
};

export function Cerebro({ notify }: { notify: (m: string) => void }) {
  const celular = useCelular();
  const [base, setBase] = useState<Subgrafo | null>(null);
  const [foco, setFoco] = useState<Foco | null>(null);
  const [focado, setFocado] = useState<Subgrafo | null>(null);
  const [erro, setErro] = useState("");
  const [tipos, setTipos] = useState<Set<string>>(() => new Set(TIPOS.map((t) => t.tipo)));
  const [familias, setFamilias] = useState<Set<string>>(() => new Set(FAMILIAS.map((f) => f.familia)));
  const [periodo, setPeriodo] = useState("");
  const [noSel, setNoSel] = useState<NoGrafo | null>(null);
  const [ligSel, setLigSel] = useState<{ l: LigacaoGrafo; de: string; para: string } | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesCena>({ nomes: "hubs", particulas: true, girar: true });
  const [painel, setPainel] = useState<Painel>(null);
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [caminhoDe, setCaminhoDe] = useState<NoGrafo | null>(null);
  const [pulsos, setPulsos] = useState<Pulso[]>([]);
  const [agora, setAgora] = useState(0);
  const cache = useRef(new Map<string, NoGrafo>());
  const api = useRef<ApiCena | null>(null);
  const avisar = useRef(notify);
  useEffect(() => { avisar.current = notify; }, [notify]);
  const selecionado = noSel?.id ?? null;
  const raiz = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  useEffect(() => {
    const ler = () => setCheia(document.fullscreenElement === raiz.current && raiz.current !== null);
    document.addEventListener("fullscreenchange", ler);
    return () => document.removeEventListener("fullscreenchange", ler);
  }, []);
  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void raiz.current?.requestFullscreen().catch(() => avisar.current("O navegador não deixou abrir em tela cheia."));
  };
  // Espaço que os painéis tomam de cada lado: a cena centraliza no que sobra.
  const temFicha = Boolean(noSel || ligSel);
  const margens = useMemo<Margens>(() => ({ esquerda: painel ? 372 : 0, direita: temFicha ? 412 : 0 }), [painel, temFicha]);

  const lembrar = useCallback((g: Subgrafo) => { for (const n of g.nos) cache.current.set(n.id, n); }, []);
  const carregarBase = useCallback(async () => {
    setErro("");
    const r = await chamar<Subgrafo>(`/api/warroom/cerebro?acao=visao&tipos=${TIPOS_INICIAIS.join(",")}`);
    if (!r.ok) { setErro(r.error); return; }
    lembrar(r.data);
    setBase(r.data);
  }, [lembrar]);
  const carregarSituacao = useCallback(async () => {
    const r = await chamar<Situacao>("/api/warroom/cerebro?acao=situacao");
    if (r.ok) setSituacao(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregarBase(); void carregarSituacao(); }, 0); return () => clearTimeout(t); }, [carregarBase, carregarSituacao]);

  useEffect(() => {
    if (!foco) { const t = setTimeout(() => setFocado(null), 0); return () => clearTimeout(t); }
    let vivo = true;
    const url = foco.modo === "vizinhanca" ? `/api/warroom/cerebro?acao=vizinhanca&no=${foco.no}&profundidade=${foco.profundidade}&limite=5000`
      : foco.modo === "dependencias" ? `/api/warroom/cerebro?acao=dependencias&no=${foco.no}&sentido=${foco.sentido}`
      : `/api/warroom/cerebro?acao=caminho&de=${foco.de}&para=${foco.para}`;
    void chamar<Subgrafo & { achou?: boolean }>(url).then((r) => {
      if (!vivo) return;
      if (!r.ok) { avisar.current(r.error); return; }
      if (foco.modo === "caminho" && r.data.achou === false) { avisar.current("Não há caminho entre os dois em até 4 passos."); setFoco(null); return; }
      lembrar(r.data);
      setFocado({ ...r.data, centro: foco.modo === "caminho" ? foco.de : foco.no });
    });
    return () => { vivo = false; };
  }, [foco, lembrar]);

  // Pulsos: o que acontece na empresa acende o grafo (a cada 15 s, só com a aba aberta).
  const atual = foco ? focado : base;
  const atualRef = useRef<Subgrafo | null>(null);
  useEffect(() => { atualRef.current = atual; }, [atual]);
  useEffect(() => {
    let desde = new Date(Date.now() - 2 * 3600_000).toISOString();
    let primeira = true;
    let vivo = true;
    const ler = async () => {
      setAgora(Date.now());
      if (document.hidden) return;
      const r = await chamar<Pulso[]>(`/api/warroom/cerebro?acao=pulsos&desde=${encodeURIComponent(desde)}`);
      if (!vivo || !r.ok || !Array.isArray(r.data)) return;
      if (r.data.length) {
        desde = r.data[0].em;
        setPulsos((p) => [...r.data, ...p].slice(0, 30));
        const g = atualRef.current;
        if (g && api.current) {
          const novos = primeira ? r.data.slice(0, 4) : r.data;
          const setores = new Map(g.nos.filter((n) => n.tipo === "setor").map((n) => [String((n as NoGrafo & { chave?: string }).chave ?? "").toUpperCase(), n.id]));
          const nos = novos.flatMap((p) => (p.setor && setores.get(p.setor) ? [setores.get(p.setor)!] : p.origem && p.destino ? [p.origem, p.destino] : []));
          const ligs = novos.flatMap((p) => (p.ligacao ? [p.ligacao] : []));
          if (nos.length || ligs.length) setTimeout(() => api.current?.pulsar(nos, ligs), primeira ? 2500 : 0);
        }
      }
      primeira = false;
    };
    const t0 = setTimeout(() => { void ler(); }, 1200);
    const id = setInterval(() => { void ler(); }, 15_000);
    return () => { vivo = false; clearTimeout(t0); clearInterval(id); };
  }, []);

  const visiveis = useMemo(() => ({ tipos, familias, desde: desdeDe(periodo) }), [tipos, familias, periodo]);
  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of atual?.nos ?? []) m.set(n.tipo, (m.get(n.tipo) ?? 0) + 1);
    return m;
  }, [atual]);
  const listaCelular = useMemo(() => (atual ? filtrar(atual, tipos, familias, desdeDe(periodo)) : null), [atual, tipos, familias, periodo]);

  const escolherNo = useCallback((id: string | null) => { setLigSel(null); setNoSel(id ? cache.current.get(id) ?? null : null); }, []);
  const abrirLigacao = useCallback((l: LigacaoGrafo) => {
    setLigSel({ l, de: cache.current.get(l.origem)?.nome ?? "—", para: cache.current.get(l.destino)?.nome ?? "—" });
  }, []);
  const escolherLigacao = useCallback((id: string) => { const l = atualRef.current?.ligacoes.find((x) => x.id === id); if (l) abrirLigacao(l); }, [abrirLigacao]);
  const onApi = useCallback((a: ApiCena | null) => { api.current = a; }, []);

  const aplicarVisao = (v: Visao) => {
    const f = v.filtros;
    setTipos(new Set(f.tipos?.length ? f.tipos : TIPOS.map((t) => t.tipo)));
    setFamilias(new Set(f.familias?.length ? f.familias : FAMILIAS.map((x) => x.familia)));
    setPeriodo(f.desde ?? "");
    setFoco(f.foco ?? null);
    setNoSel(null);
    setPainel(null);
    notify(`Visão "${v.nome}" aberta.`);
  };
  const salvarVisao = async (nome: string) => {
    const filtros: Filtros = { tipos: [...tipos], familias: [...familias], desde: periodo || null, foco };
    const r = await chamar("/api/warroom/cerebro", { method: "POST", body: JSON.stringify({ acao: "salvar_visao", nome, filtros }) });
    if (!r.ok) { notify(r.error); return false; }
    notify(`Visão "${nome}" salva.`);
    await carregarSituacao();
    return true;
  };
  const apagarVisao = async (v: Visao) => {
    const r = await chamar("/api/warroom/cerebro", { method: "POST", body: JSON.stringify({ acao: "apagar_visao", id: v.id }) });
    if (!r.ok) { notify(r.error); return; }
    await carregarSituacao();
  };
  const refazer = async () => {
    notify("Refazendo o grafo…");
    const r = await chamar<{ ms: number }>("/api/warroom/cerebro", { method: "POST", body: JSON.stringify({ acao: "refazer" }) });
    if (!r.ok) { notify(r.error); return; }
    notify(`Grafo refeito em ${(r.data.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s.`);
    await Promise.all([carregarBase(), carregarSituacao()]);
  };
  const escolherDaBusca = (n: NoGrafo) => {
    cache.current.set(n.id, n);
    if (caminhoDe && caminhoDe.id !== n.id) {
      setFoco({ modo: "caminho", de: caminhoDe.id, para: n.id, nomes: [caminhoDe.nome, n.nome] });
      setCaminhoDe(null);
      setNoSel(n);
      return;
    }
    if (!atual?.nos.some((x) => x.id === n.id)) setFoco({ modo: "vizinhanca", no: n.id, nome: n.nome, profundidade: 1 });
    if (!tipos.has(n.tipo)) setTipos((t) => new Set([...t, n.tipo]));
    setLigSel(null);
    setNoSel(n);
  };
  const alternarTipo = (t: string) => setTipos((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const descricaoFoco = foco?.modo === "vizinhanca" ? `Ligações de ${foco.nome}${foco.profundidade > 1 ? ` · ${foco.profundidade} passos` : ""}`
    : foco?.modo === "dependencias" ? (foco.sentido === "montante" ? `Do que ${foco.nome} depende` : `O que depende de ${foco.nome}`)
    : foco?.modo === "caminho" ? `Caminho: ${foco.nomes[0]} → ${foco.nomes[1]}` : "";

  if (erro) return <div className="neuro neuro-erro-tela"><b>{erro}</b><small>Tente de novo em instantes.</small></div>;

  if (celular) {
    return (
      <div className="neuro-celular">
        <header><p className="eyebrow">WAR ROOM · SEGUNDO CÉREBRO</p><h1>O grafo da empresa</h1><p>No celular, o grafo vira lista: os pontos com mais ligações primeiro. A cena 3D abre no computador.</p></header>
        <Busca onEscolher={escolherDaBusca} />
        {(noSel || ligSel) && (
          <div className="neuro-painel neuro-ficha-celular">
            {ligSel ? <FichaLigacao ligacao={ligSel.l} de={ligSel.de} para={ligSel.para} onFechar={() => setLigSel(null)} />
              : noSel ? <FichaNo no={noSel} onFechar={() => setNoSel(null)} onNo={(n) => { cache.current.set(n.id, n); setNoSel(n); }} onLigacao={abrirLigacao} lembrar={lembrar}
                  onIsolar={(p) => setFoco({ modo: "vizinhanca", no: noSel.id, nome: noSel.nome, profundidade: p })} onDependencias={(s) => setFoco({ modo: "dependencias", no: noSel.id, nome: noSel.nome, sentido: s })} onCaminho={() => setCaminhoDe(noSel)} /> : null}
          </div>
        )}
        {!listaCelular ? <p className="neuro-nota">Carregando…</p> : (
          <ul className="neuro-lista">
            {[...listaCelular.nos].sort((a, b) => b.grau - a.grau).slice(0, 60).map((n) => (
              <li key={n.id}><button type="button" onClick={() => escolherNo(n.id)}><i style={{ background: tipoDe(n.tipo).neuro }} aria-hidden /><span>{n.nome}</span><small>{tipoDe(n.tipo).singular} · {n.grau} ligações</small></button></li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="neuro" ref={raiz}>
      {(atual ?? base) ? (
        <Cena3D grafo={(atual ?? base)!} visiveis={visiveis} selecionado={selecionado} opcoes={opcoes} margens={margens} onNo={escolherNo} onLigacao={escolherLigacao} onApi={onApi} />
      ) : <div className="neuro-carregando neuro-carregando-tela"><span />Carregando o cérebro…</div>}

      <div className="neuro-topo">
        <div className="neuro-marca">
          <p className="eyebrow">WAR ROOM · SEGUNDO CÉREBRO</p>
          {situacao?.ultima?.fim && <small>{situacao.ultima.nos?.total?.toLocaleString("pt-BR")} pontos · {situacao.ultima.ligacoes?.total?.toLocaleString("pt-BR")} ligações · atualizado {haQuanto(situacao.ultima.fim, agora || Date.parse(situacao.ultima.fim))}</small>}
        </div>
        <Busca onEscolher={escolherDaBusca} />
        <div className="neuro-botoes" role="toolbar" aria-label="Controles do grafo">
          <button type="button" className={painel === "filtros" ? "on" : ""} onClick={() => setPainel(painel === "filtros" ? null : "filtros")} aria-pressed={painel === "filtros"} title="Filtros"><Icone d={I.filtro} /><span>Filtros</span></button>
          <button type="button" className={painel === "visoes" ? "on" : ""} onClick={() => setPainel(painel === "visoes" ? null : "visoes")} aria-pressed={painel === "visoes"} title="Visões salvas"><Icone d={I.visoes} /><span>Visões</span></button>
          <button type="button" className={opcoes.nomes !== "nenhum" ? "on" : ""} onClick={() => setOpcoes((o) => ({ ...o, nomes: o.nomes === "hubs" ? "todos" : o.nomes === "todos" ? "nenhum" : "hubs" }))} title="Nomes: principais, todos ou nenhum"><Icone d={I.texto} /><span>{opcoes.nomes === "hubs" ? "Principais" : opcoes.nomes === "todos" ? "Todos" : "Sem nomes"}</span></button>
          <button type="button" className={opcoes.particulas ? "on" : ""} onClick={() => setOpcoes((o) => ({ ...o, particulas: !o.particulas }))} aria-pressed={opcoes.particulas} aria-label="Impulsos nas ligações" title="Impulsos nas ligações"><Icone d={I.particulas} /></button>
          <button type="button" className={opcoes.girar ? "on" : ""} onClick={() => setOpcoes((o) => ({ ...o, girar: !o.girar }))} aria-pressed={opcoes.girar} aria-label="Girar devagar" title="Girar devagar"><Icone d={I.girar} /></button>
          <button type="button" onClick={() => api.current?.centralizar()} aria-label="Enquadrar tudo" title="Enquadrar tudo"><Icone d={I.centro} /></button>
          {situacao?.podeRefazer && <button type="button" onClick={() => void refazer()} aria-label="Refazer o grafo agora" title="Refazer o grafo agora"><Icone d={I.refazer} /></button>}
          <button type="button" className={cheia ? "on" : ""} onClick={telaCheia} aria-pressed={cheia} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"} title={cheia ? "Sair da tela cheia (Esc)" : "Tela cheia"}><Icone d={cheia ? I.sair : I.cheia} /></button>
        </div>
      </div>

      {(foco || caminhoDe) && (
        <div className="neuro-foco" role="status">
          {caminhoDe ? <span>Caminho a partir de <b>{caminhoDe.nome}</b>: escolha o destino na busca.</span>
            : <span><b>{descricaoFoco}</b>{focado ? ` · ${focado.nos.length.toLocaleString("pt-BR")} pontos` : " · carregando…"}</span>}
          <button type="button" onClick={() => { setFoco(null); setCaminhoDe(null); setNoSel(null); }}>{caminhoDe ? "Cancelar" : "Voltar ao cérebro inteiro"}</button>
        </div>
      )}

      {painel === "filtros" && (
        <aside className="neuro-painel neuro-esquerda" aria-label="Filtros">
          <header><h3>Filtros</h3><button type="button" className="neuro-x" onClick={() => setPainel(null)} aria-label="Fechar"><Icone d={I.fechar} /></button></header>
          <section>
            <h4>Grupos</h4>
            <div className="neuro-chips">
              {TIPOS.filter((t) => t.tipo !== "produto" || contagem.get("produto")).map((t) => (
                <button key={t.tipo} type="button" className={tipos.has(t.tipo) ? "on" : ""} aria-pressed={tipos.has(t.tipo)} onClick={() => alternarTipo(t.tipo)}>
                  <i style={{ background: t.neuro }} aria-hidden />{t.rotulo}<small>{(contagem.get(t.tipo) ?? 0).toLocaleString("pt-BR")}</small>
                </button>
              ))}
            </div>
            <p className="neuro-nota">As peças dos clientes (3,9 mil) entram ao abrir um cliente: “Mostrar as peças” na ficha.</p>
          </section>
          <section>
            <h4>Ligações</h4>
            <div className="neuro-chips">
              {FAMILIAS.map((f) => (
                <button key={f.familia} type="button" className={familias.has(f.familia) ? "on" : ""} aria-pressed={familias.has(f.familia)}
                  onClick={() => setFamilias((s) => { const n = new Set(s); if (n.has(f.familia)) n.delete(f.familia); else n.add(f.familia); return n; })}>
                  <i className="linha" style={{ background: f.neuro }} aria-hidden />{f.curto}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Período das ligações</h4>
            <div className="neuro-segmentos" role="radiogroup" aria-label="Período">
              {PERIODOS.map((p) => <button key={p.v} type="button" role="radio" aria-checked={periodo === p.v} className={periodo === p.v ? "on" : ""} onClick={() => setPeriodo(p.v)}>{p.r}</button>)}
            </div>
          </section>
        </aside>
      )}
      {painel === "visoes" && (
        <aside className="neuro-painel neuro-esquerda" aria-label="Visões salvas">
          <header><h3>Visões salvas</h3><button type="button" className="neuro-x" onClick={() => setPainel(null)} aria-label="Fechar"><Icone d={I.fechar} /></button></header>
          <Visoes visoes={situacao?.visoes ?? []} onAbrir={aplicarVisao} onSalvar={salvarVisao} onApagar={(v) => void apagarVisao(v)} />
        </aside>
      )}

      {(noSel || ligSel) && (
        <aside className="neuro-painel neuro-direita" aria-label="Ficha">
          {ligSel ? <FichaLigacao ligacao={ligSel.l} de={ligSel.de} para={ligSel.para} onFechar={() => setLigSel(null)} />
            : noSel ? <FichaNo no={noSel} onFechar={() => setNoSel(null)} onNo={(n) => { cache.current.set(n.id, n); setLigSel(null); setNoSel(n); }} onLigacao={abrirLigacao} lembrar={lembrar}
                onIsolar={(p) => setFoco({ modo: "vizinhanca", no: noSel.id, nome: noSel.nome, profundidade: p })}
                onDependencias={(s) => setFoco({ modo: "dependencias", no: noSel.id, nome: noSel.nome, sentido: s })}
                onCaminho={() => { setCaminhoDe(noSel); avisar.current(`Escolha na busca o destino a partir de ${noSel.nome}.`); }} /> : null}
        </aside>
      )}

      <div className="neuro-legenda" aria-label="Grupos">
        {TIPOS.filter((t) => contagem.get(t.tipo)).map((t) => (
          <button key={t.tipo} type="button" className={tipos.has(t.tipo) ? "" : "off"} onClick={() => alternarTipo(t.tipo)} title={`${tipos.has(t.tipo) ? "Esconder" : "Mostrar"} ${t.rotulo.toLowerCase()}`}>
            <i style={{ background: t.neuro }} aria-hidden />{t.rotulo}
          </button>
        ))}
      </div>

      {pulsos.length > 0 && (
        <div className="neuro-pulsos" aria-live="polite" aria-label="O que acabou de acontecer">
          {pulsos.slice(0, 3).map((p, i) => (
            <p key={`${p.em}-${i}`} className={p.tipo}>
              <i aria-hidden /><b>{p.tipo === "sara" ? "SARA" : p.tipo === "ligacao" ? "Nova ligação" : (p.setor ?? "").toLowerCase()}</b>
              <span>{p.texto}</span><small>{haQuanto(p.em, agora || Date.parse(p.em))}</small>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Busca({ onEscolher }: { onEscolher: (n: NoGrafo) => void }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<NoGrafo[]>([]);
  useEffect(() => {
    const t = termo.trim();
    const id = setTimeout(async () => {
      if (t.length < 2) { setAchados([]); return; }
      const r = await chamar<NoGrafo[]>(`/api/warroom/cerebro?acao=buscar&termo=${encodeURIComponent(t)}&limite=12`);
      setAchados(r.ok ? r.data : []);
    }, 220);
    return () => clearTimeout(id);
  }, [termo]);
  return (
    <div className="neuro-busca">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
      <input type="search" placeholder="Buscar fornecedor, item, cliente, pessoa, setor…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar no grafo" />
      {achados.length > 0 && (
        <ul role="listbox" aria-label="Resultados">
          {achados.map((n) => (
            <li key={n.id}><button type="button" onClick={() => { onEscolher(n); setTermo(""); setAchados([]); }}>
              <i style={{ background: tipoDe(n.tipo).neuro }} aria-hidden /><span>{n.nome}</span><small>{tipoDe(n.tipo).singular}</small>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Visoes({ visoes, onAbrir, onSalvar, onApagar }: { visoes: Visao[]; onAbrir: (v: Visao) => void; onSalvar: (nome: string) => Promise<boolean>; onApagar: (v: Visao) => void }) {
  const [nome, setNome] = useState("");
  return (
    <section>
      {visoes.length === 0 ? <p className="neuro-nota">Nenhuma ainda. Monte o grafo (filtros e foco) e salve com um nome para abrir de novo na reunião.</p> : (
        <ul className="neuro-visoes">
          {visoes.map((v) => (
            <li key={v.id}><button type="button" onClick={() => onAbrir(v)}>{v.nome}</button><button type="button" className="neuro-x" aria-label={`Apagar a visão ${v.nome}`} onClick={() => onApagar(v)}><Icone d={I.fechar} /></button></li>
          ))}
        </ul>
      )}
      <form className="neuro-salvar" onSubmit={async (e) => { e.preventDefault(); if (nome.trim().length >= 2 && (await onSalvar(nome.trim()))) setNome(""); }}>
        <input value={nome} maxLength={80} placeholder="Nome da visão" onChange={(e) => setNome(e.target.value)} aria-label="Nome da visão" />
        <button type="submit" disabled={nome.trim().length < 2}>Salvar</button>
      </form>
    </section>
  );
}

type Vizinhanca = Subgrafo & { centro: string };

function FichaNo({ no, onFechar, onNo, onIsolar, onDependencias, onCaminho, onLigacao, lembrar }: {
  no: NoGrafo; onFechar: () => void; onNo: (n: NoGrafo) => void; onIsolar: (profundidade: number) => void;
  onDependencias: (s: "jusante" | "montante") => void; onCaminho: () => void; onLigacao: (l: LigacaoGrafo) => void; lembrar: (g: Subgrafo) => void;
}) {
  const [viz, setViz] = useState<Vizinhanca | null>(null);
  useEffect(() => {
    let vivo = true;
    void chamar<Vizinhanca>(`/api/warroom/cerebro?acao=vizinhanca&no=${no.id}&profundidade=1&limite=5000`).then((r) => { if (vivo && r.ok) { lembrar(r.data); setViz(r.data); } });
    return () => { vivo = false; };
  }, [no.id, lembrar]);
  const grupos = useMemo(() => {
    const m = new Map<string, { tipo: string; rotulo: string; itens: { l: LigacaoGrafo; outro: NoGrafo }[] }>();
    for (const l of viz?.ligacoes ?? []) {
      if (l.origem !== no.id && l.destino !== no.id) continue;
      const deOrigem = l.origem === no.id;
      const outro = viz?.nos.find((n) => n.id === (deOrigem ? l.destino : l.origem));
      if (!outro) continue;
      const k = `${l.tipo}:${deOrigem}`;
      const g = m.get(k) ?? { tipo: l.tipo, rotulo: rotuloLigacao(l.tipo, deOrigem), itens: [] };
      g.itens.push({ l, outro });
      m.set(k, g);
    }
    for (const g of m.values()) g.itens.sort((a, b) => Number(b.l.total ?? 0) - Number(a.l.total ?? 0) || (b.l.quantidade ?? 0) - (a.l.quantidade ?? 0));
    return [...m.values()].sort((a, b) => b.itens.length - a.itens.length);
  }, [viz, no.id]);
  const linhas = linhasDaFicha(no.tipo, no.resumo);
  const pecas = Number(no.resumo?.pecas ?? 0) || (grupos.find((g) => g.tipo === "tem_peca")?.itens.length ?? 0);
  const t = tipoDe(no.tipo);
  return (
    <div className="neuro-ficha">
      <header>
        <div><p className="neuro-tipo"><i style={{ background: t.neuro, boxShadow: `0 0 12px ${t.neuro}` }} aria-hidden />{t.singular}</p><h2>{no.nome}</h2></div>
        <button type="button" className="neuro-x" onClick={onFechar} aria-label="Fechar a ficha"><Icone d={I.fechar} /></button>
      </header>
      {linhas.length > 0 && <dl className="neuro-numeros">{linhas.map((x) => <div key={x.rotulo}><dt>{x.rotulo}</dt><dd>{x.valor}</dd></div>)}</dl>}
      <div className="neuro-acoes">
        <button type="button" className="forte" onClick={() => onIsolar(1)}>Isolar</button>
        <button type="button" onClick={() => onIsolar(2)}>2 passos</button>
        <button type="button" onClick={() => onDependencias("montante")}>Do que depende</button>
        <button type="button" onClick={() => onDependencias("jusante")}>O que depende dele</button>
        <button type="button" onClick={onCaminho}>Caminho até…</button>
        {pecas > 0 && <button type="button" onClick={() => onIsolar(1)}>Mostrar as {pecas.toLocaleString("pt-BR")} peças</button>}
        {no.link && <a href={no.link}>Abrir no módulo ↗</a>}
      </div>
      <h3>Ligações {viz ? <small>{grupos.reduce((s, g) => s + g.itens.length, 0).toLocaleString("pt-BR")}</small> : null}</h3>
      {!viz ? <p className="neuro-nota">Carregando…</p> : !grupos.length ? <p className="neuro-nota">Sem ligações.</p> : grupos.map((g) => (
        <section key={g.rotulo} className="neuro-lig-grupo">
          <h4>{g.rotulo} <small>{g.itens.length.toLocaleString("pt-BR")}</small></h4>
          <ul>
            {g.itens.slice(0, 20).map(({ l, outro }) => (
              <li key={l.id}>
                <button type="button" className="neuro-lig-no" onClick={() => onNo(outro)}><i style={{ background: tipoDe(outro.tipo).neuro }} aria-hidden />{outro.nome}</button>
                {resumoDaLigacao(l) && <button type="button" className="neuro-lig-resumo" onClick={() => onLigacao(l)} title="Ver os registros">{resumoDaLigacao(l)}</button>}
              </li>
            ))}
          </ul>
          {g.itens.length > 20 && <p className="neuro-nota">e mais {(g.itens.length - 20).toLocaleString("pt-BR")}. Use “Isolar” para ver na cena.</p>}
        </section>
      ))}
    </div>
  );
}

function FichaLigacao({ ligacao, de, para, onFechar }: { ligacao: LigacaoGrafo | null; de: string; para: string; onFechar: () => void }) {
  const [registros, setRegistros] = useState<Registro[] | null>(null);
  useEffect(() => {
    if (!ligacao) return;
    let vivo = true;
    void chamar<Registro[]>(`/api/warroom/cerebro?acao=expandir&ligacao=${ligacao.id}`).then((r) => { if (vivo) setRegistros(r.ok ? r.data : []); });
    return () => { vivo = false; };
  }, [ligacao]);
  if (!ligacao) return <div className="neuro-ficha"><p className="neuro-nota">Ligação não encontrada neste grafo.</p></div>;
  return (
    <div className="neuro-ficha">
      <header>
        <div><p className="neuro-tipo">Ligação · {rotuloLigacao(ligacao.tipo, true)}</p><h2>{de} → {para}</h2></div>
        <button type="button" className="neuro-x" onClick={onFechar} aria-label="Fechar"><Icone d={I.fechar} /></button>
      </header>
      <p className="neuro-lig-linha">{resumoDaLigacao(ligacao) || "Ligação de estrutura (sem lançamentos)."}</p>
      <h3>Registros {registros ? <small>{registros.length}{registros.length === 50 ? " (os 50 mais recentes)" : ""}</small> : null}</h3>
      {!registros ? <p className="neuro-nota">Carregando…</p> : !registros.length ? <p className="neuro-nota">Esta ligação não tem registros para abrir.</p> : (
        <ul className="neuro-registros">
          {registros.map((r) => (
            <li key={r.id}><a href={r.link}>
              <span><b>{r.titulo}</b><small>{[r.tipo, r.data ? dataBR(r.data) : null, r.detalhe].filter(Boolean).join(" · ")}</small></span>
              {r.valor !== undefined && r.valor !== null ? <em>{moeda(Number(r.valor))}</em> : r.valor_unit ? <em>{moeda(Number(r.valor_unit))} un.</em> : null}
            </a></li>
          ))}
        </ul>
      )}
    </div>
  );
}
