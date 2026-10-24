import { createElement as h, type ReactElement } from "react";
import { Circle, Document, G, Image, Line, Page, Path, Polyline, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { TIPOS, formatar, type Documento, type Grafico, type Tabela } from "./documento.ts";

/**
 * O PDF dos documentos da SARA central, gerado no servidor (sem navegador): papel timbrado da empresa (logo,
 * razão social, CNPJ, endereço e contato do cadastro), número do documento e "Página X de Y" em todas as
 * páginas. Mesma identidade do modelo de relatórios da plataforma (packages/design-system/report.css): claro,
 * sóbrio, azul da marca nos destaques. Escrito sem JSX para rodar também nos testes do Node.
 */

export type Empresa = {
  razao_social: string; nome_fantasia?: string | null; cnpj?: string | null;
  logradouro?: string | null; numero?: string | null; bairro?: string | null; municipio?: string | null; uf?: string | null; cep?: string | null;
  telefone?: string | null; email?: string | null; site?: string | null;
};

const COR = { tinta: "#111827", suave: "#4b5563", fraco: "#6b7280", linha: "#e5e7eb", fundo: "#f3f4f6", azul: "#1d4ed8", azulFundo: "#eff6ff", verde: "#047857" };
const PALETA = ["#1d4ed8", "#b45309", "#047857", "#7c3aed", "#be123c", "#0e7490"];
const LARGURA = 515;

/** Só caracteres que a fonte padrão do PDF desenha (latim, pontuação e alguns símbolos); o resto sai. */
export const limpar = (s: string) => s.replace(/\*\*/g, "").replace(/[^\n -ÿ–—‘’“”•…€]/g, "").replace(/[ \t]+/g, " ");

const s = StyleSheet.create({
  pagina: { paddingTop: 108, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 10, color: COR.tinta },
  // O espaçamento entre linhas vai em CADA estilo de texto e EM PONTOS ("14.5pt"): sem unidade, o @react-pdf
  // multiplica por 18 (1,45 vira 26 pt numa letra de 10); herdado, apaga o número da página.
  topo: { position: "absolute", top: 28, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottomWidth: 1.5, borderBottomColor: COR.azul },
  logo: { width: 128, height: 45, objectFit: "contain" },
  empresa: { alignItems: "flex-end", maxWidth: 300 },
  empresaNome: { fontFamily: "Helvetica-Bold", fontSize: 9, lineHeight: "12pt", color: COR.tinta },
  empresaLinha: { fontSize: 7.5, lineHeight: "10pt", color: COR.fraco, textAlign: "right" },
  rodapeLinha: { position: "absolute", bottom: 38, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: COR.linha },
  rodapeEsq: { position: "absolute", bottom: 24, left: 40, fontSize: 7.5, color: COR.fraco },
  rodapeDir: { position: "absolute", bottom: 24, left: 40, right: 40, textAlign: "right", fontSize: 7.5, color: COR.fraco },
  rotulo: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COR.azul, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  titulo: { fontFamily: "Helvetica-Bold", fontSize: 18, lineHeight: "22pt", marginBottom: 4 },
  subtitulo: { fontSize: 10.5, color: COR.suave, marginBottom: 2 },
  meta: { fontSize: 8, color: COR.fraco, marginBottom: 14 },
  caixa: { backgroundColor: COR.fundo, borderRadius: 4, padding: 12, marginBottom: 14 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 10, marginBottom: 6, color: COR.tinta },
  p: { marginBottom: 6, lineHeight: "14.5pt", textAlign: "justify" },
  itemTexto: { flex: 1, lineHeight: "14.5pt" },
  linha: { lineHeight: "14pt" },
  item: { flexDirection: "row", marginBottom: 3 },
  ponto: { width: 12, lineHeight: "14.5pt", color: COR.azul },
  tabela: { marginTop: 4, marginBottom: 10, borderWidth: 0.5, borderColor: COR.linha },
  tabTitulo: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: COR.suave, marginTop: 4, marginBottom: 3 },
  linhaT: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COR.linha },
  celCab: { flex: 1, padding: 4, fontSize: 8, lineHeight: "10pt", fontFamily: "Helvetica-Bold", backgroundColor: COR.fundo },
  cel: { flex: 1, padding: 4, fontSize: 8, lineHeight: "10pt" },
  insight: { flexDirection: "row", justifyContent: "space-between", padding: 8, marginBottom: 5, borderLeftWidth: 2.5, borderLeftColor: COR.azul, backgroundColor: COR.azulFundo },
  selo: { fontSize: 7, color: COR.azul, fontFamily: "Helvetica-Bold", marginLeft: 8 },
  legenda: { flexDirection: "row", flexWrap: "wrap", marginTop: 4, marginBottom: 8 },
  legItem: { flexDirection: "row", alignItems: "center", marginRight: 12, marginBottom: 2, fontSize: 7.5, color: COR.suave },
});

const dataExtenso = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long", year: "numeric" });
const dataCurta = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Texto com parágrafos (linha em branco) e tópicos ("- " ou "• " no começo da linha). */
function blocos(texto: string, k: string): ReactElement[] {
  return limpar(texto).split(/\n{2,}/).flatMap((par, i): ReactElement[] => {
    const linhas = par.split("\n").map((l) => l.trim()).filter(Boolean);
    // Lista de tópicos: um bloco com respiro embaixo, para o parágrafo seguinte não vir colado.
    if (linhas.length && linhas.every((l) => /^[-•]\s/.test(l)))
      return [h(View, { key: `${k}-${i}`, style: { marginBottom: 6 } }, ...linhas.map((l, j) => h(View, { key: j, style: s.item }, h(Text, { style: s.ponto }, "•"), h(Text, { style: s.itemTexto }, l.replace(/^[-•]\s/, "")))))];
    return [h(Text, { key: `${k}-${i}`, style: s.p }, linhas.join(" "))];
  });
}

function tabelaPdf(t: Tabela, k: string): ReactElement {
  const numerica = t.colunas.map((_, c) => t.linhas.every((l) => /^[-R$\s\d.,%—]+$/.test(l[c] ?? "")));
  return h(View, { key: k, wrap: t.linhas.length > 18 },
    t.titulo ? h(Text, { style: s.tabTitulo }, limpar(t.titulo)) : null,
    h(View, { style: s.tabela },
      h(View, { style: s.linhaT, fixed: true }, ...t.colunas.map((c, i) => h(Text, { key: i, style: [s.celCab, numerica[i] ? { textAlign: "right" } : {}] }, limpar(c)))),
      ...t.linhas.map((l, j) => h(View, { key: j, style: [s.linhaT, j % 2 ? { backgroundColor: "#fafafa" } : {}], wrap: false },
        ...l.map((c, i) => h(Text, { key: i, style: [s.cel, numerica[i] ? { textAlign: "right" } : {}] }, limpar(c)))))));
}

const legenda = (nomes: string[], k: string) => h(View, { key: k, style: s.legenda },
  ...nomes.map((n, i) => h(View, { key: i, style: s.legItem }, h(Svg, { width: 8, height: 8 }, h(Rect, { x: 0, y: 0, width: 8, height: 8, fill: PALETA[i % PALETA.length] })), h(Text, { style: { marginLeft: 4 } }, limpar(n)))));

/** Barras horizontais (uma por rótulo; várias séries lado a lado), com o valor no fim. */
function barras(g: Grafico): ReactElement {
  const max = Math.max(...g.series.flatMap((x) => x.valores.map(Math.abs)), 1);
  const altSerie = 9, gap = 6, rot = 150, val = 85, area = LARGURA - rot - val;
  const altGrupo = g.series.length * altSerie + gap;
  const altura = g.rotulos.length * altGrupo + 4;
  const filhos: ReactElement[] = [];
  g.rotulos.forEach((r, i) => {
    const y0 = i * altGrupo;
    filhos.push(h(Text, { key: `r${i}`, x: 0, y: y0 + (g.series.length * altSerie) / 2 + 3, style: { fontSize: 7.5 }, fill: COR.suave }, limpar(r).slice(0, 34)));
    g.series.forEach((se, k) => {
      const v = se.valores[i], w = Math.max(1, (Math.abs(v) / max) * area);
      filhos.push(h(Rect, { key: `b${i}-${k}`, x: rot, y: y0 + k * altSerie, width: w, height: altSerie - 2, fill: v < 0 ? "#be123c" : PALETA[k % PALETA.length] }));
      filhos.push(h(Text, { key: `v${i}-${k}`, x: rot + w + 4, y: y0 + k * altSerie + altSerie - 3, style: { fontSize: 7 }, fill: COR.tinta }, formatar(v, g.formato)));
    });
  });
  return h(Svg, { width: LARGURA, height: altura }, ...filhos);
}

/** Linhas no tempo, com o maior valor marcado no eixo e alguns rótulos embaixo. */
function linhas(g: Grafico): ReactElement {
  const W = LARGURA, H = 170, esq = 60, base = H - 22, topo = 8;
  const todos = g.series.flatMap((x) => x.valores);
  const max = Math.max(...todos, 0), min = Math.min(...todos, 0);
  const y = (v: number) => base - ((v - min) / (max - min || 1)) * (base - topo);
  const x = (i: number) => esq + (g.rotulos.length <= 1 ? 0 : (i / (g.rotulos.length - 1)) * (W - esq - 10));
  const passo = Math.max(1, Math.ceil(g.rotulos.length / 8));
  return h(Svg, { width: W, height: H },
    h(Line, { x1: esq, y1: base, x2: W - 10, y2: base, stroke: COR.linha, strokeWidth: 1 }),
    h(Line, { x1: esq, y1: y(0), x2: W - 10, y2: y(0), stroke: "#d1d5db", strokeWidth: 0.5 }),
    h(Text, { x: 0, y: topo + 6, style: { fontSize: 7 }, fill: COR.fraco }, formatar(max, g.formato)),
    min < 0 ? h(Text, { x: 0, y: base, style: { fontSize: 7 }, fill: COR.fraco }, formatar(min, g.formato)) : null,
    ...g.rotulos.map((r, i) => (i % passo === 0 ? h(Text, { key: `x${i}`, x: x(i) - 12, y: H - 6, style: { fontSize: 6.5 }, fill: COR.fraco }, limpar(r).slice(0, 10)) : null)).filter(Boolean) as ReactElement[],
    ...g.series.map((se, k) => h(G, { key: `s${k}` },
      h(Polyline, { points: se.valores.map((v, i) => `${x(i)},${y(v)}`).join(" "), stroke: PALETA[k % PALETA.length], strokeWidth: 1.6, fill: "none" }),
      ...se.valores.map((v, i) => h(Circle, { key: i, cx: x(i), cy: y(v), r: 1.8, fill: PALETA[k % PALETA.length] })))));
}

/** Rosca (composição): fatias com a legenda, o valor e o percentual. */
function rosca(g: Grafico): ReactElement {
  const vals = g.series[0].valores.map((v) => Math.max(0, v));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const R = 60, r = 34, cx = 70, cy = 70;
  let a0 = -Math.PI / 2;
  const fatias = vals.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2 - (vals.filter((x) => x > 0).length > 1 ? 0.0001 : 0.0002);
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rr: number) => `${cx + rr * Math.cos(ang)} ${cy + rr * Math.sin(ang)}`;
    const d = `M ${p(a0, R)} A ${R} ${R} 0 ${grande} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${grande} 0 ${p(a0, r)} Z`;
    a0 = a1;
    return h(Path, { key: i, d, fill: PALETA[i % PALETA.length] });
  });
  return h(View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 8 } },
    h(Svg, { width: 140, height: 140 }, ...fatias),
    h(View, { style: { marginLeft: 16, flex: 1 } }, ...g.rotulos.map((rot, i) => h(View, { key: i, style: [s.legItem, { marginBottom: 4 }] },
      h(Svg, { width: 8, height: 8 }, h(Rect, { x: 0, y: 0, width: 8, height: 8, fill: PALETA[i % PALETA.length] })),
      h(Text, { style: { marginLeft: 5, fontSize: 8, color: COR.tinta } }, `${limpar(rot)}: ${formatar(vals[i], g.formato)} (${((vals[i] / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`)))));
}

function graficoPdf(g: Grafico, k: string): ReactElement {
  return h(View, { key: k, wrap: false, style: { marginTop: 4, marginBottom: 10 } },
    g.titulo ? h(Text, { style: s.tabTitulo }, limpar(g.titulo)) : null,
    g.tipo === "rosca" ? rosca(g) : g.tipo === "linhas" ? linhas(g) : barras(g),
    g.series.length > 1 ? legenda(g.series.map((x) => x.nome), `${k}-l`) : null);
}

function timbre(e: Empresa, logo: Uint8Array | null): ReactElement {
  const endereco = [e.logradouro && `${e.logradouro}${e.numero ? `, ${e.numero}` : ""}`, e.bairro, e.municipio && `${e.municipio}${e.uf ? `/${e.uf}` : ""}`, e.cep && `CEP ${e.cep}`].filter(Boolean).join(" · ");
  const contato = [e.telefone, e.email, e.site].filter(Boolean).join(" · ");
  return h(View, { style: s.topo, fixed: true },
    logo ? h(Image, { src: Buffer.from(logo), style: s.logo }) : h(Text, { style: s.titulo }, limpar(e.nome_fantasia || e.razao_social)),
    h(View, { style: s.empresa },
      h(Text, { style: s.empresaNome }, limpar(e.razao_social)),
      e.cnpj ? h(Text, { style: s.empresaLinha }, `CNPJ ${e.cnpj}`) : null,
      endereco ? h(Text, { style: s.empresaLinha }, limpar(endereco)) : null,
      contato ? h(Text, { style: s.empresaLinha }, limpar(contato)) : null));
}

// Rodapé em peças soltas e fixas (a linha, o texto e a página): dentro de um bloco absoluto ele some.
const rodape = (esquerda: string): ReactElement[] => [
  h(View, { key: "rl", style: s.rodapeLinha, fixed: true }),
  h(Text, { key: "re", style: s.rodapeEsq, fixed: true }, limpar(esquerda)),
  h(Text, { key: "rd", style: s.rodapeDir, fixed: true, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Página ${pageNumber} de ${totalPages}` }),
];

const CONF = { alta: "alta", media: "média", baixa: "baixa" };

function relatorio(d: Documento, numero: string, quando: Date): ReactElement[] {
  const corpo: ReactElement[] = [
    h(Text, { key: "rot", style: s.rotulo }, TIPOS.relatorio),
    h(Text, { key: "tit", style: s.titulo }, limpar(d.titulo)),
    d.subtitulo ? h(Text, { key: "sub", style: s.subtitulo }, limpar(d.subtitulo)) : null,
    h(Text, { key: "meta", style: s.meta }, `Documento nº ${numero} · emitido em ${dataCurta(quando)}`),
  ].filter(Boolean) as ReactElement[];
  if (d.resumo) corpo.push(h(View, { key: "res", style: s.caixa }, h(Text, { style: s.rotulo }, "Sumário executivo"), ...blocos(d.resumo, "res")));
  d.secoes.forEach((sec, i) => {
    const titulo = sec.titulo ? h(Text, { key: `h${i}`, style: s.h2, minPresenceAhead: 90 }, limpar(sec.titulo)) : null;
    // Com gráfico e texto curto: título, texto e gráfico na mesma página.
    if (sec.grafico && sec.texto.length <= 900) {
      corpo.push(h(View, { key: `sg${i}`, wrap: false }, titulo, ...(sec.texto ? blocos(sec.texto, `t${i}`) : []), graficoPdf(sec.grafico, `g${i}`)));
      if (sec.tabela) corpo.push(tabelaPdf(sec.tabela, `tb${i}`));
      return;
    }
    if (titulo) corpo.push(titulo);
    if (sec.texto) corpo.push(...blocos(sec.texto, `t${i}`));
    if (sec.tabela) corpo.push(tabelaPdf(sec.tabela, `tb${i}`));
    if (sec.grafico) corpo.push(graficoPdf(sec.grafico, `g${i}`));
  });
  if (d.insights.length) {
    corpo.push(h(Text, { key: "hi", style: s.h2, minPresenceAhead: 60 }, "Insights"));
    corpo.push(h(Text, { key: "hi2", style: [s.meta, { marginBottom: 6 }] }, "Análise da SARA (IA): opinião, com a confiança de cada item. Confira antes de decidir."));
    d.insights.forEach((x, i) => corpo.push(h(View, { key: `in${i}`, style: s.insight, wrap: false },
      h(Text, { style: s.itemTexto }, limpar(x.texto)), h(Text, { style: s.selo }, `confiança ${CONF[x.confianca]}`))));
  }
  // Recomendações e "quem decide" juntos (o fecho do relatório não fica sozinho numa página).
  const fecho: ReactElement[] = [];
  if (d.recomendacoes.length) {
    fecho.push(h(Text, { key: "hr", style: s.h2 }, "Recomendações"));
    d.recomendacoes.forEach((r, i) => fecho.push(h(View, { key: `rc${i}`, style: s.item }, h(Text, { style: s.ponto }, `${i + 1}.`), h(Text, { style: s.itemTexto }, limpar(r)))));
  }
  if (d.quemDecide) fecho.push(h(Text, { key: "qd", style: [s.p, { marginTop: 8 }] }, h(Text, { style: { fontFamily: "Helvetica-Bold" } }, "Quem decide: "), limpar(d.quemDecide)));
  if (fecho.length) corpo.push(h(View, { key: "fecho", wrap: false }, ...fecho));
  return corpo;
}

function carta(d: Documento, numero: string, quando: Date, e: Empresa): ReactElement[] {
  const dest = d.destinatario!;
  const corpo: ReactElement[] = [
    h(Text, { key: "ld", style: [s.p, { textAlign: "right", marginBottom: 18 }] }, `${limpar(e.municipio ? `${e.municipio[0]}${e.municipio.slice(1).toLowerCase()}` : "")}${e.municipio ? ", " : ""}${dataExtenso(quando)}`),
    h(View, { key: "dest", style: { marginBottom: 14 } },
      h(Text, { style: [s.linha, { fontFamily: "Helvetica-Bold" }] }, limpar(dest.nome)),
      dest.cargo ? h(Text, { style: s.linha }, limpar(dest.cargo)) : null,
      dest.empresa ? h(Text, { style: s.linha }, limpar(dest.empresa)) : null),
    h(Text, { key: "ref", style: [s.meta, { marginBottom: 6 }] }, `Ref.: ${numero}`),
    h(Text, { key: "ass", style: [s.p, { fontFamily: "Helvetica-Bold", marginBottom: 12 }] }, `Assunto: ${limpar(d.assunto || d.titulo)}`),
  ];
  d.secoes.forEach((sec, i) => {
    if (sec.titulo) corpo.push(h(Text, { key: `h${i}`, style: s.h2 }, limpar(sec.titulo)));
    if (sec.texto) corpo.push(...blocos(sec.texto, `t${i}`));
    if (sec.tabela) corpo.push(tabelaPdf(sec.tabela, `tb${i}`));
    if (sec.grafico) corpo.push(graficoPdf(sec.grafico, `g${i}`));
  });
  corpo.push(h(View, { key: "fim", style: { marginTop: 28 }, wrap: false },
    h(Text, { style: s.p }, "Atenciosamente,"),
    h(View, { style: { marginTop: 26, borderTopWidth: 0.5, borderTopColor: COR.tinta, width: 220, paddingTop: 4 } },
      h(Text, { style: [s.linha, { fontFamily: "Helvetica-Bold" }] }, limpar(d.assinatura?.nome || e.razao_social)),
      d.assinatura?.cargo ? h(Text, { style: s.linha }, limpar(d.assinatura.cargo)) : null,
      d.assinatura ? h(Text, { style: [s.linha, { color: COR.fraco }] }, limpar(e.nome_fantasia || e.razao_social)) : null)));
  return corpo;
}

/** Monta o PDF do documento. Devolve os bytes e o número de páginas. */
export async function gerarPdf(d: Documento, o: { numero: string; empresa: Empresa; logo: Uint8Array | null; quando?: Date }): Promise<{ bytes: Uint8Array; paginas: number }> {
  const quando = o.quando ?? new Date();
  const interno = d.tipo === "relatorio";
  const doc = h(Document, { title: `${o.numero} ${d.titulo}`, author: o.empresa.nome_fantasia || o.empresa.razao_social, creator: "Pecsil Business OS", producer: "Pecsil Business OS", language: "pt-BR" },
    h(Page, { size: "A4", style: s.pagina, wrap: true },
      timbre(o.empresa, o.logo),
      ...rodape(interno ? `${o.numero} · Documento interno · gerado pela SARA central em ${dataCurta(quando)}` : `${limpar(o.empresa.nome_fantasia || o.empresa.razao_social)} · ${o.numero}`),
      ...(interno ? relatorio(d, o.numero, quando) : carta(d, o.numero, quando, o.empresa))));
  const buf = await renderToBuffer(doc);
  const bytes = new Uint8Array(buf);
  const paginas = (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  return { bytes, paginas };
}
