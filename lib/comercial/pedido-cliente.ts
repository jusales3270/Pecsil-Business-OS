/**
 * Pedido do cliente → itens do orçamento (C-05). Só regra, sem banco e sem IA: lê as linhas de item do
 * pedido (texto do PDF), e ordena os produtos candidatos de cada linha. O Clef, quando ligado, só
 * desempata entre os candidatos; quem decide é a pessoa do Comercial, linha a linha.
 *
 * Linha de item de pedido de compra (ex.: O-I):
 *   "10 | 32036689 | BM.563916.08C30Y.CI882 | 2 | TLT | 478.798,95 | 20.02.2025 | 9.575,98"
 *   seguida, às vezes, de "por/Per 100 TLT" (o preço unitário é por 100).
 */

export type LinhaPedido = {
  /** Item do pedido do cliente (10, 20…). */
  item: string;
  /** Código de material do cliente (coluna própria), quando houver. */
  codigoMaterial: string | null;
  /** Descrição como veio (muitas vezes o código da peça no cliente, ex.: BM.563916.08C30Y.CI882). */
  descricao: string;
  quantidade: number;
  unidade: string;
  /** Preço por UMA unidade (já dividido quando o pedido diz "por 100"). */
  precoUnitario: number | null;
  /** Por quantas unidades o preço do pedido vinha (1, 100, 1000). */
  precoPor: number;
  entrega: string | null;
  valorItem: number | null;
  /** Avisos da leitura (ex.: o valor do item não bate com quantidade × preço). */
  avisos: string[];
};

export type CabecalhoPedido = { numero: string | null; condicaoPagamento: string | null };

const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?`;
const reais = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const dataIso = (s: string) => { const m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/** Lê as linhas de item. `linhas` é o texto do PDF linha a linha (pedaços separados por " | "). */
export function lerPedido(linhas: string[]): { cabecalho: CabecalhoPedido; itens: LinhaPedido[] } {
  const texto = linhas.join("\n");
  const numero = texto.match(/(?:Pedido(?: de)? Compra|Purchase Order|Pedido)\b[^\n]*\n?\s*N(?:r|º|o)?\.?\s*:?\s*(\d{4,20})/i)?.[1] ?? null;
  const condicaoPagamento = texto.match(/Condi[çc][ãa]o de Pagamento[^\n]*\n\s*([^\n]{3,60})/i)?.[1]?.replace(/\/\s*$/, "").trim() ?? null;
  const itens: LinhaPedido[] = [];
  const vistos = new Set<string>();
  const reItem = new RegExp(String.raw`^\s*(\d{1,5})\s*\|\s*(?:(\d{4,})\s*\|\s*)?([^|]{2,80}?)\s*\|\s*(${NUM})\s*\|\s*([A-Za-z]{1,6})\s*\|\s*(${NUM})\s*\|\s*(\d{2}[./]\d{2}[./]\d{4})\s*\|\s*(${NUM})\s*$`);
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(reItem);
    if (!m) continue;
    const [, item, codigoMaterial, descricao, qtd, unidade, preco, entrega, valor] = m;
    if (vistos.has(item)) continue; // a mesma linha repetida no cabeçalho de outra página
    vistos.add(item);
    // "por/Per 100 TLT" nas linhas seguintes (antes do próximo item).
    let por = 1;
    for (let j = i + 1; j < Math.min(linhas.length, i + 4); j++) {
      if (reItem.test(linhas[j])) break;
      const p = linhas[j].match(/\bpor\s*\/?\s*per\s+(\d{1,5})\b/i);
      if (p) { por = Number(p[1]) || 1; break; }
    }
    const quantidade = reais(qtd), bruto = reais(preco), valorItem = reais(valor);
    const precoUnitario = Math.round((bruto / por) * 10000) / 10000;
    const avisos: string[] = [];
    if (Math.abs(quantidade * precoUnitario - valorItem) > Math.max(0.05, valorItem * 0.001)) {
      avisos.push(`O valor do item (${valorItem.toFixed(2)}) não bate com quantidade × preço (${(quantidade * precoUnitario).toFixed(2)}): confira o preço.`);
    }
    itens.push({ item, codigoMaterial: codigoMaterial ?? null, descricao: descricao.trim(), quantidade, unidade: unidade.toUpperCase(), precoUnitario, precoPor: por, entrega: dataIso(entrega), valorItem, avisos });
  }
  return { cabecalho: { numero, condicaoPagamento }, itens };
}

/** Peça no código do cliente: prefixo de 2 letras, artigo de 6 dígitos e o material no fim (ex.: CI882). */
export function pecaDoCodigo(descricao: string): { prefixo: string; artigo: string; material: string | null } | null {
  const m = descricao.toUpperCase().match(/\b([A-Z]{2})\.(\d{6})\.[A-Z0-9]+(?:\.([A-Z]{2})-?(\d{3}))?\b/);
  return m ? { prefixo: m[1], artigo: m[2], material: m[3] ? `${m[3]}-${m[4]}` : null } : null;
}

/**
 * Prefixo do cliente → tipo de peça do catálogo (convenção das máquinas IS: blank mold, blow mold…).
 * PROPOSTA a confirmar pelo Comercial (Rafael): só ordena os candidatos, nunca decide sozinha.
 */
export const TIPO_POR_PREFIXO: Record<string, string> = { BM: "forma", BL: "bloco", BP: "fundo_forma", BF: "fundo_bloco", PL: "puncao" };

export type Produto = { id: string; codigo: string; descricao: string; unidade: string; tipo_peca: string | null; nome_cliente: string | null; desenho_codigo: string | null };
export type Candidato = { produto: Produto; motivo: "de_para" | "artigo" | "descricao"; pontos: number; explicacao: string };

export type Cliente = { id: string; name: string; tax_id: string | null };

/**
 * Cliente do pedido, por regra: o CNPJ do texto que está no cadastro; senão, o nome do cliente do
 * cadastro escrito no pedido (o mais longo que aparece). A própria empresa (que também está no
 * pedido) fica de fora.
 */
export function clienteDoPedido(linhas: string[], clientes: Cliente[], cnpjProprio: string | null): { cliente: Cliente; motivo: "cnpj" | "nome" } | null {
  const texto = linhas.join("\n");
  const proprio = (cnpjProprio ?? "").replace(/\D/g, "");
  const cnpjs = [...texto.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)].map((m) => m[0].replace(/\D/g, "")).filter((c) => c.length === 14 && c !== proprio);
  for (const c of cnpjs) {
    const achado = clientes.find((x) => (x.tax_id ?? "").replace(/\D/g, "") === c);
    if (achado) return { cliente: achado, motivo: "cnpj" };
  }
  const t = norm(texto);
  const porNome = clientes.filter((x) => norm(x.name).length >= 8 && t.includes(norm(x.name))).sort((a, b) => norm(b.name).length - norm(a.name).length);
  return porNome[0] ? { cliente: porNome[0], motivo: "nome" } : null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Candidatos de uma linha, do mais provável ao menos. De-para exato vem sozinho no topo. */
export function candidatos(linha: Pick<LinhaPedido, "descricao" | "codigoMaterial">, produtos: Produto[], limite = 5): Candidato[] {
  const codigo = norm(linha.descricao);
  const exatos = produtos.filter((p) => p.nome_cliente && (norm(p.nome_cliente) === codigo || (linha.codigoMaterial && norm(p.nome_cliente) === norm(linha.codigoMaterial))));
  if (exatos.length) return exatos.slice(0, limite).map((produto) => ({ produto, motivo: "de_para", pontos: 100, explicacao: "Já ligado a este código do cliente (de-para)." }));
  const peca = pecaDoCodigo(linha.descricao);
  const lista: Candidato[] = [];
  if (peca) {
    const tipo = TIPO_POR_PREFIXO[peca.prefixo];
    for (const p of produtos) {
      const d = norm(p.descricao);
      if (!d.includes(peca.artigo) && p.desenho_codigo !== peca.artigo) continue;
      let pontos = 50; const porque = [`artigo ${peca.artigo}`];
      if (tipo && p.tipo_peca === tipo) { pontos += 30; porque.push(`tipo ${tipo.replace("_", " ")} (${peca.prefixo})`); }
      if (peca.material && d.includes(peca.material)) { pontos += 15; porque.push(`material ${peca.material}`); }
      lista.push({ produto: p, motivo: "artigo", pontos, explicacao: `Provável pelo ${porque.join(", ")}: confira.` });
    }
  }
  if (!lista.length) {
    const palavras = norm(linha.descricao).split(/[^A-Z0-9]+/).filter((w) => w.length >= 3);
    for (const p of produtos) {
      const d = norm(`${p.descricao} ${p.codigo}`);
      const acertos = palavras.filter((w) => d.includes(w)).length;
      if (acertos) lista.push({ produto: p, motivo: "descricao", pontos: Math.round((acertos / palavras.length) * 40), explicacao: `${acertos} de ${palavras.length} palavra(s) da descrição.` });
    }
  }
  return lista.sort((a, b) => b.pontos - a.pontos || a.produto.descricao.localeCompare(b.produto.descricao)).slice(0, limite);
}
