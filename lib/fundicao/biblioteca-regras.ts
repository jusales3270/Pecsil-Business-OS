/**
 * Regras puras da Biblioteca da Fundição (sem rede, sem banco): busca, revisão atual,
 * agrupamento por peça e validação do envio de desenho antigo.
 */

export const TIPOS_DESENHO = { cliente: "Desenho do cliente", forma: "Desenho da forma", acompanhamento_dim: "Acompanhamento dimensional", outro: "Outro" } as const;
export type TipoDesenho = keyof typeof TIPOS_DESENHO;

export const ARQUIVOS_ACEITOS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
export const LIMITE_ARQUIVO = 50 * 1024 * 1024;

/** Termo de busca seguro para o filtro `or` do PostgREST (vírgula, parênteses e curingas viram espaço). */
export function termoDeBusca(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const t = q.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return t.length >= 2 ? t : null;
}

export type DesenhoLinha = {
  id: string;
  origem: "forja" | "acervo";
  artigo_codigo: string;
  artigo_chave: string;
  artigo_descricao: string | null;
  cliente_nome: string | null;
  tipo: string;
  codigo: string;
  revisao: string;
  data_revisao: string | null;
  observacoes: string | null;
  fundicao_prevista: boolean;
  primeira_fundicao_em: string | null;
  ultima_fundicao_em: string | null;
  os_codigos: string[];
  removido_na_forja_em: string | null;
  enviado_por: string | null;
  enviado_por_nome: string | null;
  created_at: string;
};

export type VersaoLinha = { id: string; desenho_id: string; mime: string | null; tamanho: number | null; nome: string | null; recebido_em: string; substituido_em: string | null };

/** Compara revisões: "B" < "C", "2" < "10", "A1" < "A2". */
export function compararRevisao(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * Revisão atual: por peça, tipo e código do desenho, a de data de revisão mais recente
 * (sem data, a de revisão maior). Removido na Forja não conta como atual.
 */
export function revisoesAtuais(desenhos: Pick<DesenhoLinha, "id" | "artigo_chave" | "tipo" | "codigo" | "revisao" | "data_revisao" | "removido_na_forja_em">[]): Set<string> {
  const melhor = new Map<string, (typeof desenhos)[number]>();
  for (const d of desenhos) {
    if (d.removido_na_forja_em) continue;
    const chave = `${d.artigo_chave}|${d.tipo}|${d.codigo.toUpperCase()}`;
    const atual = melhor.get(chave);
    if (!atual) { melhor.set(chave, d); continue; }
    const porData = (d.data_revisao ?? "").localeCompare(atual.data_revisao ?? "");
    if (porData > 0 || (porData === 0 && compararRevisao(d.revisao, atual.revisao) > 0)) melhor.set(chave, d);
  }
  return new Set([...melhor.values()].map((d) => d.id));
}

export type Peca = {
  chave: string;
  codigo: string;
  descricao: string | null;
  cliente: string | null;
  fundidaEm: string | null;
  prevista: boolean;
  os: string[];
  desenhos: (DesenhoLinha & { atual: boolean; versoes: VersaoLinha[] })[];
};

/** Agrupa por peça (código do artigo), na ordem em que as linhas chegaram. */
export function agruparPorPeca(desenhos: DesenhoLinha[], versoes: VersaoLinha[]): Peca[] {
  const atuais = revisoesAtuais(desenhos);
  const versoesDe = new Map<string, VersaoLinha[]>();
  for (const v of versoes) versoesDe.set(v.desenho_id, [...(versoesDe.get(v.desenho_id) ?? []), v]);
  const pecas = new Map<string, Peca>();
  for (const d of desenhos) {
    const p = pecas.get(d.artigo_chave) ?? { chave: d.artigo_chave, codigo: d.artigo_codigo, descricao: null, cliente: null, fundidaEm: null, prevista: false, os: [], desenhos: [] };
    p.descricao ??= d.artigo_descricao;
    p.cliente ??= d.cliente_nome;
    p.prevista ||= d.fundicao_prevista;
    if (d.ultima_fundicao_em && (!p.fundidaEm || d.ultima_fundicao_em > p.fundidaEm)) p.fundidaEm = d.ultima_fundicao_em;
    p.os = [...new Set([...p.os, ...d.os_codigos])].sort();
    // Versão atual primeiro; as antigas, da mais nova para a mais velha.
    const vs = [...(versoesDe.get(d.id) ?? [])].sort((a, b) => (a.substituido_em ? 1 : 0) - (b.substituido_em ? 1 : 0) || b.recebido_em.localeCompare(a.recebido_em));
    p.desenhos.push({ ...d, atual: atuais.has(d.id), versoes: vs });
    pecas.set(d.artigo_chave, p);
  }
  for (const p of pecas.values()) {
    p.desenhos.sort((a, b) => Number(b.atual) - Number(a.atual) || a.tipo.localeCompare(b.tipo) || a.codigo.localeCompare(b.codigo) || compararRevisao(b.revisao, a.revisao));
  }
  return [...pecas.values()];
}

export type EnvioAcervo = {
  product_id: string | null;
  artigo_codigo: string | null;
  artigo_descricao: string | null;
  cliente_nome: string | null;
  tipo: TipoDesenho;
  codigo: string;
  revisao: string;
  data_revisao: string | null;
  observacoes: string | null;
};

const campo = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê o formulário do envio de desenho antigo. */
export function lerEnvioAcervo(form: FormData): { ok: true; dados: EnvioAcervo } | { ok: false; erro: string } {
  const produto = campo(form.get("product_id"), 40);
  const dados: EnvioAcervo = {
    product_id: produto && UUID.test(produto) ? produto : null,
    artigo_codigo: campo(form.get("artigo_codigo"), 100),
    artigo_descricao: campo(form.get("artigo_descricao"), 300),
    cliente_nome: campo(form.get("cliente_nome"), 200),
    tipo: ((t) => (t && t in TIPOS_DESENHO ? (t as TipoDesenho) : "outro"))(campo(form.get("tipo"), 30)),
    codigo: campo(form.get("codigo"), 100) ?? "",
    revisao: campo(form.get("revisao"), 30) ?? "",
    data_revisao: ((d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null))(campo(form.get("data_revisao"), 10)),
    observacoes: campo(form.get("observacoes"), 2000),
  };
  if (!dados.product_id && !dados.artigo_codigo) return { ok: false, erro: "Escolha a peça no cadastro ou digite o código do artigo." };
  if (!dados.codigo) return { ok: false, erro: "Informe o código do desenho." };
  return { ok: true, dados };
}

/** Confere o arquivo: só PDF, PNG ou JPEG de até 50 MB. Devolve a extensão. */
export function conferirArquivo(arquivo: { type: string; size: number; name: string }): { ok: true; ext: string; mime: string } | { ok: false; erro: string } {
  const mime = arquivo.type.split(";")[0].trim().toLowerCase();
  const ext = ARQUIVOS_ACEITOS[mime];
  if (!ext) return { ok: false, erro: "O desenho precisa ser PDF, PNG ou JPEG." };
  if (arquivo.size <= 0) return { ok: false, erro: "O arquivo está vazio." };
  if (arquivo.size > LIMITE_ARQUIVO) return { ok: false, erro: "O arquivo passa de 50 MB." };
  return { ok: true, ext, mime };
}
