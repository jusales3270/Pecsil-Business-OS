/**
 * Motor do holograma da SARA central (E7): esfera volumétrica de partículas em canvas, composição aditiva,
 * âmbar sobre preto. Porte do "SaraLive" criado pelo proprietário (saraholo.zip, 23/10/2026), sem mudar o
 * desenho: cada partícula orbita num plano próprio no espaço 3D (7 bandas inclinadas em ângulo áureo,
 * como um giroscópio), com perspectiva, oclusão pelo núcleo e ordenação por profundidade. Quatro estados,
 * com transição suave entre eles:
 *   parada    → órbitas e fagulhas;
 *   escutando → cometas absorvidos pelo núcleo e sonar ao contrário;
 *   pensando  → constelação de nós no volume, com relâmpagos;
 *   falando   → cascas de choque por palavra, equalizador e fagulhas.
 * Só desenho: o componente (SaraHolograma.tsx) cuida da conversa, da voz e dos estados.
 */

export type EstadoHolo = "idle" | "listening" | "thinking" | "speaking";

const PALETA = ["#FFB54D", "#FF8C1A", "#FFD591", "#C25607", "#FFEDC4", "#FF7A00"];
const N_ARCOS = 42;
const N_NOS = 13;
const cor = () => PALETA[Math.floor(Math.random() * PALETA.length)];

type Base = [number, number, number, number, number, number];
type Particula = { a: number; r: number; sp: number; sz: number; al: number; col: string; wf: number; ph: number; streak: boolean; cl: number; cm: number; B: Base; ps: number; pz: number; tx: number; ty: number };
type Arco = { r: number; a: number; len: number; w: number; sp: number; col: string; al: number; B: Base };
type Anel = { B: Base; r: number; step: number };
type No = { f1: number; f2: number; f3: number; p1: number; p2: number; p3: number; x: number; y: number; z: number; sx: number; sy: number };
type Dir = { dx: number; dy: number; dz: number };

export type Sistema = {
  parts: Particula[]; arcs: Arco[]; tickRings: Anel[]; nodes: No[];
  flares: (Dir & { r0: number; len: number; life: number })[];
  waves: { r: number; v: number; band: number; str: number; life: number }[];
  sparks: (Dir & { r: number; v: number; life: number; col: string })[];
  comets: (Dir & { th: number; ph: number; r: number; v: number; sw: number; col: string })[];
  rings: { r: number; life: number; B: Base }[];
  bolts: { pts: [number, number][]; life: number }[];
  coreFlash: number; sonarClock: number; lastWave: number;
};

/** O que muda a cada quadro (fica num ref do componente, sem recriar nada). */
export type Pulso = {
  estado: EstadoHolo; t: number; amp: number; fala: number;
  pesos: Record<EstadoHolo, number>;
  rot: { y: number; x: number; vy: number; dragY: number; dragX: number };
};

export const novoPulso = (): Pulso => ({ estado: "idle", t: 0, amp: 0.14, fala: 0, pesos: { idle: 1, listening: 0, thinking: 0, speaking: 0 }, rot: { y: 0, x: -0.28, vy: 0.0016, dragY: 0, dragX: 0 } });

/** Base ortonormal (u, v) do plano orbital a partir da normal n. */
function base(nx: number, ny: number, nz: number): Base {
  const l0 = Math.hypot(nx, ny, nz) || 1;
  nx /= l0; ny /= l0; nz /= l0;
  let ux: number, uy: number, uz: number;
  if (Math.abs(nz) < 0.9) { ux = -ny; uy = nx; uz = 0; } else { ux = 0; uy = -nz; uz = ny; }
  const l = Math.hypot(ux, uy, uz) || 1;
  ux /= l; uy /= l; uz /= l;
  return [ux, uy, uz, ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux];
}

export function criarSistema(nParticulas = 2200): Sistema {
  const bandas: [number, number, number][] = [];
  for (let b = 0; b < 7; b++) {
    const th = b * 2.399963, ph = Math.acos(1 - (2 * (b + 0.5)) / 7);
    bandas.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]);
  }
  const parts: Particula[] = [];
  for (let i = 0; i < nParticulas; i++) {
    const band = Math.floor(Math.random() * 7);
    const [bx, by, bz] = bandas[band];
    parts.push({
      a: Math.random() * Math.PI * 2, r: 0.24 + band * 0.115 + (Math.random() - 0.5) * 0.09,
      sp: (band % 2 ? -1 : 1) * (0.0016 + Math.random() * 0.003) * (1 + band * 0.12), sz: 0.5 + Math.random() * 1.9, al: 0.15 + Math.random() * 0.6,
      col: cor(), wf: 0.4 + Math.random() * 1.6, ph: Math.random() * Math.PI * 2, streak: Math.random() < 0.12,
      cl: Math.random() < 0.55 ? Math.floor(Math.random() * N_NOS) : -1, cm: 0.5 + Math.random() * 0.45,
      B: base(bx + (Math.random() - 0.5) * 0.5, by + (Math.random() - 0.5) * 0.5, bz + (Math.random() - 0.5) * 0.5), ps: 1, pz: 0, tx: 0, ty: 0,
    });
  }
  const arcs: Arco[] = [];
  for (let i = 0; i < N_ARCOS; i++) {
    const [bx, by, bz] = bandas[i % 7];
    arcs.push({ r: 0.28 + Math.random() * 0.74, a: Math.random() * Math.PI * 2, len: 0.15 + Math.random() * 1.5, w: 0.5 + Math.random() * 1.6,
      sp: (Math.random() < 0.5 ? -1 : 1) * (0.001 + Math.random() * 0.004), col: cor(), al: 0.1 + Math.random() * 0.4,
      B: base(bx + (Math.random() - 0.5) * 0.6, by + (Math.random() - 0.5) * 0.6, bz + (Math.random() - 0.5) * 0.6) });
  }
  const tickRings: Anel[] = [0, 1, 2].map((i) => {
    const th = i * 2.1 + 0.7, ph = 0.5 + i * 0.75;
    return { B: base(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)), r: 0.5 + i * 0.24, step: 1 + i };
  });
  const nodes: No[] = [];
  for (let i = 0; i < N_NOS; i++) {
    nodes.push({ f1: 0.11 + Math.random() * 0.22, f2: 0.09 + Math.random() * 0.24, f3: 0.08 + Math.random() * 0.2,
      p1: Math.random() * Math.PI * 2, p2: Math.random() * Math.PI * 2, p3: Math.random() * Math.PI * 2, x: 0, y: 0, z: 0, sx: 0, sy: 0 });
  }
  return { parts, arcs, tickRings, nodes, flares: [], waves: [], sparks: [], comets: [], rings: [], bolts: [], coreFlash: 0, sonarClock: 0, lastWave: -1 };
}

const direcao = (): Dir => { const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); return { dx: Math.sin(ph) * Math.cos(th), dy: Math.cos(ph), dz: Math.sin(ph) * Math.sin(th) }; };

/** Desenha um quadro. W e H em pixels CSS (o contexto já está na escala do dispositivo). */
export function desenhar(ctx: CanvasRenderingContext2D, W: number, H: number, sys: Sistema, p: Pulso) {
  const { parts, arcs, tickRings, nodes } = sys;
  p.t += 0.016;
  const t = p.t;
  const w = p.pesos;
  for (const k of ["idle", "listening", "thinking", "speaking"] as EstadoHolo[]) w[k] += ((p.estado === k ? 1 : 0) - w[k]) * 0.05;
  const wl = w.listening, wt = w.thinking, ws = w.speaking;
  const alvo = 0.14 + wl * 0.16 + wt * 0.36 + ws * 0.22 + p.fala * 0.6;
  p.fala *= 0.88;
  p.amp += (alvo - p.amp) * 0.08;
  const A = p.amp;

  // Rotação da esfera: gira sozinha (pensa mais rápido) e segue o arraste, com inércia.
  const rot = p.rot;
  rot.vy += (0.0016 + wt * 0.0022 - rot.vy) * 0.02;
  rot.y += rot.vy + rot.dragY;
  rot.x = Math.max(-1.2, Math.min(1.2, rot.x + rot.dragX));
  rot.dragY *= 0.86; rot.dragX *= 0.86;
  const cY = Math.cos(rot.y), sY = Math.sin(rot.y), cX = Math.cos(rot.x), sX = Math.sin(rot.x);
  const girar = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
    return [x1, y * cX - z1 * sX, y * sX + z1 * cX];
  };

  // Rastro: apaga 26% do quadro anterior (fica o rastro das partículas) sem pintar fundo: o canvas segue
  // transparente, e a esfera flutua sobre a tela (no canto, minimizada, não vira um quadrado escuro).
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.4 * (0.93 + A * 0.16);
  const FOV = R * 3.0, CAM = R * 3.4;
  const projetar = (x: number, y: number, z: number): [number, number, number] => { const s = FOV / (CAM - z); return [cx + x * s, cy + y * s, s]; };

  // Pulso de fala: casca esférica e fagulhas radiais.
  if (ws > 0.25 && p.fala > 0.55 && t - sys.lastWave > 0.14) {
    sys.lastWave = t;
    sys.waves.push({ r: R * 0.18, v: R * 0.03, band: R * 0.12, str: R * 0.05, life: 1 });
    for (let i = 0; i < 8; i++) sys.sparks.push({ ...direcao(), r: R * 0.17, v: R * (0.014 + Math.random() * 0.02), life: 1, col: cor() });
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Núcleo.
  const breath = 0.5 + 0.5 * Math.sin(t * 1.15);
  const flick = 0.62 + 0.24 * Math.sin(t * 9.7) * Math.sin(t * 4.3) + 0.08 * Math.sin(t * 23.1);
  let coreI = 0.7 + A * 0.9;
  coreI += wl * (breath * 0.55 - 0.3);
  coreI = coreI * (1 - wt * 0.7) + wt * flick * 1.35;
  coreI += sys.coreFlash; sys.coreFlash *= 0.9;
  const coreScr = FOV / CAM;
  const coreR = Math.max(0.1, R * 0.16 * coreI * coreScr);
  const nucleo = () => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
    g.addColorStop(0, `rgba(255,236,196,${Math.min(1, 0.5 + A * 0.5 + sys.coreFlash * 0.5)})`);
    g.addColorStop(0.35, `rgba(255,158,44,${Math.min(1, 0.28 + A * 0.4)})`);
    g.addColorStop(1, "rgba(255,122,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, coreR * 2.4, 0, 7); ctx.fill();
  };

  // Nós da constelação no volume.
  for (const n of nodes) {
    const [rx, ry, rz] = girar(Math.cos(t * n.f1 * 2 + n.p1) * R * 0.6, Math.sin(t * n.f2 * 2 + n.p2) * R * 0.55, Math.sin(t * n.f3 * 2 + n.p3) * R * 0.6);
    n.x = rx; n.y = ry; n.z = rz;
    const [sx, sy] = projetar(rx, ry, rz);
    n.sx = sx; n.sy = sy;
  }

  // Projeção de cada partícula (e a profundidade, para ordenar e ocultar atrás do núcleo).
  const contrai = wl * (0.2 + 0.06 * Math.sin(t * 1.15));
  for (const q of parts) {
    q.a += q.sp * (1 + A * 2);
    const rr = q.r * R * (1 + Math.sin(t * q.wf + q.ph) * 0.035 * (1 + A * 1.6)) * (1 - contrai);
    const ca = Math.cos(q.a) * rr, sa = Math.sin(q.a) * rr, B = q.B;
    const [rx, ry, rz] = girar(B[0] * ca + B[3] * sa, B[1] * ca + B[4] * sa, B[2] * ca + B[5] * sa);
    let [sx, sy] = projetar(rx, ry, rz);
    const s = FOV / (CAM - rz);
    if (ws > 0.02 && sys.waves.length) {
      const dxs = sx - cx, dys = sy - cy, d = Math.hypot(dxs, dys) || 1, dw = Math.hypot(rx, ry, rz);
      let empurra = 0;
      for (const wv of sys.waves) { const dd = dw - wv.r; empurra += wv.str * Math.exp(-(dd * dd) / (wv.band * wv.band)) * wv.life; }
      if (empurra) { sx += (dxs / d) * empurra * s * ws; sy += (dys / d) * empurra * s * ws; }
    }
    q.tx = sx; q.ty = sy; q.ps = s; q.pz = rz;
    if (q.cl >= 0 && wt > 0.02) { const n = nodes[q.cl], k = wt * q.cm; q.tx += (n.sx - q.tx) * k; q.ty += (n.sy - q.ty) * k; q.pz += (n.z - q.pz) * k; }
  }
  parts.sort((a, b) => a.pz - b.pz);
  const ponto = (q: Particula) => {
    const prof = 0.4 + 0.6 * ((q.ps * CAM) / (R * 3.0));
    ctx.globalAlpha = q.al * (0.22 + A * 0.85) * prof;
    ctx.fillStyle = q.col;
    const sz = q.sz * (0.6 + q.ps * 0.9);
    if (q.streak) {
      ctx.strokeStyle = q.col; ctx.lineWidth = sz * 0.7;
      ctx.beginPath(); ctx.moveTo(q.tx, q.ty); ctx.lineTo(q.tx - Math.cos(q.a) * 6 * q.ps, q.ty - Math.sin(q.a) * 6 * q.ps); ctx.stroke();
    } else ctx.fillRect(q.tx - sz / 2, q.ty - sz / 2, sz, sz);
  };
  let i0 = 0;
  for (; i0 < parts.length; i0++) { if (parts[i0].pz >= 0) break; ponto(parts[i0]); }
  nucleo();
  for (; i0 < parts.length; i0++) ponto(parts[i0]);

  // Arcos orbitais.
  for (const a of arcs) {
    a.a += a.sp * (1 + A * 1.4);
    const B = a.B, passos = 16, raio = a.r * R;
    ctx.globalAlpha = a.al * (0.3 + A * 0.8); ctx.strokeStyle = a.col; ctx.lineWidth = a.w;
    ctx.beginPath();
    for (let k = 0; k <= passos; k++) {
      const ang = a.a + (a.len * k) / passos, ca = Math.cos(ang) * raio, sa = Math.sin(ang) * raio;
      const [sx, sy] = projetar(...girar(B[0] * ca + B[3] * sa, B[1] * ca + B[4] * sa, B[2] * ca + B[5] * sa));
      if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
    }
    ctx.stroke();
  }

  // Anéis de tique giroscópicos.
  for (const tr of tickRings) {
    const B = tr.B, raio = tr.r * R, n = 72, r0 = t * 0.05 * (tr.step % 2 ? -1 : 1);
    ctx.globalAlpha = 0.1 + A * 0.22; ctx.strokeStyle = "#FF9E2C"; ctx.lineWidth = 0.7;
    for (let i = 0; i < n; i += tr.step) {
      const ang = r0 + (i / n) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang), r1 = raio - 3, r2 = raio + 3;
      const [bx, by] = projetar(...girar(B[0] * ca * r1 + B[3] * sa * r1, B[1] * ca * r1 + B[4] * sa * r1, B[2] * ca * r1 + B[5] * sa * r1));
      const [bx2, by2] = projetar(...girar(B[0] * ca * r2 + B[3] * sa * r2, B[1] * ca * r2 + B[4] * sa * r2, B[2] * ca * r2 + B[5] * sa * r2));
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx2, by2); ctx.stroke();
    }
  }

  // Fagulhas ambiente.
  if (Math.random() < A * 0.12) sys.flares.push({ ...direcao(), r0: R * (0.3 + Math.random() * 0.5), len: R * (0.15 + Math.random() * 0.3), life: 1 });
  for (let i = sys.flares.length - 1; i >= 0; i--) {
    const f = sys.flares[i]; f.life -= 0.05;
    if (f.life <= 0) { sys.flares.splice(i, 1); continue; }
    const r1 = f.r0, r2 = f.r0 + f.len * (1 - f.life);
    const [p1x, p1y] = projetar(...girar(f.dx * r1, f.dy * r1, f.dz * r1)), [p2x, p2y] = projetar(...girar(f.dx * r2, f.dy * r2, f.dz * r2));
    ctx.globalAlpha = f.life * 0.7; ctx.strokeStyle = "#FFD591"; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
  }

  // Escutando: cometas e sonar ao contrário.
  if (Math.random() < wl * 0.3) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    sys.comets.push({ dx: Math.sin(ph) * Math.cos(th), dy: Math.cos(ph), dz: Math.sin(ph) * Math.sin(th), th, ph, r: R * (1.15 + Math.random() * 0.12),
      v: R * (0.006 + Math.random() * 0.007), sw: (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.03), col: cor() });
  }
  for (let i = sys.comets.length - 1; i >= 0; i--) {
    const cm = sys.comets[i];
    cm.r -= cm.v * (1.7 - cm.r / (R * 1.2)); cm.th += cm.sw * 0.4;
    cm.dx = Math.sin(cm.ph) * Math.cos(cm.th); cm.dz = Math.sin(cm.ph) * Math.sin(cm.th);
    if (cm.r < R * 0.18) { sys.coreFlash += 0.3; sys.comets.splice(i, 1); continue; }
    const r2 = cm.r + cm.v * 16;
    const [p1x, p1y, s1] = projetar(...girar(cm.dx * cm.r, cm.dy * cm.r, cm.dz * cm.r)), [p2x, p2y] = projetar(...girar(cm.dx * r2, cm.dy * r2, cm.dz * r2));
    ctx.globalAlpha = Math.min(1, wl * 1.1) * 0.85 * (0.5 + s1 / (2 * coreScr));
    ctx.strokeStyle = cm.col; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
    ctx.fillStyle = "#FFEDC4"; ctx.fillRect(p1x - 1, p1y - 1, 2, 2);
  }
  sys.sonarClock++;
  if (wl > 0.2 && sys.sonarClock % 55 === 0) sys.rings.push({ r: R * 1.05, life: 1, B: tickRings[sys.rings.length % 3].B });
  for (let i = sys.rings.length - 1; i >= 0; i--) {
    const rg = sys.rings[i]; rg.r -= R * 0.0075; rg.life -= 0.011;
    if (rg.life <= 0 || rg.r < R * 0.16) { sys.rings.splice(i, 1); continue; }
    const B = rg.B;
    ctx.globalAlpha = Math.sin(rg.life * Math.PI) * 0.4 * Math.max(wl, 0.05); ctx.strokeStyle = "#FFEDC4"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k <= 40; k++) {
      const ang = (k / 40) * Math.PI * 2, ca = Math.cos(ang) * rg.r, sa = Math.sin(ang) * rg.r;
      const [sx, sy] = projetar(...girar(B[0] * ca + B[3] * sa, B[1] * ca + B[4] * sa, B[2] * ca + B[5] * sa));
      if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
    }
    ctx.stroke();
  }

  // Pensando: sinapses no volume e relâmpagos.
  if (wt > 0.03) {
    const maxD = R * 0.62;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y, nodes[j].z - nodes[i].z);
        if (d > maxD) continue;
        ctx.globalAlpha = wt * (0.1 + 0.22 * Math.abs(Math.sin(t * 2.6 + i * 2.1 + j * 1.3))) * (1 - d / maxD);
        ctx.strokeStyle = "#FF9E2C"; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(nodes[i].sx, nodes[i].sy); ctx.lineTo(nodes[j].sx, nodes[j].sy); ctx.stroke();
      }
      ctx.globalAlpha = wt * 0.55; ctx.fillStyle = "#FFD591";
      ctx.fillRect(nodes[i].sx - 1.4, nodes[i].sy - 1.4, 2.8, 2.8);
    }
    if (Math.random() < wt * 0.06) {
      const a = nodes[Math.floor(Math.random() * nodes.length)], b = nodes[Math.floor(Math.random() * nodes.length)];
      const pts: [number, number][] = [];
      for (let s = 0; s <= 6; s++) { const f = s / 6, ruido = s % 6 ? 1 : 0; pts.push([a.sx + (b.sx - a.sx) * f + (Math.random() - 0.5) * R * 0.06 * ruido, a.sy + (b.sy - a.sy) * f + (Math.random() - 0.5) * R * 0.06 * ruido]); }
      sys.bolts.push({ pts, life: 1 });
    }
  }
  for (let i = sys.bolts.length - 1; i >= 0; i--) {
    const b = sys.bolts[i]; b.life -= 0.13;
    if (b.life <= 0) { sys.bolts.splice(i, 1); continue; }
    ctx.globalAlpha = b.life * Math.max(wt, 0.05); ctx.strokeStyle = "#FFEDC4"; ctx.lineWidth = 1.1;
    ctx.beginPath(); b.pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
  }

  // Falando: cascas de choque, equalizador radial e fagulhas.
  for (let i = sys.waves.length - 1; i >= 0; i--) {
    const wv = sys.waves[i]; wv.r += wv.v; wv.life -= 0.016;
    if (wv.life <= 0) { sys.waves.splice(i, 1); continue; }
    ctx.globalAlpha = wv.life * 0.42 * Math.max(ws, 0.12); ctx.strokeStyle = "#FFB54D"; ctx.lineWidth = 0.4 + wv.life * 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, wv.r * (FOV / CAM), 0, 7); ctx.stroke();
  }
  if (ws > 0.03) {
    for (let i = 0; i < 60; i++) {
      const th = (i / 60) * Math.PI * 2;
      const amp = A * (0.35 + (0.65 * Math.abs(Math.sin(t * 6.3 + i * 1.93) + 0.5 * Math.sin(t * 11.7 + i * 0.71))) / 1.5);
      const dx = Math.cos(th), dy = Math.sin(th), dz = 0.25 * Math.sin(t * 2 + i), r1 = R * 1.02, r2 = R * (1.02 + 0.14 * amp);
      const [p1x, p1y] = projetar(...girar(dx * r1, dy * r1, dz * r1)), [p2x, p2y] = projetar(...girar(dx * r2, dy * r2, dz * r2));
      ctx.globalAlpha = ws * (0.22 + amp * 0.5); ctx.strokeStyle = PALETA[i % PALETA.length]; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
    }
  }
  for (let i = sys.sparks.length - 1; i >= 0; i--) {
    const s = sys.sparks[i]; s.r += s.v; s.life -= 0.035;
    if (s.life <= 0) { sys.sparks.splice(i, 1); continue; }
    const r2 = s.r - s.v * 6;
    const [p1x, p1y] = projetar(...girar(s.dx * s.r, s.dy * s.r, s.dz * s.r)), [p2x, p2y] = projetar(...girar(s.dx * r2, s.dy * r2, s.dz * r2));
    ctx.globalAlpha = s.life * 0.8; ctx.strokeStyle = s.col; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}
