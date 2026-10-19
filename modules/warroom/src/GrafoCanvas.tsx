"use client";

import { useEffect, useRef, useState } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type FA2Layout from "graphology-layout-forceatlas2/worker";
import { type Subgrafo, posicaoInicial, tamanhoDoNo, tipoDe } from "../../../lib/cerebro/visual";

/**
 * O desenho do grafo (WebGL, sigma.js + graphology). As bibliotecas só carregam no navegador.
 * O ForceAtlas2 roda num worker: arruma o grafo por alguns segundos quando ele abre e fica rodando
 * enquanto "Animar" estiver ligado. Filtros e destaque são feitos pelos reducers (sem refazer o grafo).
 */
export type Opcoes = { setas: boolean; tamanho: number; espessura: number; limiarTexto: number };
export type Forcas = { centro: number; repulsao: number; ligacao: number };

type Props = {
  grafo: Subgrafo;
  selecionado: string | null;
  destaque: Set<string> | null;
  opcoes: Opcoes;
  forcas: Forcas;
  animar: boolean;
  onNo: (id: string) => void;
  onLigacao: (id: string) => void;
  onFundo: () => void;
  onArrumado?: () => void;
};

type Cores = { tipos: Record<string, string>; ligacao: string; texto: string; apagado: string; fundo: string; destaque: string };

function lerCores(): Cores {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, padrao: string) => css.getPropertyValue(n).trim() || padrao;
  const tipos: Record<string, string> = {};
  for (const t of ["fornecedor", "cliente", "item", "conta", "setor", "material", "produto"]) tipos[t] = v(tipoDe(t).cor, "#888888");
  return { tipos, ligacao: v("--text-muted", "#848c99"), texto: v("--text-secondary", "#545b66"), apagado: v("--border", "#d6d9de"), fundo: v("--bg-surface", "#ffffff"), destaque: v("--accent-blue", "#2864ed") };
}

const comAlfa = (cor: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(cor);
  if (!m) return cor;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function GrafoCanvas({ grafo, selecionado, destaque, opcoes, forcas, animar, onNo, onLigacao, onFundo, onArrumado }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const ref = useRef<{ sigma: Sigma | null; graph: Graph | null; layout: FA2Layout | null; cores: Cores | null; hover: string | null }>({ sigma: null, graph: null, layout: null, cores: null, hover: null });
  const estado = useRef({ selecionado, destaque, opcoes });
  const callbacks = useRef({ onNo, onLigacao, onFundo, onArrumado });
  const [erro, setErro] = useState("");
  const [arrumando, setArrumando] = useState(false);
  const animarRef = useRef(animar);
  useEffect(() => { callbacks.current = { onNo, onLigacao, onFundo, onArrumado }; }, [onNo, onLigacao, onFundo, onArrumado]);

  // Monta o grafo (de novo só quando os dados mudam).
  useEffect(() => {
    let vivo = true;
    let paraArrumar: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const [{ default: GraphClass }, { default: SigmaClass }, fa2, { default: FA2LayoutClass }] = await Promise.all([
          import("graphology"), import("sigma"), import("graphology-layout-forceatlas2"), import("graphology-layout-forceatlas2/worker"),
        ]);
        if (!vivo || !caixa.current) return;
        const cores = lerCores();
        ref.current.cores = cores;
        const g = new GraphClass({ multi: false, type: "directed", allowSelfLoops: false });
        for (const n of grafo.nos) {
          const p = n.x !== null && n.y !== null ? { x: n.x, y: n.y } : posicaoInicial(n.id);
          g.addNode(n.id, { label: n.nome, x: p.x, y: p.y, size: tamanhoDoNo(n.grau, estado.current.opcoes.tamanho), tipo: n.tipo, grau: n.grau });
        }
        for (const l of grafo.ligacoes) {
          if (!g.hasNode(l.origem) || !g.hasNode(l.destino) || g.hasEdge(l.origem, l.destino)) continue;
          g.addEdgeWithKey(l.id, l.origem, l.destino, { familia: l.familia, tipo: l.tipo, weight: 1 + Math.log10(1 + (l.quantidade ?? 1)) });
        }
        const sigma = new SigmaClass(g, caixa.current, {
          renderEdgeLabels: false, enableEdgeEvents: true, zIndex: true, allowInvalidContainer: true,
          labelColor: { color: cores.texto }, labelFont: "Inter, system-ui, sans-serif", labelSize: 12, labelWeight: "500",
          labelRenderedSizeThreshold: estado.current.opcoes.limiarTexto, defaultEdgeType: estado.current.opcoes.setas ? "arrow" : "line",
          minCameraRatio: 0.02, maxCameraRatio: 12,
          nodeReducer: (no, d) => {
            const { selecionado: sel, destaque: dest, opcoes: o } = estado.current;
            const c = ref.current.cores ?? cores;
            const foco = ref.current.hover ?? sel;
            const out = { ...d, color: c.tipos[d.tipo as string] ?? c.ligacao, size: tamanhoDoNo(d.grau as number, o.tamanho) };
            const vizinho = foco ? no === foco || g.areNeighbors(no, foco) : true;
            const marcado = dest ? dest.has(no) : true;
            if (!vizinho || !marcado) return { ...out, color: comAlfa(c.apagado, 0.9), label: "", zIndex: 0 };
            if (no === sel) return { ...out, highlighted: true, zIndex: 3, forceLabel: true };
            if (foco && no !== foco) return { ...out, zIndex: 2, forceLabel: g.degree(foco) <= 40 };
            return { ...out, zIndex: 1 };
          },
          edgeReducer: (aresta, d) => {
            const { selecionado: sel, destaque: dest, opcoes: o } = estado.current;
            const c = ref.current.cores ?? cores;
            const foco = ref.current.hover ?? sel;
            const [a, b] = g.extremities(aresta);
            const base = { ...d, size: Math.max(0.3, (d.weight as number) * 0.6 * o.espessura), color: comAlfa(c.ligacao, 0.32), type: o.setas ? "arrow" : "line" };
            if (dest && !(dest.has(a) && dest.has(b))) return { ...base, hidden: true };
            if (foco && a !== foco && b !== foco) return { ...base, color: comAlfa(c.apagado, 0.25) };
            if (foco) return { ...base, color: comAlfa(c.destaque, 0.85), size: base.size + 0.6, zIndex: 2 };
            return base;
          },
        });
        sigma.on("clickNode", ({ node }) => callbacks.current.onNo(node));
        sigma.on("clickEdge", ({ edge }) => callbacks.current.onLigacao(edge));
        sigma.on("clickStage", () => callbacks.current.onFundo());
        sigma.on("enterNode", ({ node }) => { ref.current.hover = node; sigma.refresh({ skipIndexation: true }); });
        sigma.on("leaveNode", () => { ref.current.hover = null; sigma.refresh({ skipIndexation: true }); });
        ref.current.sigma = sigma;
        ref.current.graph = g;
        // Arruma o grafo no worker por alguns segundos (o "organismo" se formando).
        const settings = { ...fa2.default.inferSettings(g), gravity: forcas.centro, scalingRatio: forcas.repulsao, edgeWeightInfluence: forcas.ligacao, barnesHutOptimize: g.order > 800, slowDown: 2 };
        const layout = new FA2LayoutClass(g, { settings });
        ref.current.layout = layout;
        setArrumando(true);
        layout.start();
        paraArrumar = setTimeout(() => { if (!animarRef.current) layout.stop(); setArrumando(false); callbacks.current.onArrumado?.(); }, Math.min(6000, 1500 + g.order));
      } catch (e) {
        console.error("Grafo: falha ao desenhar", e);
        if (vivo) setErro("Não foi possível desenhar o grafo neste navegador.");
      }
    })();
    return () => {
      vivo = false;
      if (paraArrumar) clearTimeout(paraArrumar);
      ref.current.layout?.kill();
      ref.current.sigma?.kill();
      ref.current = { sigma: null, graph: null, layout: null, cores: ref.current.cores, hover: null };
    };
    // As forças entram pelo efeito próprio; aqui só os dados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grafo]);

  // Animar: liga e desliga o worker.
  useEffect(() => {
    animarRef.current = animar;
    const l = ref.current.layout;
    if (!l) return;
    if (animar && !l.isRunning()) l.start();
    if (!animar && l.isRunning() && !arrumando) l.stop();
  }, [animar, arrumando]);

  // Forças: o worker é recriado com os novos parâmetros (e roda um pouco para mostrar o efeito).
  useEffect(() => {
    const g = ref.current.graph;
    if (!g) return;
    let parar: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const [fa2, { default: FA2LayoutClass }] = await Promise.all([import("graphology-layout-forceatlas2"), import("graphology-layout-forceatlas2/worker")]);
      if (ref.current.graph !== g) return;
      ref.current.layout?.kill();
      const layout = new FA2LayoutClass(g, { settings: { ...fa2.default.inferSettings(g), gravity: forcas.centro, scalingRatio: forcas.repulsao, edgeWeightInfluence: forcas.ligacao, barnesHutOptimize: g.order > 800, slowDown: 2 } });
      ref.current.layout = layout;
      layout.start();
      if (!animarRef.current) parar = setTimeout(() => layout.stop(), 2500);
    })();
    return () => { if (parar) clearTimeout(parar); };
  }, [forcas.centro, forcas.repulsao, forcas.ligacao]);

  // Seleção, destaque e opções de desenho: só redesenha.
  useEffect(() => {
    estado.current = { selecionado, destaque, opcoes };
    const s = ref.current.sigma;
    if (!s) return;
    s.setSetting("labelRenderedSizeThreshold", opcoes.limiarTexto);
    s.setSetting("defaultEdgeType", opcoes.setas ? "arrow" : "line");
    s.refresh({ skipIndexation: false });
    // Enquadra o ponto escolhido e os vizinhos dele (sem isso, as folhas ficam amontoadas na tela).
    const g = ref.current.graph;
    if (selecionado && g?.hasNode(selecionado)) {
      const pontos = [selecionado, ...g.neighbors(selecionado)].map((n) => s.getNodeDisplayData(n)).filter((d): d is NonNullable<typeof d> => Boolean(d));
      if (pontos.length) {
        const xs = pontos.map((d) => d.x), ys = pontos.map((d) => d.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const ratio = Math.min(1, Math.max(0.04, Math.max(x1 - x0, y1 - y0) * 1.5));
        s.getCamera().animate({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, ratio }, { duration: 450 });
      }
    }
  }, [selecionado, destaque, opcoes]);

  // Tema claro/escuro: relê as cores.
  useEffect(() => {
    const reler = () => { ref.current.cores = lerCores(); const s = ref.current.sigma; if (s) { s.setSetting("labelColor", { color: ref.current.cores.texto }); s.refresh(); } };
    const obs = new MutationObserver(reler);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", reler);
    return () => { obs.disconnect(); mq.removeEventListener("change", reler); };
  }, []);

  const zoom = (f: number | null) => {
    const cam = ref.current.sigma?.getCamera();
    if (!cam) return;
    if (f === null) cam.animatedReset({ duration: 300 });
    else cam.animatedZoom({ duration: 250, factor: f });
  };

  return (
    <div className="cerebro-canvas-caixa">
      <div ref={caixa} className="cerebro-canvas" role="img" aria-label={`Grafo com ${grafo.nos.length} nós e ${grafo.ligacoes.length} ligações`} />
      {erro && <p className="cerebro-canvas-erro">{erro}</p>}
      {arrumando && <span className="cerebro-arrumando">Arrumando o grafo…</span>}
      <div className="cerebro-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoom(1.5)} aria-label="Aproximar">+</button>
        <button type="button" onClick={() => zoom(1 / 1.5)} aria-label="Afastar">−</button>
        <button type="button" onClick={() => zoom(null)} aria-label="Ver o grafo inteiro">⤢</button>
      </div>
    </div>
  );
}
