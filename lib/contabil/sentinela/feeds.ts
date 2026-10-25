/**
 * Sentinela (N-02): leitura das fontes. Tudo puro: recebe o texto que a fonte devolveu e devolve os itens
 * (título, link, data, resumo). RSS 2.0, RSS 1.0/RDF (o "@@search_rss" dos sites gov.br) e Atom, mais os
 * JSON do Senado, do Diário Oficial de SP, do Banco Central e dos feriados. Fontes testadas em 25/10/2026:
 * docs/contabil/fontes-sentinela.md.
 */

export type ItemFonte = { titulo: string; url: string; data: string | null; resumo: string };

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ordm: "º", ordf: "ª", deg: "°", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»" };

/** HTML → texto corrido: tira scripts, estilos e marcação, resolve entidades e junta os espaços. */
export function textoDeHtml(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const campo = (bloco: string, nomes: string[]) => {
  for (const n of nomes) {
    const m = bloco.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return m[1];
  }
  return null;
};
const linkAtom = (bloco: string) => bloco.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? bloco.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? null;

/** Data do feed (RFC 822, ISO ou o "Sex, out 23 2026" do STJ) → ISO, ou null. */
export function dataDoFeed(v: string | null): string | null {
  if (!v) return null;
  const t = textoDeHtml(v).trim();
  // Formato brasileiro primeiro: "12/08/2026" é 12 de agosto (o Date.parse leria 8 de dezembro).
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T12:00:00-03:00`).toISOString();
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  const MES: Record<string, number> = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
  const m = t.toLowerCase().match(/([a-zç]{3})[a-zç]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m && m[1] in MES) return new Date(Date.UTC(Number(m[3]), MES[m[1]], Number(m[2]), Number(m[4] ?? 12) + 3, Number(m[5] ?? 0))).toISOString();
  const meio = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (meio) return new Date(`${meio[3]}-${meio[2]}-${meio[1]}T12:00:00-03:00`).toISOString();
  return null;
}

/** Páginas de pasta e de imagem que o RSS dos sites gov.br mistura com as notícias. */
const RUIDO = /\/(carrossel|colecao|todas-as-noticias|ultimas-noticias|RSS)\/?$|\.(png|jpe?g|gif|svg|webp)(\/view)?$/i;

/** RSS 2.0, RSS 1.0 (RDF) ou Atom → itens. */
export function lerFeed(xml: string): ItemFonte[] {
  const blocos = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const itens: ItemFonte[] = [];
  for (const b of blocos) {
    const titulo = textoDeHtml(campo(b, ["title"]) ?? "").slice(0, 400);
    const url = textoDeHtml(campo(b, ["link"]) ?? "").trim() || linkAtom(b) || "";
    if (!titulo || !/^https?:\/\//.test(url) || RUIDO.test(url)) continue;
    const corpo = campo(b, ["content:encoded", "description", "summary", "content"]) ?? "";
    itens.push({ titulo, url, data: dataDoFeed(campo(b, ["pubDate", "dc:date", "updated", "published"])), resumo: textoDeHtml(corpo).slice(0, 4000) });
  }
  return itens;
}

/** Senado, Dados Abertos (legislacao/lista.json): leis, leis complementares, medidas provisórias e decretos. */
export function lerSenado(json: unknown): ItemFonte[] {
  const docs = (json as { ListaDocumento?: { documentos?: { documento?: unknown } } })?.ListaDocumento?.documentos?.documento;
  const lista = Array.isArray(docs) ? docs : docs ? [docs] : [];
  return lista.flatMap((d) => {
    const x = d as Record<string, string>;
    if (!x?.normaNome) return [];
    const urn = x.norma ? `https://legis.senado.leg.br/norma/${x.id}` : "";
    return [{ titulo: x.normaNome, url: urn, data: dataDoFeed(x.dataassinatura ?? null), resumo: (x.ementa ?? "").slice(0, 4000) }];
  });
}

/**
 * Diário Oficial de SP (API do próprio site). Só atos normativos: as notificações de autuação trazem
 * contribuinte, CNPJ e endereço de terceiros e ficam de fora antes de qualquer coisa.
 */
const ATO_NORMATIVO_SP = /^(resolu[çc][ãa]o|portaria|decreto|lei|comunicado (cat|sre|da|conjunto)|instru[çc][ãa]o)/i;
const AUTUACAO = /AIIM|notifica[çc][ãa]o|contribuinte:|I\.E\.\s*:|CNPJ\/CPF/i;
export function lerDoeSp(json: unknown): ItemFonte[] {
  const itens = (json as { items?: unknown[] })?.items ?? [];
  return itens.flatMap((i) => {
    const x = i as { title?: string; slug?: string; date?: string; excerpt?: string; hierarchy?: string };
    const titulo = (x.title ?? "").trim();
    const resumo = (x.excerpt ?? "").trim();
    if (!titulo || !ATO_NORMATIVO_SP.test(titulo) || AUTUACAO.test(resumo)) return [];
    if (!/fazenda/i.test(x.hierarchy ?? "") && !/^decreto|^lei/i.test(titulo)) return [];
    return [{ titulo: `${titulo}${x.hierarchy ? ` (${x.hierarchy.split(">").pop()?.trim()})` : ""}`, url: `https://doe.sp.gov.br/${x.slug ?? ""}`, data: x.date ? new Date(`${x.date.slice(0, 19)}-03:00`).toISOString() : null, resumo: resumo.slice(0, 4000) }];
  });
}

/** Série do Banco Central (SGS): [{data: "01/10/2026", valor: "0.82"}] → competência AAAA-MM e taxa em %. */
export function lerSerieBcb(json: unknown): { competencia: string; valor: number }[] {
  return (Array.isArray(json) ? json : []).flatMap((p) => {
    const m = String((p as { data?: string }).data ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const v = Number(String((p as { valor?: string }).valor ?? "").replace(",", "."));
    return m && Number.isFinite(v) ? [{ competencia: `${m[3]}-${m[2]}`, valor: v }] : [];
  });
}

/** Feriados nacionais (BrasilAPI): [{date, name, type}] → lista do ano. */
export function lerFeriados(json: unknown): { data: string; nome: string }[] {
  return (Array.isArray(json) ? json : []).flatMap((f) => {
    const x = f as { date?: string; name?: string; type?: string };
    return x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.name && (x.type ?? "national") === "national" ? [{ data: x.date, nome: x.name }] : [];
  });
}

/** Chave estável do item para não registrar duas vezes (o hash é feito em quem chama). */
export const chaveDoItem = (fonteId: string, item: Pick<ItemFonte, "url" | "titulo">) =>
  `${fonteId}|${item.url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase()}|${item.titulo.toLowerCase().replace(/\s+/g, " ").trim()}`;
