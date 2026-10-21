/**
 * Núcleo puro da Biblioteca da Fundição (sem rede, sem banco).
 *
 * Converte `GET /api/integracao/desenhos` da Forja nas linhas de `fundicao_desenhos` e decide,
 * comparando com o que já está gravado, o que inserir, atualizar, baixar e marcar como removido
 * na Forja. O arquivo é baixado quando o desenho é novo ou quando a chave do arquivo mudou (a
 * Forja apaga o antigo ao trocar; aqui a versão anterior fica guardada).
 */

type Row = Record<string, unknown>;

const record = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const timestamp = (value: unknown): string | null => {
  const s = text(value);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};
const dateOnly = (value: unknown): string | null => {
  const s = text(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const TIPOS = new Set(["cliente", "forma", "acompanhamento_dim"]);

export type DesenhoForja = {
  forja_desenho_id: string;
  forja_artigo_id: string | null;
  artigo_codigo: string;
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
  forja_arquivo_key: string;
  forja_atualizado_em: string | null;
  arquivo: { nome: string; mime: string | null; tamanho: number | null };
};

/** Lista da Forja → linhas. Desenho sem id, sem artigo ou sem arquivo é descartado. */
export function parseDesenhos(lista: unknown): { desenhos: DesenhoForja[]; rejeitados: number } {
  const itens = Array.isArray(lista) ? lista : [];
  const desenhos: DesenhoForja[] = [];
  for (const item of itens) {
    const d = record(item);
    const artigo = record(d.artigo);
    const cliente = record(d.cliente);
    const fundicao = record(d.fundicao);
    const id = text(d.id);
    const artigoCodigo = text(artigo.codigo);
    const chave = text(d.arquivoKey);
    const codigo = text(d.codigoDesenho);
    if (!id || !artigoCodigo || !chave || !codigo) continue;
    desenhos.push({
      forja_desenho_id: id,
      forja_artigo_id: text(artigo.id),
      artigo_codigo: artigoCodigo,
      artigo_descricao: text(artigo.descricao),
      cliente_nome: text(cliente.nome),
      tipo: TIPOS.has(String(d.tipo)) ? String(d.tipo) : "outro",
      codigo,
      revisao: text(d.revisao) ?? "",
      data_revisao: dateOnly(d.dataRevisao),
      observacoes: text(d.observacoes),
      fundicao_prevista: fundicao.prevista === true,
      primeira_fundicao_em: timestamp(fundicao.primeiraEm),
      ultima_fundicao_em: timestamp(fundicao.ultimaEm),
      os_codigos: (Array.isArray(fundicao.os) ? fundicao.os : []).map(text).filter((x): x is string => Boolean(x)).sort(),
      forja_arquivo_key: chave,
      forja_atualizado_em: timestamp(d.atualizadoEm),
      arquivo: {
        nome: text(d.arquivoNomeOriginal) ?? `${codigo}${d.revisao ? `-${d.revisao}` : ""}`,
        mime: text(d.arquivoTipo),
        tamanho: typeof d.arquivoTamanho === "number" ? d.arquivoTamanho : null,
      },
    });
  }
  return { desenhos, rejeitados: itens.length - desenhos.length };
}

/** Campos que, se mudarem na Forja, atualizam a linha (o arquivo é decidido à parte). */
export const CAMPOS = [
  "forja_artigo_id", "artigo_codigo", "artigo_descricao", "cliente_nome", "tipo", "codigo", "revisao", "data_revisao", "observacoes",
  "fundicao_prevista", "primeira_fundicao_em", "ultima_fundicao_em", "os_codigos",
] as const;

export type Gravado = Row & { id: string; forja_desenho_id: string; forja_arquivo_key: string | null; removido_na_forja_em: string | null; tem_arquivo: boolean };

const igual = (a: unknown, b: unknown) => {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify([...((a as unknown[]) ?? [])].sort()) === JSON.stringify([...((b as unknown[]) ?? [])].sort());
  if (typeof a === "string" && typeof b === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a)) return Date.parse(a) === Date.parse(b);
  return (a ?? null) === (b ?? null);
};

export function mudou(novo: DesenhoForja, atual: Row): boolean {
  return CAMPOS.some((campo) => !igual(novo[campo], atual[campo]));
}

export type Plano = {
  novos: DesenhoForja[];
  alterados: { id: string; desenho: DesenhoForja }[];
  /** Precisam baixar o arquivo: novos, com chave trocada ou que ainda não têm arquivo guardado. */
  baixar: { forja_desenho_id: string; chave: string }[];
  /** Sumiram da Forja: ficam na Biblioteca, marcados. */
  removidos: string[];
  /** Voltaram a aparecer depois de marcados como removidos. */
  voltaram: string[];
  iguais: number;
};

export function planejar(desenhos: DesenhoForja[], gravados: Gravado[]): Plano {
  const porForja = new Map(gravados.map((g) => [g.forja_desenho_id, g]));
  const vigentes = new Set(desenhos.map((d) => d.forja_desenho_id));
  const plano: Plano = { novos: [], alterados: [], baixar: [], removidos: [], voltaram: [], iguais: 0 };
  for (const d of desenhos) {
    const atual = porForja.get(d.forja_desenho_id);
    if (!atual) {
      plano.novos.push(d);
      plano.baixar.push({ forja_desenho_id: d.forja_desenho_id, chave: d.forja_arquivo_key });
      continue;
    }
    if (atual.removido_na_forja_em) plano.voltaram.push(atual.id);
    if (mudou(d, atual)) plano.alterados.push({ id: atual.id, desenho: d });
    else if (!atual.removido_na_forja_em) plano.iguais += 1;
    if (atual.forja_arquivo_key !== d.forja_arquivo_key || !atual.tem_arquivo) plano.baixar.push({ forja_desenho_id: d.forja_desenho_id, chave: d.forja_arquivo_key });
  }
  for (const g of gravados) if (!vigentes.has(g.forja_desenho_id) && !g.removido_na_forja_em) plano.removidos.push(g.id);
  return plano;
}

const EXTENSOES: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

/** Extensão do arquivo guardado (pelo tipo; senão, pelo nome; senão, "bin"). */
export function extensao(mime: string | null, nome: string): string {
  const porTipo = mime ? EXTENSOES[mime.split(";")[0].trim().toLowerCase()] : undefined;
  if (porTipo) return porTipo;
  const m = /\.([a-z0-9]{1,5})$/i.exec(nome);
  return m ? m[1].toLowerCase() : "bin";
}

/** Caminho no bucket: org/desenho/sha256.ext — o mesmo arquivo cai sempre no mesmo lugar. */
export const caminhoArquivo = (org: string, desenhoId: string, hash: string, ext: string) => `${org}/${desenhoId}/${hash}.${ext}`;
