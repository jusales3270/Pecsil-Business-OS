/**
 * Leitor de XML em árvore, sem dependência, para os documentos fiscais (NF-e e afins): elementos, atributos e
 * texto. Ignora a declaração, comentários e o prefixo de namespace. Não resolve DTD nem entidades externas (as
 * notas não usam). Puro e testável.
 */

export type NoXml = { nome: string; atributos: Record<string, string>; filhos: NoXml[]; texto: string };

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodificar = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e.toLowerCase()] ?? m);
const semPrefixo = (n: string) => n.slice(n.indexOf(":") + 1);

/** Lê o XML e devolve o elemento raiz. Lança erro se as tags não fecharem. */
export function lerXml(xml: string): NoXml {
  const raiz: NoXml = { nome: "#documento", atributos: {}, filhos: [], texto: "" };
  const pilha: NoXml[] = [raiz];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const atual = pilha[pilha.length - 1];
    if (m[1] !== undefined) { atual.texto += m[1]; continue; }
    if (m[2]) {
      const nome = semPrefixo(m[2]);
      if (pilha.length < 2 || atual.nome !== nome) throw new Error(`XML mal formado: </${nome}> sem abertura.`);
      atual.texto = atual.filhos.length ? "" : decodificar(atual.texto).trim();
      pilha.pop();
      continue;
    }
    if (m[3]) {
      const no: NoXml = { nome: semPrefixo(m[3]), atributos: {}, filhos: [], texto: "" };
      for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) no.atributos[semPrefixo(a[1])] = decodificar(a[2] ?? a[3] ?? "");
      atual.filhos.push(no);
      if (!m[5]) pilha.push(no);
      continue;
    }
    if (m[6] !== undefined && pilha.length > 1) atual.texto += m[6];
  }
  if (pilha.length !== 1) throw new Error(`XML mal formado: <${pilha[pilha.length - 1].nome}> não fechada.`);
  const [primeiro] = raiz.filhos;
  if (!primeiro) throw new Error("XML vazio.");
  return primeiro;
}

/** Primeiro descendente com o nome (busca em profundidade). */
export function achar(no: NoXml | null | undefined, nome: string): NoXml | null {
  if (!no) return null;
  for (const f of no.filhos) {
    if (f.nome === nome) return f;
    const r = achar(f, nome);
    if (r) return r;
  }
  return null;
}

/** Filho direto pelo nome (ou caminho "a/b/c"). */
export function filho(no: NoXml | null | undefined, caminho: string): NoXml | null {
  let atual: NoXml | null | undefined = no;
  for (const parte of caminho.split("/")) {
    atual = atual?.filhos.find((f) => f.nome === parte);
    if (!atual) return null;
  }
  return atual ?? null;
}

export const filhos = (no: NoXml | null | undefined, nome: string) => (no ? no.filhos.filter((f) => f.nome === nome) : []);

/** Texto do filho (ou caminho), ou "" quando não existe. */
export const txt = (no: NoXml | null | undefined, caminho: string) => filho(no, caminho)?.texto ?? "";

/** Número do filho; ausente ou vazio vira 0. */
export const num = (no: NoXml | null | undefined, caminho: string) => {
  const t = txt(no, caminho);
  const n = Number(t);
  return t && Number.isFinite(n) ? n : 0;
};

/**
 * A árvore como lista de caminhos e valores, para comparar dois XML campo a campo. Irmãos com o mesmo nome levam
 * o índice ([1], [2]…); atributos entram como @nome. Elementos vazios entram com valor "".
 */
export function achatar(no: NoXml, prefixo = ""): Map<string, string> {
  const saida = new Map<string, string>();
  const caminho = prefixo ? `${prefixo}/${no.nome}` : no.nome;
  for (const [k, v] of Object.entries(no.atributos)) if (k !== "xmlns") saida.set(`${caminho}/@${k}`, v);
  if (!no.filhos.length) { saida.set(caminho, no.texto); return saida; }
  const contagem = new Map<string, number>();
  for (const f of no.filhos) contagem.set(f.nome, (contagem.get(f.nome) ?? 0) + 1);
  const vistos = new Map<string, number>();
  for (const f of no.filhos) {
    const i = (vistos.get(f.nome) ?? 0) + 1;
    vistos.set(f.nome, i);
    const sub = achatar(f, caminho);
    const repetido = (contagem.get(f.nome) ?? 0) > 1;
    for (const [k, v] of sub) saida.set(repetido ? k.replace(`${caminho}/${f.nome}`, `${caminho}/${f.nome}[${i}]`) : k, v);
  }
  return saida;
}
