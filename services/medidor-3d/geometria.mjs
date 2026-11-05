/**
 * Medidor 3D — contas sobre a saída do solidcraft-cli (sem rodar nada): ligar cada corpo ao componente
 * da montagem, achar o eixo da peça e separar a área das pontas (faces planas perpendiculares ao eixo)
 * da área das demais faces. É com essas duas áreas que a plataforma soma o sobremetal do bruto.
 */

/** Componentes da montagem (component.list com bodies) → nome do corpo → { componente, ocorrencias }. */
export function corposDosComponentes(lista) {
  const comps = lista?.components ?? [];
  const mapa = new Map();
  for (const c of comps) {
    for (const corpo of c.bodies ?? []) {
      if (!mapa.has(corpo)) mapa.set(corpo, { componente: limparNome(c.name), ocorrencias: Math.max(1, (c.occurrences ?? []).length) });
    }
  }
  return mapa;
}

/** "FUNNEL_N3.STEP" → "FUNNEL_N3"; "BP:1" → "BP". */
export function limparNome(nome) {
  return String(nome ?? "").replace(/:\d+$/, "").replace(/\.(step|stp)$/i, "").trim();
}

/**
 * O document.inspect lista cada ocorrência; a 2ª em diante vem como "NONE (8) (Montagem:1/…/BAFFLE.STEP:2)".
 * Devolve o nome do corpo na definição do componente (o que model.faces e snapshot aceitam).
 */
export function nomeBase(nomeNoDocumento, nomesConhecidos) {
  if (nomesConhecidos.has(nomeNoDocumento)) return nomeNoDocumento;
  let melhor = null;
  for (const n of nomesConhecidos) {
    if (nomeNoDocumento.startsWith(`${n} (`) && nomeNoDocumento.endsWith(")") && nomeNoDocumento.slice(n.length).includes(":")) {
      if (!melhor || n.length > melhor.length) melhor = n;
    }
  }
  return melhor ?? nomeNoDocumento;
}

const norma = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = norma(v); return n ? [v[0] / n, v[1] / n, v[2] / n] : null; };
const paralelo = (a, b, tol = 1e-3) => Math.abs(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) - 1) < tol;

/**
 * Eixo da peça: a direção com mais área de faces cilíndricas (as peças de molde são de revolução).
 * Sem cilindro, a medida externa diferente das outras duas (bloco quadrado com altura) dá o eixo.
 */
export function eixoDaPeca(faces, bbox) {
  const grupos = [];
  for (const f of faces ?? []) {
    const eixo = f.cylinder?.axis ? unit(f.cylinder.axis) : null;
    if (!eixo) continue;
    const g = grupos.find((x) => paralelo(x.eixo, eixo));
    if (g) g.area += f.area; else grupos.push({ eixo, area: f.area });
  }
  grupos.sort((a, b) => b.area - a.area);
  if (grupos.length) return arredondarEixo(grupos[0].eixo);
  if (!bbox) return null;
  const d = [0, 1, 2].map((i) => bbox.max[i] - bbox.min[i]);
  for (let i = 0; i < 3; i++) {
    const [a, b] = [d[(i + 1) % 3], d[(i + 2) % 3]];
    if (Math.abs(a - b) <= 0.5 && Math.abs(d[i] - a) > 0.5) return [0, 1, 2].map((k) => (k === i ? 1 : 0));
  }
  return null;
}

/** Eixo sempre com o maior componente positivo e sem ruído (1e-12 → 0). */
function arredondarEixo(e) {
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(e[i]) > Math.abs(e[m]) ? i : m), 0);
  const s = e[k] < 0 ? -1 : 1;
  return e.map((x) => { const y = s * x; return Math.abs(y) < 1e-9 ? 0 : Math.round(y * 1e6) / 1e6; });
}

/** Área das pontas (planas ⊥ eixo) e das demais faces, em mm². Sem eixo, tudo conta como "demais". */
export function areasPorDirecao(faces, eixo) {
  let pontas = 0;
  let demais = 0;
  for (const f of faces ?? []) {
    const n = f.plane_normal ? unit(f.plane_normal) : null;
    if (eixo && n && paralelo(n, eixo)) pontas += f.area; else demais += f.area;
  }
  return { pontas, demais };
}

/**
 * Junta a medição (document.inspect) com as faces (model.faces) e a montagem (component.list).
 * Ocorrências repetidas do mesmo corpo viram uma linha só, com a contagem.
 */
export function montarCorpos(inspecao, facesPorCorpo, componentes) {
  const conhecidos = new Set(componentes.keys());
  const porBase = new Map();
  for (const b of inspecao?.bodies ?? []) {
    const base = nomeBase(b.name, conhecidos);
    const atual = porBase.get(base);
    if (atual) { atual.vistas += 1; continue; }
    const faces = facesPorCorpo.get(base) ?? [];
    const eixo = eixoDaPeca(faces, b.bbox);
    const { pontas, demais } = areasPorDirecao(faces, eixo);
    const comp = componentes.get(base);
    porBase.set(base, {
      nome: base,
      componente: comp?.componente ?? null,
      ocorrencias: comp?.ocorrencias ?? 1,
      vistas: 1,
      fechado: b.closed !== false,
      volume_mm3: Math.abs(Number(b.volume_mm3) || 0),
      volume_negativo: Number(b.volume_mm3) < 0,
      area_mm2: Number(b.area_mm2) || 0,
      bbox: b.bbox ?? null,
      centro: b.center_of_mass ?? null,
      faces: Number(b.faces) || faces.length,
      tipos_faces: b.face_types ?? {},
      eixo,
      area_pontas_mm2: pontas,
      area_demais_mm2: demais,
      faces_lidas: faces.length,
    });
  }
  return [...porBase.values()].map((c) => ({ ...c, ocorrencias: Math.max(c.ocorrencias, c.vistas) })).map(({ vistas: _v, ...c }) => c);
}
