"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Status } from "../../../packages/design-system";
import {
  FAMILIAS, TIPOS, TIPOS_INICIAIS, type LigacaoGrafo, type NoGrafo, type Subgrafo,
  dataBR, filtrar, linhasDaFicha, resumoDaLigacao, rotuloLigacao, tipoDe,
} from "../../../lib/cerebro/visual";
import { type Forcas, GrafoCanvas, type Opcoes } from "./GrafoCanvas";

/**
 * War Room › Segundo Cérebro: o grafo da empresa (docs/PLANO-WAR-ROOM-CEREBRO.md). Quem tem o War Room
 * vê tudo (W2), com os valores (W4); os lançamentos ficam somados nas ligações e abrem ao expandir (W3).
 */

type Foco =
  | { modo: "vizinhanca"; no: string; nome: string; profundidade: number }
  | { modo: "dependencias"; no: string; nome: string; sentido: "jusante" | "montante" }
  | { modo: "caminho"; de: string; para: string; nomes: [string, string] };
type Visao = { id: string; nome: string; filtros: Filtros; criado_por_nome: string | null; updated_at: string };
type Filtros = { tipos: string[]; familias: string[]; desde: string | null; pecas: boolean; foco: Foco | null };
type Situacao = { ultima: { inicio: string; fim: string | null; ms: number | null; nos: { total: number } | null; ligacoes: { total: number } | null; erro: string | null } | null; visoes: Visao[]; podeRefazer: boolean };
type Registro = { id: string; tipo: string; data: string | null; titulo: string; detalhe: string; valor?: number; valor_unit?: number; link: string };

async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = String(j?.error ?? ""); return { ok: false, error: e === "FORBIDDEN" ? "Sem acesso ao Segundo Cérebro." : e && !/^[A-Z_]+$/.test(e) ? e : "Não foi possível consultar o grafo." }; }
    return { ok: true, data: j as T };
  } catch { return { ok: false, error: "Sem conexão com a plataforma." }; }
}

const PERIODOS = [{ v: "", r: "Todo o histórico" }, { v: "365", r: "Último ano" }, { v: "90", r: "Últimos 90 dias" }, { v: "30", r: "Últimos 30 dias" }];
const desdeDe = (dias: string) => (dias ? new Date(Date.now() - Number(dias) * 86_400_000).toISOString().slice(0, 10) : null);
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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

export function Cerebro({ notify }: { notify: (m: string) => void }) {
  const celular = useCelular();
  const [base, setBase] = useState<Subgrafo | null>(null);
  const [pecas, setPecas] = useState(false);
  const [foco, setFoco] = useState<Foco | null>(null);
  const [focado, setFocado] = useState<Subgrafo | null>(null);
  const [erro, setErro] = useState("");
  const [tipos, setTipos] = useState<Set<string>>(() => new Set(TIPOS.map((t) => t.tipo)));
  const [familias, setFamilias] = useState<Set<string>>(() => new Set(FAMILIAS.map((f) => f.familia)));
  const [periodo, setPeriodo] = useState("");
  const [noSel, setNoSel] = useState<NoGrafo | null>(null);
  const [ligSel, setLigSel] = useState<{ l: LigacaoGrafo; de: string; para: string } | null>(null);
  const selecionado = noSel?.id ?? null;
  const [opcoes, setOpcoes] = useState<Opcoes>({ setas: true, tamanho: 1, espessura: 1, limiarTexto: 7 });
  const [forcas, setForcas] = useState<Forcas>({ centro: 1, repulsao: 10, ligacao: 1 });
  const [animar, setAnimar] = useState(false);
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [caminhoDe, setCaminhoDe] = useState<NoGrafo | null>(null);
  const cache = useRef(new Map<string, NoGrafo>());
  // O aviso da plataforma muda a cada renderização do painel: fica numa referência (senão o foco recarregaria sem parar).
  const avisar = useRef(notify);
  useEffect(() => { avisar.current = notify; }, [notify]);

  const lembrar = useCallback((g: Subgrafo) => { for (const n of g.nos) cache.current.set(n.id, n); }, []);

  const carregarBase = useCallback(async (comPecas: boolean) => {
    setErro("");
    const r = await chamar<Subgrafo>(`/api/warroom/cerebro?acao=visao&tipos=${(comPecas ? TIPOS.map((t) => t.tipo) : TIPOS_INICIAIS).join(",")}`);
    if (!r.ok) { setErro(r.error); return; }
    lembrar(r.data);
    setBase(r.data);
  }, [lembrar]);
  const carregarSituacao = useCallback(async () => {
    const r = await chamar<Situacao>("/api/warroom/cerebro?acao=situacao");
    if (r.ok) setSituacao(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregarBase(pecas); }, 0); return () => clearTimeout(t); }, [carregarBase, pecas]);
  useEffect(() => { const t = setTimeout(() => { void carregarSituacao(); }, 0); return () => clearTimeout(t); }, [carregarSituacao]);

  // Foco: vizinhança, dependências ou caminho.
  useEffect(() => {
    if (!foco) { const t = setTimeout(() => setFocado(null), 0); return () => clearTimeout(t); }
    let vivo = true;
    const url = foco.modo === "vizinhanca" ? `/api/warroom/cerebro?acao=vizinhanca&no=${foco.no}&profundidade=${foco.profundidade}`
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

  const atual = foco ? focado : base;
  const visivel = useMemo(() => (atual ? filtrar(atual, tipos, familias, desdeDe(periodo)) : null), [atual, tipos, familias, periodo]);
  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of atual?.nos ?? []) m.set(n.tipo, (m.get(n.tipo) ?? 0) + 1);
    return m;
  }, [atual]);
  const destaque = useMemo(() => (foco?.modo === "caminho" && focado ? new Set(focado.nos.map((n) => n.id)) : null), [foco, focado]);

  const escolherNo = useCallback((id: string) => { setLigSel(null); setNoSel(cache.current.get(id) ?? null); }, []);
  const abrirLigacao = useCallback((l: LigacaoGrafo) => {
    setLigSel({ l, de: cache.current.get(l.origem)?.nome ?? "—", para: cache.current.get(l.destino)?.nome ?? "—" });
  }, []);
  const escolherLigacao = useCallback((id: string) => { const l = atual?.ligacoes.find((x) => x.id === id); if (l) abrirLigacao(l); }, [atual, abrirLigacao]);
  const fundo = useCallback(() => { setNoSel(null); setLigSel(null); }, []);

  const aplicarVisao = (v: Visao) => {
    const f = v.filtros;
    setTipos(new Set(f.tipos?.length ? f.tipos : TIPOS.map((t) => t.tipo)));
    setFamilias(new Set(f.familias?.length ? f.familias : FAMILIAS.map((x) => x.familia)));
    setPeriodo(f.desde ?? "");
    setPecas(Boolean(f.pecas));
    setFoco(f.foco ?? null);
    setNoSel(null);
    notify(`Visão "${v.nome}" aberta.`);
  };
  const salvarVisao = async (nome: string) => {
    const filtros: Filtros = { tipos: [...tipos], familias: [...familias], desde: periodo || null, pecas, foco };
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
    await Promise.all([carregarBase(pecas), carregarSituacao()]);
  };

  const iniciarCaminho = (n: NoGrafo) => { setCaminhoDe(n); notify(`Escolha na busca o destino do caminho a partir de ${n.nome}.`); };
  const escolherDaBusca = (n: NoGrafo) => {
    cache.current.set(n.id, n);
    if (caminhoDe && caminhoDe.id !== n.id) {
      setFoco({ modo: "caminho", de: caminhoDe.id, para: n.id, nomes: [caminhoDe.nome, n.nome] });
      setCaminhoDe(null);
      setNoSel(n);
      return;
    }
    if (!atual?.nos.some((x) => x.id === n.id) || !tipos.has(n.tipo)) {
      setTipos((t) => new Set([...t, n.tipo]));
      if (n.tipo === "produto" && !pecas && !foco) setPecas(true);
    }
    setLigSel(null);
    setNoSel(n);
  };

  const descricaoFoco = foco?.modo === "vizinhanca" ? `Ligações de ${foco.nome} (${foco.profundidade} ${foco.profundidade === 1 ? "passo" : "passos"})`
    : foco?.modo === "dependencias" ? (foco.sentido === "montante" ? `Do que ${foco.nome} depende` : `O que depende de ${foco.nome}`)
    : foco?.modo === "caminho" ? `Caminho: ${foco.nomes[0]} → ${foco.nomes[1]}` : "";

  const cabecalho = (
    <div className="finance-page-head almox-head cerebro-head">
      <div>
        <p className="eyebrow">WAR ROOM · SEGUNDO CÉREBRO</p>
        <h1>O grafo da empresa</h1>
        <p>Fornecedores, clientes, itens, contas e setores, e o que liga cada um. Clique num ponto para ver a ficha; isole as ligações, veja do que ele depende ou o caminho até outro.</p>
      </div>
      <div className="cerebro-situacao">
        {situacao?.ultima?.fim && <small>Atualizado em {new Date(situacao.ultima.fim).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {situacao.ultima.nos?.total?.toLocaleString("pt-BR")} pontos · {situacao.ultima.ligacoes?.total?.toLocaleString("pt-BR")} ligações</small>}
        {situacao?.podeRefazer && <Button variant="secondary" compact onClick={() => void refazer()}>Refazer agora</Button>}
      </div>
    </div>
  );

  if (erro) return <>{cabecalho}<div className="finance-empty almox-vazio"><b>{erro}</b><small>Tente de novo em instantes.</small></div></>;

  return (
    <div className={`cerebro${celular ? " celular" : ""}`}>
      {cabecalho}
      {foco && (
        <div className="cerebro-foco" role="status">
          <span><b>{descricaoFoco}</b>{focado ? ` · ${focado.nos.length} pontos` : " · carregando…"}</span>
          <Button variant="secondary" compact onClick={() => { setFoco(null); setNoSel(null); }}>Voltar ao grafo inteiro</Button>
        </div>
      )}
      {caminhoDe && (
        <div className="cerebro-foco" role="status">
          <span>Caminho a partir de <b>{caminhoDe.nome}</b>: escolha o destino na busca.</span>
          <Button variant="secondary" compact onClick={() => setCaminhoDe(null)}>Cancelar</Button>
        </div>
      )}
      <div className="cerebro-corpo">
        <aside className="cerebro-filtros" aria-label="Filtros do grafo">
          <Busca onEscolher={escolherDaBusca} />
          <section>
            <h3>Grupos</h3>
            <ul className="cerebro-grupos">
              {TIPOS.map((t) => (
                <li key={t.tipo}>
                  <label className="cerebro-grupo">
                    <input type="checkbox" checked={tipos.has(t.tipo)} onChange={(e) => setTipos((s) => { const n = new Set(s); if (e.target.checked) n.add(t.tipo); else n.delete(t.tipo); return n; })} />
                    <i style={{ background: `var(${t.cor})` }} aria-hidden />
                    <span>{t.rotulo}</span>
                    <small>{(contagem.get(t.tipo) ?? 0).toLocaleString("pt-BR")}</small>
                  </label>
                </li>
              ))}
            </ul>
            {!foco && (
              <label className="almox-marca cerebro-pecas"><input type="checkbox" checked={pecas} onChange={(e) => setPecas(e.target.checked)} /><span>Carregar as peças dos clientes (3,9 mil pontos)</span></label>
            )}
          </section>
          <section>
            <h3>Ligações</h3>
            {FAMILIAS.map((f) => (
              <label key={f.familia} className="almox-marca"><input type="checkbox" checked={familias.has(f.familia)} onChange={(e) => setFamilias((s) => { const n = new Set(s); if (e.target.checked) n.add(f.familia); else n.delete(f.familia); return n; })} /><span>{f.rotulo}</span></label>
            ))}
            <label className="cerebro-campo"><span>Período das ligações</span>
              <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.r}</option>)}</select>
            </label>
          </section>
          {!celular && (
            <>
              <section>
                <h3>Desenho</h3>
                <label className="almox-marca"><input type="checkbox" checked={opcoes.setas} onChange={(e) => setOpcoes({ ...opcoes, setas: e.target.checked })} /><span>Setas</span></label>
                <Faixa rotulo="Limiar dos nomes" min={1} max={20} passo={1} valor={opcoes.limiarTexto} inverso onChange={(v) => setOpcoes({ ...opcoes, limiarTexto: v })} />
                <Faixa rotulo="Tamanho dos pontos" min={0.5} max={2} passo={0.1} valor={opcoes.tamanho} onChange={(v) => setOpcoes({ ...opcoes, tamanho: v })} />
                <Faixa rotulo="Espessura das ligações" min={0.3} max={3} passo={0.1} valor={opcoes.espessura} onChange={(v) => setOpcoes({ ...opcoes, espessura: v })} />
              </section>
              <section>
                <h3>Forças</h3>
                <Faixa rotulo="Centro" min={0.1} max={5} passo={0.1} valor={forcas.centro} onChange={(v) => setForcas({ ...forcas, centro: v })} />
                <Faixa rotulo="Repulsão" min={1} max={60} passo={1} valor={forcas.repulsao} onChange={(v) => setForcas({ ...forcas, repulsao: v })} />
                <Faixa rotulo="Ligação" min={0} max={2} passo={0.1} valor={forcas.ligacao} onChange={(v) => setForcas({ ...forcas, ligacao: v })} />
                <Button className="cerebro-animar" onClick={() => setAnimar((a) => !a)} aria-pressed={animar}>{animar ? "Parar" : "Animar"}</Button>
              </section>
            </>
          )}
          <Visoes visoes={situacao?.visoes ?? []} onAbrir={aplicarVisao} onSalvar={salvarVisao} onApagar={(v) => void apagarVisao(v)} />
        </aside>

        <main className="cerebro-centro">
          {!visivel ? <div className="finance-empty almox-vazio"><b>Carregando o grafo…</b><small /></div>
            : celular ? <ListaCelular grafo={visivel} onNo={escolherNo} />
            : visivel.nos.length === 0 ? <div className="finance-empty almox-vazio"><b>Nada com estes filtros</b><small>Ligue mais grupos ou tipos de ligação.</small></div>
            : <GrafoCanvas grafo={visivel} selecionado={selecionado} destaque={destaque} opcoes={opcoes} forcas={forcas} animar={animar} onNo={escolherNo} onLigacao={escolherLigacao} onFundo={fundo} />}
        </main>

        {(noSel || ligSel) && (
          <aside className="cerebro-ficha" aria-label="Ficha">
            {ligSel ? <FichaLigacao ligacao={ligSel.l} de={ligSel.de} para={ligSel.para} onFechar={() => setLigSel(null)} />
              : noSel ? <FichaNo no={noSel} onFechar={() => setNoSel(null)} onNo={(n) => { cache.current.set(n.id, n); setLigSel(null); setNoSel(n); }}
                  onIsolar={(p) => setFoco({ modo: "vizinhanca", no: noSel.id, nome: noSel.nome, profundidade: p })}
                  onDependencias={(s) => setFoco({ modo: "dependencias", no: noSel.id, nome: noSel.nome, sentido: s })}
                  onCaminho={() => iniciarCaminho(noSel)} onLigacao={abrirLigacao} lembrar={lembrar} />
              : null}
          </aside>
        )}
      </div>
    </div>
  );
}

function Faixa({ rotulo, min, max, passo, valor, onChange, inverso }: { rotulo: string; min: number; max: number; passo: number; valor: number; onChange: (v: number) => void; inverso?: boolean }) {
  // "Limiar dos nomes": à direita mostra mais nomes (o valor real é o inverso).
  const mostrado = inverso ? max + min - valor : valor;
  return (
    <label className="cerebro-faixa"><span>{rotulo}</span>
      <input type="range" min={min} max={max} step={passo} value={mostrado} onChange={(e) => { const v = Number(e.target.value); onChange(inverso ? max + min - v : v); }} />
    </label>
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
    }, 250);
    return () => clearTimeout(id);
  }, [termo]);
  return (
    <section className="cerebro-busca">
      <input type="search" placeholder="Buscar fornecedor, item, cliente, conta…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar no grafo" />
      {achados.length > 0 && (
        <ul role="listbox" aria-label="Resultados">
          {achados.map((n) => (
            <li key={n.id}><button type="button" onClick={() => { onEscolher(n); setTermo(""); setAchados([]); }}>
              <i style={{ background: `var(${tipoDe(n.tipo).cor})` }} aria-hidden /><span>{n.nome}</span><small>{tipoDe(n.tipo).singular}</small>
            </button></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Visoes({ visoes, onAbrir, onSalvar, onApagar }: { visoes: Visao[]; onAbrir: (v: Visao) => void; onSalvar: (nome: string) => Promise<boolean>; onApagar: (v: Visao) => void }) {
  const [nome, setNome] = useState("");
  return (
    <section>
      <h3>Visões salvas</h3>
      {visoes.length === 0 ? <p className="ti-nota">Nenhuma ainda. Monte o grafo (filtros e foco) e salve com um nome.</p> : (
        <ul className="cerebro-visoes">
          {visoes.map((v) => (
            <li key={v.id}><button type="button" onClick={() => onAbrir(v)}>{v.nome}</button><button type="button" className="cerebro-x" aria-label={`Apagar a visão ${v.nome}`} onClick={() => onApagar(v)}>×</button></li>
          ))}
        </ul>
      )}
      <form className="cerebro-salvar" onSubmit={async (e) => { e.preventDefault(); if (nome.trim().length >= 2 && (await onSalvar(nome.trim()))) setNome(""); }}>
        <input value={nome} maxLength={80} placeholder="Nome da visão" onChange={(e) => setNome(e.target.value)} aria-label="Nome da visão" />
        <Button compact variant="secondary" type="submit" disabled={nome.trim().length < 2}>Salvar</Button>
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
    void chamar<Vizinhanca>(`/api/warroom/cerebro?acao=vizinhanca&no=${no.id}&profundidade=1&limite=400`).then((r) => { if (vivo && r.ok) { lembrar(r.data); setViz(r.data); } });
    return () => { vivo = false; };
  }, [no.id, lembrar]);
  const grupos = useMemo(() => {
    const m = new Map<string, { rotulo: string; itens: { l: LigacaoGrafo; outro: NoGrafo }[] }>();
    for (const l of viz?.ligacoes ?? []) {
      if (l.origem !== no.id && l.destino !== no.id) continue;
      const deOrigem = l.origem === no.id;
      const outro = viz?.nos.find((n) => n.id === (deOrigem ? l.destino : l.origem));
      if (!outro) continue;
      const k = `${l.tipo}:${deOrigem}`;
      const g = m.get(k) ?? { rotulo: rotuloLigacao(l.tipo, deOrigem), itens: [] };
      g.itens.push({ l, outro });
      m.set(k, g);
    }
    for (const g of m.values()) g.itens.sort((a, b) => Number(b.l.total ?? 0) - Number(a.l.total ?? 0) || (b.l.quantidade ?? 0) - (a.l.quantidade ?? 0));
    return [...m.values()];
  }, [viz, no.id]);
  const linhas = linhasDaFicha(no.tipo, no.resumo);
  return (
    <div className="cerebro-ficha-corpo">
      <header>
        <div><p className="eyebrow"><i style={{ background: `var(${tipoDe(no.tipo).cor})` }} aria-hidden /> {tipoDe(no.tipo).singular}</p><h2>{no.nome}</h2></div>
        <button type="button" className="cerebro-x" onClick={onFechar} aria-label="Fechar a ficha">×</button>
      </header>
      {no.termos.length > 0 && <div className="cerebro-termos">{no.termos.map((t) => <Status key={t} tone="neutral">{t}</Status>)}</div>}
      {linhas.length > 0 && <dl className="cerebro-numeros">{linhas.map((x) => <div key={x.rotulo}><dt>{x.rotulo}</dt><dd>{x.valor}</dd></div>)}</dl>}
      <div className="cerebro-acoes">
        <Button compact onClick={() => onIsolar(1)}>Isolar</Button>
        <Button compact variant="secondary" onClick={() => onIsolar(2)}>2 passos</Button>
        <Button compact variant="secondary" onClick={() => onDependencias("montante")}>Do que depende</Button>
        <Button compact variant="secondary" onClick={() => onDependencias("jusante")}>O que depende dele</Button>
        <Button compact variant="secondary" onClick={onCaminho}>Caminho até…</Button>
        {no.link && <a className="ds-button ghost compact" href={no.link}>Abrir no módulo</a>}
      </div>
      <h3>Ligações {viz ? `(${grupos.reduce((s, g) => s + g.itens.length, 0)})` : ""}</h3>
      {!viz ? <p className="ti-nota">Carregando…</p> : !grupos.length ? <p className="ti-nota">Sem ligações.</p> : grupos.map((g) => (
        <section key={g.rotulo} className="cerebro-lig-grupo">
          <h4>{g.rotulo} <small>{g.itens.length}</small></h4>
          <ul>
            {g.itens.slice(0, 25).map(({ l, outro }) => (
              <li key={l.id}>
                <button type="button" className="cerebro-lig-no" onClick={() => onNo(outro)}><i style={{ background: `var(${tipoDe(outro.tipo).cor})` }} aria-hidden />{outro.nome}</button>
                {resumoDaLigacao(l) && <button type="button" className="cerebro-lig-resumo" onClick={() => onLigacao(l)} title="Ver os registros">{resumoDaLigacao(l)}</button>}
              </li>
            ))}
          </ul>
          {g.itens.length > 25 && <p className="ti-nota">e mais {g.itens.length - 25}. Use “Isolar” para ver no grafo.</p>}
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
  if (!ligacao) return <div className="cerebro-ficha-corpo"><p className="ti-nota">Ligação não encontrada neste grafo.</p></div>;
  return (
    <div className="cerebro-ficha-corpo">
      <header>
        <div><p className="eyebrow">Ligação · {rotuloLigacao(ligacao.tipo, true)}</p><h2>{de} → {para}</h2></div>
        <button type="button" className="cerebro-x" onClick={onFechar} aria-label="Fechar">×</button>
      </header>
      <p className="cerebro-lig-linha">{resumoDaLigacao(ligacao) || "Ligação de estrutura (sem lançamentos)."}</p>
      {ligacao.procedencia !== "regra" && <Callout variant="info" title="Origem">{ligacao.procedencia === "modelo" ? "Sugerida pelo modelo" : "Registrada por uma pessoa"}{ligacao.situacao === "proposta" ? " · aguarda confirmação" : ""}.</Callout>}
      <h3>Registros {registros ? `(${registros.length}${registros.length === 50 ? ", os 50 mais recentes" : ""})` : ""}</h3>
      {!registros ? <p className="ti-nota">Carregando…</p> : !registros.length ? <p className="ti-nota">Esta ligação não tem registros para abrir.</p> : (
        <ul className="cerebro-registros">
          {registros.map((r) => (
            <li key={r.id}>
              <a href={r.link}>
                <span><b>{r.titulo}</b><small>{[r.tipo, r.data ? dataBR(r.data) : null, r.detalhe].filter(Boolean).join(" · ")}</small></span>
                {r.valor !== undefined && r.valor !== null ? <em>{moeda(Number(r.valor))}</em> : r.valor_unit ? <em>{moeda(Number(r.valor_unit))} un.</em> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListaCelular({ grafo, onNo }: { grafo: Subgrafo; onNo: (id: string) => void }) {
  const maiores = useMemo(() => [...grafo.nos].sort((a, b) => b.grau - a.grau).slice(0, 60), [grafo]);
  return (
    <div className="cerebro-lista">
      <p className="ti-nota">No celular, o grafo vira lista: os pontos com mais ligações primeiro. Toque para abrir a ficha.</p>
      <ul>
        {maiores.map((n) => (
          <li key={n.id}><button type="button" onClick={() => onNo(n.id)}><i style={{ background: `var(${tipoDe(n.tipo).cor})` }} aria-hidden /><span>{n.nome}</span><small>{tipoDe(n.tipo).singular} · {n.grau} ligações</small></button></li>
        ))}
      </ul>
    </div>
  );
}
