"use client";

import { useEffect, useRef, useState } from "react";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type * as T3 from "three";
import type { CSS2DObject as CSS2DObjectT } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { type Subgrafo, familiaDe, tipoDe } from "../../../lib/cerebro/visual";

/**
 * A cena 3D do Segundo Cérebro (War Room): neurônios que brilham sobre um fundo de estrelas, sinapses
 * finas que somam luz onde se cruzam, impulsos correndo nas ligações e o "pulso magnético" (um anel que
 * se expande) quando algo acontece na empresa: evento de um módulo, consulta de uma SARA, ligação nova.
 *
 * Estabilidade: o arranjo (forças 3D) é calculado ANTES de aparecer e para sozinho; filtros escondem e
 * mostram pontos sem refazer o arranjo (nada pula). A câmera tem amortecimento, sensibilidade baixa, e
 * os pontos não se arrastam com o mouse. Seleção e destaque mudam só o material dos objetos, sem refazer
 * a cena; os nomes são HTML (nítidos em qualquer zoom), poucos de cada vez.
 */
export type OpcoesCena = { nomes: "hubs" | "todos" | "nenhum"; particulas: boolean; girar: boolean };
export type ApiCena = { pulsar: (nos: string[], ligacoes?: string[]) => void; centralizar: () => void; focar: (id: string) => void };
/** Espaço (px) que os painéis ocupam de cada lado: a câmera centraliza no que sobra. */
export type Margens = { esquerda: number; direita: number };

type No = { id: string; nome: string; tipo: string; grau: number; raio: number; x?: number; y?: number; z?: number };
type Lig = { id: string; source: string | No; target: string | No; familia: string; tipo: string; peso: number; __lineObj?: T3.Line };
type Visual = { grupo: T3.Group; corpo: T3.Mesh; halo: T3.Sprite | null; cor: string; raio: number };

type Props = {
  grafo: Subgrafo;
  visiveis: { tipos: Set<string>; familias: Set<string>; desde: string | null };
  selecionado: string | null;
  opcoes: OpcoesCena;
  margens: Margens;
  onNo: (id: string | null) => void;
  onLigacao: (id: string) => void;
  onApi: (api: ApiCena | null) => void;
};

type Libs = { THREE: typeof T3; CSS2DObject: typeof CSS2DObjectT };

const FUNDO = "#05080f";
const ponta = (v: string | No) => (typeof v === "string" ? v : v.id);
const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
// Tamanho do neurônio pelo número de ligações: as folhas ficam pequenas, os centros se destacam.
const raioDe = (grau: number) => (grau <= 1 ? 2.2 : 2.6 + Math.cbrt(Math.min(400, grau)) * 2.1);

/** Textura de brilho (halo) e de anel (pulso), desenhadas uma vez num canvas. */
function texturas(THREE: typeof T3) {
  const halo = document.createElement("canvas");
  halo.width = halo.height = 128;
  const h = halo.getContext("2d")!;
  const gr = h.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.18, "rgba(255,255,255,0.45)"); gr.addColorStop(0.45, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  h.fillStyle = gr; h.fillRect(0, 0, 128, 128);
  const anel = document.createElement("canvas");
  anel.width = anel.height = 256;
  const a = anel.getContext("2d")!;
  const ga = a.createRadialGradient(128, 128, 84, 128, 128, 126);
  ga.addColorStop(0, "rgba(255,255,255,0)"); ga.addColorStop(0.55, "rgba(255,255,255,0.95)"); ga.addColorStop(0.7, "rgba(255,255,255,0.35)"); ga.addColorStop(1, "rgba(255,255,255,0)");
  a.fillStyle = ga; a.fillRect(0, 0, 256, 256);
  const t1 = new THREE.CanvasTexture(halo), t2 = new THREE.CanvasTexture(anel);
  t1.colorSpace = t2.colorSpace = THREE.SRGBColorSpace;
  return { halo: t1, anel: t2 };
}

export function Cena3D({ grafo, visiveis, selecionado, opcoes, margens, onNo, onLigacao, onApi }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const g = useRef<ForceGraph3DInstance | null>(null);
  const libs = useRef<Libs | null>(null);
  const recursos = useRef<{ esfera: T3.SphereGeometry; halo: T3.Texture; anel: T3.Texture; mat: Map<string, T3.Material>; extras: T3.Group } | null>(null);
  const estado = useRef({
    selecionado, hover: null as string | null, visiveis, opcoes, margens, desloc: 0,
    vizinhos: new Map<string, Set<string>>(), pulsando: new Map<string, number>(), hubs: new Set<string>(), ordem: [] as string[], posto: new Map<string, number>(),
    visuais: new Map<string, Visual>(), rotulos: new Map<string, CSS2DObjectT>(), enquadrar: true, emFoco: false, carga: 0,
  });
  const posicoes = useRef(new Map<string, { x: number; y: number; z: number }>());
  const cb = useRef({ onNo, onLigacao, onApi });
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);
  useEffect(() => { cb.current = { onNo, onLigacao, onApi }; }, [onNo, onLigacao, onApi]);

  // A seleção manda; passar o mouse só destaca quando nada está escolhido (e sempre mostra o nome).
  const focoAtual = () => estado.current.selecionado ?? estado.current.hover;
  const visivelNo = (n: No) => estado.current.visiveis.tipos.has(n.tipo) || n.id === estado.current.selecionado;
  const ligDoFoco = (l: Lig, foco: string | null) => Boolean(foco) && (ponta(l.source) === foco || ponta(l.target) === foco);

  /** Materiais compartilhados: um por cor e estado (vivo, apagado, foco, pulso). */
  function matNo(cor: string, modo: "vivo" | "apagado" | "foco" | "pulso") {
    const r = recursos.current!, THREE = libs.current!.THREE, k = `n|${cor}|${modo}`;
    let m = r.mat.get(k);
    if (!m) {
      const c = new THREE.Color(cor);
      m = modo === "vivo" ? new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.26 })
        : modo === "foco" ? new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color("#ffffff"), 0.2) })
        : modo === "pulso" ? new THREE.MeshBasicMaterial({ color: "#ffffff" })
        : new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color("#1a2236"), 0.72), transparent: true, opacity: 0.22, depthWrite: false });
      r.mat.set(k, m);
    }
    return m;
  }
  function matHalo(cor: string, forte: boolean) {
    const r = recursos.current!, THREE = libs.current!.THREE, k = `h|${cor}|${forte}`;
    let m = r.mat.get(k);
    if (!m) { m = new THREE.SpriteMaterial({ map: r.halo, color: cor, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: forte ? 0.6 : 0.3 }); r.mat.set(k, m); }
    return m as T3.SpriteMaterial;
  }
  /** Sinapses: linhas que somam luz (as que se cruzam brilham mais). */
  function matLig(familia: string, modo: "base" | "foco" | "apagado") {
    // Muitas linhas chegando ao mesmo ponto somam luz até estourar em branco: a intensidade cai com a quantidade.
    const n = modo === "foco" ? estado.current.vizinhos.get(focoAtual() ?? "")?.size ?? 1 : (g.current?.graphData().links.length ?? 1);
    const nivel = modo === "foco" ? (n > 600 ? 0.09 : n > 150 ? 0.3 : n > 50 ? 0.6 : 0.9) : modo === "base" ? (n > 2500 ? 0.1 : n > 1200 ? 0.15 : 0.2) : 0.03;
    const r = recursos.current!, THREE = libs.current!.THREE, k = `l|${familia}|${modo}|${nivel}`;
    let m = r.mat.get(k);
    if (!m) {
      const base = new THREE.Color(familiaDe(familia).neuro);
      m = new THREE.LineBasicMaterial({
        color: modo === "foco" ? base.clone().lerp(new THREE.Color("#ffffff"), 0.25) : base,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        opacity: nivel,
      });
      r.mat.set(k, m);
    }
    return m;
  }
  const modoLig = (l: Lig) => {
    const foco = focoAtual();
    return !foco ? "base" : ligDoFoco(l, foco) ? "foco" : "apagado";
  };

  /** Repinta pontos, halos, ligações e nomes conforme o foco (sem refazer objetos da biblioteca). */
  function pintar() {
    const fg = g.current, L = libs.current, r = recursos.current;
    if (!fg || !L || !r) return;
    const e = estado.current;
    const foco = focoAtual();
    const viz = foco ? e.vizinhos.get(foco) : undefined;
    const agora = Date.now();
    for (const [id, v] of e.visuais) {
      const pulso = (e.pulsando.get(id) ?? 0) > agora;
      const vivo = !foco || id === foco || Boolean(viz?.has(id));
      const modo = pulso ? "pulso" : foco && id === foco ? "foco" : vivo ? "vivo" : "apagado";
      v.corpo.material = matNo(v.cor, modo);
      v.corpo.scale.setScalar(v.raio * (modo === "apagado" ? 0.75 : modo === "foco" ? 1.3 : 1));
      // No isolamento os vizinhos já estão em primeiro plano: halo só no centro (e nos pulsos).
      const querHalo = pulso || (foco ? id === foco || (!e.emFoco && Boolean(viz?.has(id)) && (viz?.size ?? 0) <= 120) : e.hubs.has(id));
      if (querHalo && !v.halo) {
        v.halo = new L.THREE.Sprite(matHalo(v.cor, true));
        v.grupo.add(v.halo);
      }
      if (v.halo) {
        // Halo forte só no foco, nos pulsos e nos centros da visão geral; vizinhos ganham um brilho leve.
        const forte = pulso || id === foco || !foco;
        v.halo.visible = querHalo;
        v.halo.material = matHalo(v.cor, forte);
        v.halo.scale.setScalar(v.raio * (id === foco ? 6.5 : pulso ? 7 : forte ? 5 : 3.4));
      }
    }
    for (const l of fg.graphData().links as Lig[]) if (l.__lineObj) l.__lineObj.material = matLig(l.familia, modoLig(l));
    rotular();
  }

  /** Quem ganha nome: o foco e os vizinhos (se forem poucos) ou os principais da visão geral. */
  function rotular() {
    const fg = g.current, L = libs.current, r = recursos.current;
    if (!fg || !L || !r) return;
    const e = estado.current;
    const foco = focoAtual();
    const viz = foco ? e.vizinhos.get(foco) : undefined;
    const porId = new Map((fg.graphData().nodes as No[]).map((n) => [n.id, n]));
    const querem = new Set<string>();
    if (e.hover) querem.add(e.hover);
    if (foco) {
      querem.add(foco);
      if (viz && viz.size <= 28) for (const id of viz) querem.add(id);
    } else if (e.opcoes.nomes !== "nenhum") {
      const limite = e.opcoes.nomes === "todos" ? 160 : 16;
      for (const id of e.ordem) {
        const n = porId.get(id);
        if (n && visivelNo(n)) querem.add(id);
        if (querem.size >= limite) break;
      }
    }
    for (const [id, o] of e.rotulos) if (!querem.has(id) || !porId.get(id) || !visivelNo(porId.get(id)!)) { r.extras.remove(o); e.rotulos.delete(id); }
    for (const id of querem) {
      const n = porId.get(id);
      if (!n || !visivelNo(n) || n.x === undefined) continue;
      let o = e.rotulos.get(id);
      if (!o) {
        const div = document.createElement("div");
        div.className = "neuro-rotulo";
        div.innerHTML = `<i style="background:${tipoDe(n.tipo).neuro}"></i><span>${escapar(n.nome)}</span>`;
        o = new L.CSS2DObject(div);
        o.center.set(0.5, 1);
        r.extras.add(o);
        e.rotulos.set(id, o);
      }
      o.element.classList.toggle("foco", id === foco);
      o.position.set(n.x, (n.y ?? 0) + n.raio * (id === foco ? 1.3 : 1) + 2.5, n.z ?? 0);
    }
  }

  /** Nomes que se sobrepõem na tela: fica o do ponto mais ligado (o do foco sempre fica). */
  function arrumarRotulos() {
    const fg = g.current, el = caixa.current;
    const e = estado.current;
    if (!fg || !el || !e.rotulos.size) return;
    const cam = fg.camera() as T3.PerspectiveCamera;
    const w = el.clientWidth, h = el.clientHeight, foco = focoAtual();
    const ordem = [...e.rotulos.entries()].sort((a, b) => (a[0] === foco ? -1 : b[0] === foco ? 1 : (e.posto.get(a[0]) ?? 1e9) - (e.posto.get(b[0]) ?? 1e9)));
    const caixas: [number, number, number, number][] = [];
    for (const [, o] of ordem) {
      const v = o.position.clone().project(cam);
      if (v.z > 1) continue;
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      const bw = o.element.offsetWidth + 6, bh = o.element.offsetHeight + 4;
      const c: [number, number, number, number] = [x - bw / 2, y - bh, x + bw / 2, y];
      const bate = caixas.some((k) => c[0] < k[2] && c[2] > k[0] && c[1] < k[3] && c[3] > k[1]);
      o.element.style.opacity = bate ? "0" : "";
      if (!bate) caixas.push(c);
    }
  }

  // Monta a cena uma vez.
  useEffect(() => {
    let vivo = true;
    let observador: ResizeObserver | null = null;
    const st = estado.current;
    const arrumar = setInterval(arrumarRotulos, 300);
    (async () => {
      try {
        const [{ default: ForceGraph3D }, THREE, { UnrealBloomPass }, { CSS2DRenderer, CSS2DObject }, d3] = await Promise.all([
          import("3d-force-graph"), import("three"), import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
          import("three/examples/jsm/renderers/CSS2DRenderer.js"), import("d3-force-3d"),
        ]);
        if (!vivo || !caixa.current) return;
        libs.current = { THREE, CSS2DObject };
        const tx = texturas(THREE);
        const extras = new THREE.Group();
        recursos.current = { esfera: new THREE.SphereGeometry(1, 18, 14), halo: tx.halo, anel: tx.anel, mat: new Map(), extras };
        const el = caixa.current;
        const fg = new ForceGraph3D(el, { controlType: "orbit", extraRenderers: [new CSS2DRenderer() as never], rendererConfig: { antialias: true, powerPreference: "high-performance" } });
        g.current = fg;
        fg.width(el.clientWidth).height(el.clientHeight).backgroundColor(FUNDO).showNavInfo(false).enableNodeDrag(false)
          .nodeId("id")
          .nodeLabel((n) => {
            const no = n as No;
            return `<div class="neuro-tip"><i style="background:${tipoDe(no.tipo).neuro}"></i><b>${escapar(no.nome)}</b><small>${escapar(tipoDe(no.tipo).singular)} · ${no.grau} ligações</small></div>`;
          })
          .nodeThreeObjectExtend(false)
          .nodeThreeObject((n) => {
            const no = n as No;
            const r = recursos.current!;
            const grupo = new THREE.Group();
            const cor = tipoDe(no.tipo).neuro;
            const corpo = new THREE.Mesh(r.esfera, matNo(cor, "vivo"));
            corpo.scale.setScalar(no.raio);
            grupo.add(corpo);
            estado.current.visuais.set(no.id, { grupo, corpo, halo: null, cor, raio: no.raio });
            return grupo;
          })
          .linkSource("source").linkTarget("target")
          .linkWidth(0)
          .linkMaterial((l) => matLig((l as Lig).familia, modoLig(l as Lig)))
          .linkDirectionalParticles((l) => {
            const lig = l as Lig;
            const sel = estado.current.selecionado;
            if (ligDoFoco(lig, sel)) {
              // Muitas ligações no foco: impulsos em uma de cada ~12, para não virar neblina.
              const n = estado.current.vizinhos.get(sel ?? "")?.size ?? 0;
              return n <= 150 ? 3 : lig.id.charCodeAt(lig.id.length - 1) % 12 === 0 ? 1 : 0;
            }
            return estado.current.opcoes.particulas && !estado.current.selecionado && (lig.familia === "dependencia" || lig.peso > 2.2) ? 1 : 0;
          })
          .linkDirectionalParticleSpeed((l) => 0.003 + Math.min(0.006, (l as Lig).peso * 0.0007))
          .linkDirectionalParticleWidth((l) => ((l as Lig).familia === "dependencia" ? 1.7 : 1.3))
          .linkDirectionalParticleColor((l) => familiaDe((l as Lig).familia).neuro)
          .linkDirectionalParticleResolution(6)
          .nodeVisibility((n) => visivelNo(n as No))
          .linkVisibility((l) => {
            const lig = l as Lig;
            const v = estado.current.visiveis;
            const a = typeof lig.source === "string" ? null : lig.source, b = typeof lig.target === "string" ? null : lig.target;
            return v.familias.has(lig.familia) && (!a || visivelNo(a)) && (!b || visivelNo(b));
          })
          .onNodeClick((n) => cb.current.onNo((n as No).id))
          .onLinkClick((l) => cb.current.onLigacao((l as Lig).id))
          .onBackgroundClick(() => cb.current.onNo(null))
          .onNodeHover((n) => {
            const id = n ? (n as No).id : null;
            if (estado.current.hover === id) return;
            estado.current.hover = id;
            el.style.cursor = id ? "pointer" : "grab";
            pintar();
          })
          .onEngineTick(() => { if (estado.current.rotulos.size) rotular(); })
          // Arranjo: calculado quase todo ANTES de aparecer (ver carregar) e para sozinho, sem "pular".
          .warmupTicks(260).cooldownTicks(40).d3AlphaDecay(0.035).d3VelocityDecay(0.45);
        const carga = fg.d3Force("charge") as unknown as { strength: (f: (n: No) => number) => unknown } | undefined;
        carga?.strength((n) => -30 - Math.sqrt(n.grau) * 9);
        const ligForca = fg.d3Force("link") as unknown as { distance: (f: (l: Lig) => number) => unknown } | undefined;
        // Conjuntos pequenos (isolamento) ficam mais espaçados: os pontos não se amontoam na tela.
        ligForca?.distance((l) => {
          const n = fg.graphData().nodes.length, k = n < 60 ? 1.9 : n < 300 ? 1.3 : 1;
          return k * (l.familia === "estrutura" ? 24 : l.familia === "dependencia" ? 62 : 42);
        });
        // Grupos soltos não fogem para longe (a câmera enquadra o organismo, não os satélites).
        fg.d3Force("x", d3.forceX(0).strength(0.05) as never).d3Force("y", d3.forceY(0).strength(0.05) as never).d3Force("z", d3.forceZ(0).strength(0.05) as never);

        // Câmera mais suave e menos sensível.
        const c = fg.controls() as { enableDamping?: boolean; dampingFactor?: number; rotateSpeed?: number; zoomSpeed?: number; panSpeed?: number; autoRotate?: boolean; autoRotateSpeed?: number };
        Object.assign(c, { enableDamping: true, dampingFactor: 0.07, rotateSpeed: 0.4, zoomSpeed: 0.55, panSpeed: 0.45, autoRotate: estado.current.opcoes.girar, autoRotateSpeed: 0.22 });
        const cam = fg.camera() as T3.PerspectiveCamera;
        cam.far = 30000;
        cam.position.set(0, 300, 5200);

        // Profundidade, estrelas e brilho.
        const cena = fg.scene();
        cena.add(extras);
        cena.fog = new THREE.FogExp2(FUNDO, 0.00022);
        const estrela = (n: number, r0: number, r1: number, tam: number, op: number, cor: string) => {
          const geo = new THREE.BufferGeometry();
          const pos = new Float32Array(n * 3);
          for (let i = 0; i < pos.length; i += 3) {
            const r = r0 + Math.random() * (r1 - r0), t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
            pos[i] = r * Math.sin(p) * Math.cos(t); pos[i + 1] = r * Math.sin(p) * Math.sin(t); pos[i + 2] = r * Math.cos(p);
          }
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          cena.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: cor, size: tam, sizeAttenuation: true, transparent: true, opacity: op, fog: false, depthWrite: false })));
        };
        estrela(2600, 2600, 5200, 3.2, 0.5, "#8fa3c7");
        estrela(500, 2600, 5200, 6, 0.35, "#b9c8ff");
        // Brilho só no que é claro (centros, foco, pulsos): as cores normais não estouram.
        const brilho = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.7, 0.5, 0.76);
        fg.postProcessingComposer().addPass(brilho);

        fg.onEngineStop(() => {
          for (const n of fg.graphData().nodes as No[]) if (n.x !== undefined) posicoes.current.set(n.id, { x: n.x, y: n.y ?? 0, z: n.z ?? 0 });
          // Dados novos (visão geral ou foco): enquadra uma vez, quando o arranjo assenta.
          if (estado.current.enquadrar) {
            estado.current.enquadrar = false;
            pintar();
            enquadrar(1400);
            setPronto(true);
          }
        });
        observador = new ResizeObserver(() => {
          fg.width(el.clientWidth).height(el.clientHeight);
          brilho.setSize(el.clientWidth, el.clientHeight);
          aplicarDeslocamento();
        });
        observador.observe(el);
        cb.current.onApi({
          pulsar: (nos, ligacoes = []) => pulsar(nos, ligacoes),
          centralizar: () => enquadrar(1000),
          focar: (id) => focar(id),
        });
        carregar(grafo);
        moverDeslocamento();
      } catch (e) {
        console.error("Cena 3D: falha", e);
        if (vivo) setErro("Este navegador não conseguiu abrir a cena 3D (WebGL).");
      }
    })();
    return () => {
      vivo = false;
      clearInterval(arrumar);
      observador?.disconnect();
      cb.current.onApi(null);
      for (const o of st.rotulos.values()) o.element.remove();
      st.rotulos.clear();
      g.current?._destructor();
      g.current = null;
      for (const m of recursos.current?.mat.values() ?? []) m.dispose();
      recursos.current?.esfera.dispose();
    };
    // A cena nasce uma vez; dados, filtros e seleção entram pelos efeitos abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Centraliza a imagem na área livre (sem o painel aberto), deslocando a câmera de lado. */
  function aplicarDeslocamento() {
    const fg = g.current, el = caixa.current;
    if (!fg || !el) return;
    const cam = fg.camera() as T3.PerspectiveCamera;
    const w = el.clientWidth, h = el.clientHeight, d = estado.current.desloc;
    if (Math.abs(d) < 0.5) cam.clearViewOffset();
    else cam.setViewOffset(w, h, d, 0, w, h);
    cam.updateProjectionMatrix();
  }
  function moverDeslocamento() {
    const alvo = (estado.current.margens.direita - estado.current.margens.esquerda) / 2;
    const de = estado.current.desloc, t0 = performance.now();
    if (Math.abs(alvo - de) < 0.5) return;
    const passo = (t: number) => {
      const k = Math.min(1, (t - t0) / 420), s = 1 - (1 - k) ** 3;
      estado.current.desloc = de + (alvo - de) * s;
      aplicarDeslocamento();
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  /** Distância da câmera para que uma esfera de raio r caiba na área livre. */
  function distanciaPara(raio: number) {
    const fg = g.current, el = caixa.current;
    if (!fg || !el) return 600;
    const cam = fg.camera() as T3.PerspectiveCamera;
    const m = estado.current.margens;
    const livre = Math.max(240, el.clientWidth - m.esquerda - m.direita);
    const vf = (cam.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * (livre / Math.max(1, el.clientHeight)));
    return raio / Math.sin(Math.min(vf, hf) / 2);
  }
  function voar(centro: { x: number; y: number; z: number }, dist: number, ms: number) {
    const fg = g.current, L = libs.current;
    if (!fg || !L) return;
    const cam = fg.camera() as T3.PerspectiveCamera;
    const alvo = (fg.controls() as { target?: T3.Vector3 }).target ?? new L.THREE.Vector3();
    const dir = cam.position.clone().sub(alvo);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.15, 1);
    dir.normalize();
    fg.cameraPosition({ x: centro.x + dir.x * dist, y: centro.y + dir.y * dist, z: centro.z + dir.z * dist }, centro, ms);
  }

  /** Enquadra o que está visível: na visão geral ignora os 5% mais afastados; no foco, cabe tudo. */
  function enquadrar(ms: number) {
    const fg = g.current;
    if (!fg) return;
    const nos = (fg.graphData().nodes as No[]).filter((n) => n.x !== undefined && visivelNo(n));
    if (!nos.length) return;
    let cx = 0, cy = 0, cz = 0;
    for (const n of nos) { cx += n.x!; cy += n.y ?? 0; cz += n.z ?? 0; }
    cx /= nos.length; cy /= nos.length; cz /= nos.length;
    const d = nos.map((n) => Math.hypot(n.x! - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz) + n.raio).sort((a, b) => a - b);
    const raio = Math.max(40, estado.current.emFoco ? d[d.length - 1] : d[Math.floor((d.length - 1) * 0.95)]);
    voar({ x: cx, y: cy, z: cz }, distanciaPara(raio) * (estado.current.emFoco ? 1.08 : 1.02), ms);
  }

  /** Vai até o ponto escolhido, com os vizinhos dele no quadro. */
  function focar(id: string) {
    const fg = g.current;
    const nos = (fg?.graphData().nodes as No[] | undefined) ?? [];
    const n = nos.find((x) => x.id === id);
    if (!fg || !n || n.x === undefined) return;
    const viz = estado.current.vizinhos.get(id) ?? new Set<string>();
    const d = nos.filter((x) => viz.has(x.id) && x.x !== undefined).map((x) => Math.hypot(x.x! - n.x!, (x.y ?? 0) - (n.y ?? 0), (x.z ?? 0) - (n.z ?? 0))).sort((a, b) => a - b);
    const raio = Math.min(420, Math.max(120, d.length ? d[Math.floor((d.length - 1) * 0.9)] + 30 : 120));
    voar({ x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, distanciaPara(raio) * 1.1, 1300);
  }

  /** O "pulso magnético": anéis que se expandem nos pontos e impulsos correndo nas ligações. */
  function pulsar(nos: string[], ligacoes: string[]) {
    const fg = g.current, L = libs.current, r = recursos.current;
    if (!fg || !L || !r) return;
    const todas = fg.graphData().links as Lig[];
    const alvo = new Set(nos);
    const escolhidas = todas.filter((l) => ligacoes.includes(l.id) || alvo.has(ponta(l.source)) || alvo.has(ponta(l.target))).slice(0, 160);
    for (let rodada = 0; rodada < 3; rodada++) setTimeout(() => { for (const l of escolhidas) fg.emitParticle(l); }, rodada * 240);
    const ids = new Set([...alvo, ...escolhidas.filter((l) => ligacoes.includes(l.id)).flatMap((l) => [ponta(l.source), ponta(l.target)])]);
    const ate = Date.now() + 1500;
    const porId = new Map((fg.graphData().nodes as No[]).map((n) => [n.id, n]));
    let aneis = 0;
    for (const id of ids) {
      estado.current.pulsando.set(id, ate);
      const n = porId.get(id);
      if (!n || n.x === undefined || aneis >= 14) continue;
      aneis++;
      for (const atraso of [0, 380]) {
        const m = new L.THREE.SpriteMaterial({ map: r.anel, color: tipoDe(n.tipo).neuro, blending: L.THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
        const s = new L.THREE.Sprite(m);
        s.position.set(n.x, n.y ?? 0, n.z ?? 0);
        r.extras.add(s);
        const t0 = performance.now() + atraso;
        const passo = (t: number) => {
          const k = (t - t0) / 1700;
          if (k < 0) { requestAnimationFrame(passo); return; }
          if (k >= 1) { r.extras.remove(s); m.dispose(); return; }
          s.scale.setScalar(n.raio * 2 + 150 * (1 - (1 - k) ** 2));
          m.opacity = 0.95 * (1 - k) ** 1.4;
          requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
      }
    }
    pintar();
    setTimeout(() => {
      for (const [id, t] of estado.current.pulsando) if (t <= Date.now()) estado.current.pulsando.delete(id);
      pintar();
    }, 1600);
  }

  function carregar(s: Subgrafo) {
    const fg = g.current;
    if (!fg) return;
    // No foco (isolar, caminho, dependências) o arranjo é novo, em volta do centro; na visão geral, as
    // posições anteriores continuam (nada pula ao voltar).
    const emFoco = Boolean(s.centro);
    const e = estado.current;
    e.emFoco = emFoco;
    const anteriores = new Map((fg.graphData().nodes as No[]).map((n) => [n.id, n]));
    const nos: No[] = s.nos.map((n) => {
      const p = emFoco ? undefined : anteriores.get(n.id) ?? posicoes.current.get(n.id);
      return { id: n.id, nome: n.nome, tipo: n.tipo, grau: n.grau, raio: raioDe(n.grau), ...(p?.x !== undefined ? { x: p.x, y: p.y, z: p.z } : {}) };
    });
    const ids = new Set(nos.map((n) => n.id));
    const ligs: Lig[] = s.ligacoes.filter((l) => ids.has(l.origem) && ids.has(l.destino))
      .map((l) => ({ id: l.id, source: l.origem, target: l.destino, familia: l.familia, tipo: l.tipo, peso: Math.log10(1 + (l.quantidade ?? 1)) * 2 }));
    const viz = new Map<string, Set<string>>();
    for (const l of ligs) {
      const a = l.source as string, b = l.target as string;
      (viz.get(a) ?? viz.set(a, new Set()).get(a)!).add(b);
      (viz.get(b) ?? viz.set(b, new Set()).get(b)!).add(a);
    }
    e.vizinhos = viz;
    e.ordem = [...nos].sort((a, b) => b.grau - a.grau).map((n) => n.id);
    e.posto = new Map(e.ordem.map((id, i) => [id, i]));
    e.hubs = new Set(e.ordem.slice(0, emFoco ? 6 : 48));
    for (const o of e.rotulos.values()) recursos.current?.extras.remove(o);
    e.rotulos.clear();
    e.visuais.clear();
    e.enquadrar = true;
    setPronto(false);
    // O arranjo roda de uma vez (sem desenhar); antes, deixa o aviso "Formando as conexões" aparecer.
    // Grafo muito grande calcula um pouco menos aqui e termina nos primeiros quadros.
    const carga = ++e.carga;
    fg.warmupTicks(nos.length > 2500 ? 170 : 260);
    requestAnimationFrame(() => setTimeout(() => { if (carga === estado.current.carga) fg.graphData({ nodes: nos, links: ligs }); }, 0));
  }

  // Dados novos (visão geral ou foco).
  useEffect(() => { carregar(grafo); }, [grafo]);

  // Painéis abriram ou fecharam: a imagem desliza para o centro da área livre.
  useEffect(() => {
    estado.current.margens = margens;
    moverDeslocamento();
    // As funções da cena leem o estado pelo ref; só os painéis disparam este efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margens]);

  // Filtros, seleção e opções: só redesenha (posições ficam).
  useEffect(() => {
    const e = estado.current;
    const mudouSel = e.selecionado !== selecionado;
    const mudouVis = e.visiveis !== visiveis;
    const mudouPart = e.opcoes.particulas !== opcoes.particulas;
    e.visiveis = visiveis;
    e.selecionado = selecionado;
    e.opcoes = opcoes;
    const fg = g.current;
    if (!fg) return;
    if (mudouVis) fg.nodeVisibility(fg.nodeVisibility()).linkVisibility(fg.linkVisibility());
    if (mudouSel || mudouPart || mudouVis) fg.linkDirectionalParticles(fg.linkDirectionalParticles());
    const c = fg.controls() as { autoRotate?: boolean };
    c.autoRotate = opcoes.girar && !selecionado;
    pintar();
    // A biblioteca refaz os objetos escondidos/mostrados no quadro seguinte: repinta de novo depois.
    if (mudouVis) setTimeout(pintar, 40);
    // Na visão geral, a câmera vai até o ponto escolhido; no foco, ela já enquadra o conjunto.
    if (mudouSel && selecionado && !e.emFoco) focar(selecionado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis, selecionado, opcoes]);

  return (
    <div className="neuro-cena">
      <div ref={caixa} className="neuro-canvas" aria-label={`Grafo 3D com ${grafo.nos.length} pontos e ${grafo.ligacoes.length} ligações`} />
      <div className="neuro-vinheta" aria-hidden />
      {!pronto && !erro && <div className="neuro-carregando"><span />Formando as conexões…</div>}
      {erro && <p className="neuro-erro">{erro}</p>}
    </div>
  );
}
