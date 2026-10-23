import type { Visual } from "../visual.ts";

/**
 * Documentos da SARA central (23/10/2026, docs/PLANO-MINDMASTER.md › Documentos). Só a central cria; as SARAs
 * dos módulos só recebem. Dois modelos nesta etapa:
 *   relatorio  interno: sumário, seções com texto, tabela e gráfico, insights (análise da IA, com a confiança),
 *              recomendações e quem decide;
 *   carta      oferta, convite, comunicado ou proposta simples, em papel timbrado, SEM marca de IA (o
 *              proprietário aprova a prévia antes de sair; decisão de 23/10).
 * O modelo escreve o conteúdo; a plataforma confere cada número (com o que as áreas devolveram), preenche o
 * gráfico que aponta para um visual da área e monta o PDF com o timbre. Aqui ficam as regras puras, testadas
 * em tests/sara-documentos.test.mjs.
 */

export type Formato = "moeda" | "numero" | "percentual" | "texto";
export type Grafico = { tipo: "barras" | "linhas" | "rosca"; titulo: string; formato: Formato; rotulos: string[]; series: { nome: string; valores: number[] }[] };
export type Tabela = { titulo?: string; colunas: string[]; linhas: string[][] };
export type Secao = { titulo: string; texto: string; tabela: Tabela | null; grafico: Grafico | null };
export type Insight = { texto: string; confianca: "alta" | "media" | "baixa" };
export type Documento = {
  tipo: "relatorio" | "carta";
  titulo: string;
  subtitulo: string;
  /** Carta: a quem se destina (nome, cargo e empresa, como vão no documento). */
  destinatario: { nome: string; cargo: string; empresa: string } | null;
  assunto: string;
  resumo: string;
  secoes: Secao[];
  insights: Insight[];
  recomendacoes: string[];
  quemDecide: string;
  assinatura: { nome: string; cargo: string } | null;
  /** Módulos de onde vieram os dados (para avisar se quem recebe não tem acesso). */
  areas: string[];
};

export const TIPOS = { relatorio: "Relatório", carta: "Carta", mensagem_voz: "Mensagem de voz" } as const;
const LIM = { secoes: 12, linhas: 40, colunas: 8, rotulos: 24, series: 4, insights: 8, recomendacoes: 8 };

const t = (v: unknown, max: number) => String(v ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const conf = (v: unknown): Insight["confianca"] => (["alta", "media", "baixa"] as const).find((c) => c === v) ?? "media";
const formato = (v: unknown): Formato => (["moeda", "numero", "percentual", "texto"] as const).find((f) => f === v) ?? "numero";

/** Um visual que a SARA da área montou vira gráfico ou tabela do PDF (os números são da plataforma). */
export function doVisual(v: Visual): { grafico: Grafico | null; tabela: Tabela | null } {
  const f = (x: string): Formato => (x === "moeda" ? "moeda" : x === "texto" || x === "data" ? "texto" : "numero");
  const cel = (c: unknown, fm: string) => (c == null ? "—" : typeof c === "number" ? formatar(c, f(fm)) : String(c));
  if (v.componente === "barras" || v.componente === "linha" || v.componente === "rosca")
    return { tabela: null, grafico: { tipo: v.componente === "linha" ? "linhas" : v.componente, titulo: v.titulo, formato: f(v.formato), rotulos: v.pontos.map((p) => p.rotulo), series: [{ nome: v.titulo, valores: v.pontos.map((p) => p.valor) }] } };
  if (v.componente === "tabela") return { grafico: null, tabela: { titulo: v.titulo, colunas: v.colunas.map((c) => c.rotulo), linhas: v.linhas.map((l) => l.map((c, i) => cel(c, v.colunas[i]?.formato ?? "texto"))) } };
  if (v.componente === "indicadores") return { grafico: null, tabela: { titulo: v.titulo, colunas: ["Indicador", "Valor"], linhas: v.itens.map((i) => [i.rotulo, cel(i.valor, i.formato)]) } };
  if (v.componente === "lista_de_datas") return { grafico: null, tabela: { titulo: v.titulo, colunas: ["Data", "Item", "Valor"], linhas: v.itens.map((i) => [i.data.split("-").reverse().join("/"), i.rotulo, i.valor == null ? "—" : formatar(i.valor, f(v.formato))]) } };
  return { grafico: null, tabela: null };
}

export function formatar(v: number, f: Formato): string {
  if (f === "moeda") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (f === "percentual") return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function grafico(x: unknown): Grafico | null {
  const g = (x ?? null) as Record<string, unknown> | null;
  if (!g) return null;
  const rotulos = (Array.isArray(g.rotulos) ? g.rotulos : []).map((r) => t(r, 60)).slice(0, LIM.rotulos);
  const series = (Array.isArray(g.series) ? g.series : []).slice(0, LIM.series).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { nome: t(o.nome, 60), valores: (Array.isArray(o.valores) ? o.valores : []).map(num).slice(0, rotulos.length) };
  }).filter((s) => s.valores.length === rotulos.length && s.valores.every(Number.isFinite));
  if (!rotulos.length || !series.length) return null;
  const tipo = (["barras", "linhas", "rosca"] as const).find((k) => k === g.tipo) ?? "barras";
  return { tipo, titulo: t(g.titulo, 120), formato: formato(g.formato), rotulos, series: tipo === "rosca" ? series.slice(0, 1) : series };
}

function tabela(x: unknown): Tabela | null {
  const o = (x ?? null) as Record<string, unknown> | null;
  if (!o) return null;
  const colunas = (Array.isArray(o.colunas) ? o.colunas : []).map((c) => t(c, 40)).filter(Boolean).slice(0, LIM.colunas);
  const linhas = (Array.isArray(o.linhas) ? o.linhas : []).slice(0, LIM.linhas)
    .map((l) => (Array.isArray(l) ? l : []).slice(0, colunas.length).map((c) => (typeof c === "number" ? formatar(c, "numero") : t(c, 400))))
    .filter((l) => l.length === colunas.length);
  return colunas.length && linhas.length ? { titulo: t(o.titulo, 120) || undefined, colunas, linhas } : null;
}

/**
 * Confere e normaliza o que o modelo mandou. `visuais`: os que as SARAs das áreas montaram nesta conversa
 * (a seção aponta por número; a plataforma preenche). Devolve o documento ou o erro para a central corrigir.
 */
export function validarDocumento(bruto: unknown, visuais: Visual[], modulosValidos: string[]): { documento: Documento } | { erro: string } {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const tipo = b.tipo === "carta" ? "carta" : b.tipo === "relatorio" ? "relatorio" : null;
  if (!tipo) return { erro: "Diga o tipo do documento: relatorio (interno) ou carta (oferta, convite, comunicado)." };
  const titulo = t(b.titulo, 140);
  if (titulo.length < 3) return { erro: "Falta o título do documento." };
  const secoes: Secao[] = [];
  for (const s of (Array.isArray(b.secoes) ? b.secoes : []).slice(0, LIM.secoes) as Record<string, unknown>[]) {
    let g = grafico(s.grafico), tb = tabela(s.tabela);
    if (s.visual != null) {
      const v = visuais[Number(s.visual) - 1];
      if (!v) return { erro: `A seção "${t(s.titulo, 60)}" aponta para o visual ${String(s.visual)}, que não existe nesta conversa (há ${visuais.length}). Peça o gráfico à SARA da área ou mande os números.` };
      const d = doVisual(v);
      g = d.grafico ?? g; tb = d.tabela ?? tb;
    }
    const sec = { titulo: t(s.titulo, 120), texto: t(s.texto, 4000), tabela: tb, grafico: g };
    if (sec.titulo || sec.texto || sec.tabela || sec.grafico) secoes.push(sec);
  }
  const d = (b.destinatario ?? null) as Record<string, unknown> | null;
  const a = (b.assinatura ?? null) as Record<string, unknown> | null;
  const documento: Documento = {
    tipo, titulo, subtitulo: t(b.subtitulo, 200), assunto: t(b.assunto, 200), resumo: t(b.resumo, 2000), secoes,
    destinatario: d && t(d.nome, 120) ? { nome: t(d.nome, 120), cargo: t(d.cargo, 80), empresa: t(d.empresa, 120) } : null,
    insights: (Array.isArray(b.insights) ? b.insights : []).slice(0, LIM.insights).map((i) => ({ texto: t((i as Record<string, unknown>)?.texto, 600), confianca: conf((i as Record<string, unknown>)?.confianca) })).filter((i) => i.texto.length >= 3),
    recomendacoes: (Array.isArray(b.recomendacoes) ? b.recomendacoes : []).map((r) => t(r, 400)).filter(Boolean).slice(0, LIM.recomendacoes),
    quemDecide: t(b.quem_decide, 300),
    assinatura: a && t(a.nome, 120) ? { nome: t(a.nome, 120), cargo: t(a.cargo, 80) } : null,
    areas: [...new Set((Array.isArray(b.areas) ? b.areas : []).map(String).filter((m) => modulosValidos.includes(m)))],
  };
  if (tipo === "carta") {
    documento.insights = []; // carta externa: sem análise da IA
    if (!documento.destinatario) return { erro: "Carta precisa do destinatário (nome e, se houver, cargo e empresa)." };
    if (!documento.secoes.some((s) => s.texto)) return { erro: "Carta precisa do corpo (o texto, em uma ou mais seções)." };
  } else if (!documento.secoes.length) return { erro: "O relatório precisa de ao menos uma seção." };
  return { documento };
}

/**
 * O texto do documento que o verificador confere: tudo o que o MODELO escreveu (texto, células e valores de
 * gráfico digitados). O que veio de um visual da área foi preenchido pela plataforma e não entra.
 */
export function textoParaConferir(bruto: unknown): string {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const partes: string[] = [String(b.titulo ?? ""), String(b.subtitulo ?? ""), String(b.assunto ?? ""), String(b.resumo ?? "")];
  for (const s of (Array.isArray(b.secoes) ? b.secoes : []) as Record<string, unknown>[]) {
    partes.push(String(s.titulo ?? ""), String(s.texto ?? ""));
    if (s.visual != null) continue;
    const tb = s.tabela as { linhas?: unknown[][] } | undefined;
    for (const l of tb?.linhas ?? []) partes.push((Array.isArray(l) ? l : []).map((c) => (typeof c === "number" ? formatar(c, "numero") : String(c ?? ""))).join(" | "));
    const g = s.grafico as { series?: { valores?: unknown[] }[] } | undefined;
    for (const se of g?.series ?? []) partes.push((se.valores ?? []).map((v) => (typeof v === "number" ? formatar(v, "numero") : "")).join(" "));
  }
  for (const i of (Array.isArray(b.insights) ? b.insights : []) as Record<string, unknown>[]) partes.push(String(i?.texto ?? ""));
  for (const r of (Array.isArray(b.recomendacoes) ? b.recomendacoes : [])) partes.push(String(r ?? ""));
  return partes.join("\n");
}

/** "Comparação de financiamentos" → "DOC-2026-0007 Comparação de financiamentos.pdf" (sem caracteres que quebram o nome). */
export function nomeDoArquivo(numero: string, titulo: string): string {
  return `${numero} ${titulo}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".pdf";
}

/** Acha a pessoa pelo nome falado ("Ana", "a Rosana do RH"): uma só, ou a lista para perguntar. */
export function acharPessoa(nome: string, pessoas: { id: string; nome: string }[]): { pessoa: { id: string; nome: string } } | { erro: string } {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const alvo = n(nome).replace(/^(a|o|para a|para o|pra|para)\s+/, "");
  if (alvo.length < 2) return { erro: "Diga para quem enviar." };
  const exatos = pessoas.filter((p) => n(p.nome) === alvo);
  if (exatos.length === 1) return { pessoa: exatos[0] };
  const palavras = alvo.split(" ").filter((w) => w.length >= 2);
  const achados = pessoas.filter((p) => { const pn = ` ${n(p.nome)} `; return palavras.every((w) => pn.includes(` ${w} `) || pn.includes(` ${w}`)); });
  if (achados.length === 1) return { pessoa: achados[0] };
  if (!achados.length) return { erro: `Não achei ninguém ativo na plataforma chamado "${nome}".` };
  return { erro: `Há mais de uma pessoa: ${achados.slice(0, 6).map((p) => p.nome).join(", ")}. Para qual delas?` };
}
