/**
 * Parâmetros legais com vigência (módulo Contábil-Fiscal, N-01). Três camadas: legal (igual para
 * todas as empresas), UF/município e a exceção da empresa. Tudo aqui é puro: recebe as linhas já
 * lidas do banco e responde qual valor vale numa data, sem buscar nada e sem modelo.
 * Desenho em docs/PLANO-CONTABIL-FISCAL.md, §3.
 */

export type Escopo = "legal" | "uf" | "municipio";
export type SituacaoParametro = "rascunho" | "conferido" | "descartado";
export type Confianca = "alta" | "media" | "baixa";

export type Fonte = { norma: string; url: string; trecho?: string | null };

export type Parametro = {
  id: string;
  chave: string;
  titulo: string;
  escopo: Escopo;
  uf: string | null;
  codigo_municipio: string | null;
  valor: unknown;
  vigente_de: string;
  vigente_ate: string | null;
  fonte: Fonte;
  confianca: Confianca;
  observacao: string | null;
  situacao: SituacaoParametro;
};

/** Exceção da empresa (camada 3): vale mais que qualquer outra camada no período dela. */
export type Excecao = { id: string; chave: string; valor: unknown; vigente_de: string; vigente_ate: string | null; motivo: string };

export type Local = { uf?: string | null; codigoMunicipio?: string | null };

/** O valor que vale, de onde veio e se ainda falta o contador conferir. */
export type Vigencia<T = unknown> = {
  chave: string;
  valor: T;
  vigenteDe: string;
  vigenteAte: string | null;
  camada: "excecao" | Escopo;
  fonte: Fonte | null;
  situacao: SituacaoParametro | "excecao";
  aConferir: boolean;
  parametroId: string | null;
};

const PESO: Record<Escopo, number> = { municipio: 3, uf: 2, legal: 1 };

/** A data (AAAA-MM-DD) está dentro do período? `ate` nulo = em aberto. */
export const cobre = (de: string, ate: string | null, data: string) => de <= data && (ate === null || data <= ate);

function serveAoLocal(p: Parametro, local: Local) {
  if (p.escopo === "legal") return true;
  if (p.escopo === "uf") return Boolean(local.uf) && p.uf === local.uf;
  return Boolean(local.codigoMunicipio) && p.codigo_municipio === local.codigoMunicipio;
}

/**
 * Qual valor da `chave` vale na `data` (a do fato gerador, não a de hoje).
 * Precedência: exceção da empresa > município > UF > legal. Na mesma camada, o conferido vence o
 * rascunho; sem conferido, usa o rascunho e marca `aConferir`. Descartado nunca entra.
 */
export function vigente<T = unknown>(parametros: readonly Parametro[], chave: string, data: string, local: Local = {}, excecoes: readonly Excecao[] = []): Vigencia<T> | null {
  const excecao = excecoes
    .filter((e) => e.chave === chave && cobre(e.vigente_de, e.vigente_ate, data))
    .sort((a, b) => b.vigente_de.localeCompare(a.vigente_de))[0];
  if (excecao) {
    return { chave, valor: excecao.valor as T, vigenteDe: excecao.vigente_de, vigenteAte: excecao.vigente_ate, camada: "excecao", fonte: null, situacao: "excecao", aConferir: false, parametroId: null };
  }
  const candidatos = parametros
    .filter((p) => p.chave === chave && p.situacao !== "descartado" && serveAoLocal(p, local) && cobre(p.vigente_de, p.vigente_ate, data))
    .sort((a, b) =>
      PESO[b.escopo] - PESO[a.escopo]
      || Number(b.situacao === "conferido") - Number(a.situacao === "conferido")
      || b.vigente_de.localeCompare(a.vigente_de));
  const p = candidatos[0];
  if (!p) return null;
  return { chave, valor: p.valor as T, vigenteDe: p.vigente_de, vigenteAte: p.vigente_ate, camada: p.escopo, fonte: p.fonte, situacao: p.situacao, aConferir: p.situacao !== "conferido", parametroId: p.id };
}

/** Igual a `vigente`, mas falha com uma mensagem clara quando o parâmetro não existe na data. */
export function exigir<T = unknown>(parametros: readonly Parametro[], chave: string, data: string, local: Local = {}, excecoes: readonly Excecao[] = []): Vigencia<T> {
  const v = vigente<T>(parametros, chave, data, local, excecoes);
  if (!v) throw new Error(`Não há parâmetro "${chave}" vigente em ${data.split("-").reverse().join("/")}.`);
  return v;
}

/** As versões de uma chave, da mais nova para a mais antiga (para o histórico na tela). */
export function historico(parametros: readonly Parametro[], chave: string) {
  return parametros.filter((p) => p.chave === chave).sort((a, b) => b.vigente_de.localeCompare(a.vigente_de) || a.situacao.localeCompare(b.situacao));
}

/** A versão "da vez" de cada chave na data: a que a tela mostra na lista. */
export function atuais(parametros: readonly Parametro[], data: string) {
  const porChave = new Map<string, Parametro>();
  for (const p of parametros) {
    if (p.situacao === "descartado") continue;
    const atual = porChave.get(p.chave);
    const cobreHoje = cobre(p.vigente_de, p.vigente_ate, data);
    if (!atual) { porChave.set(p.chave, p); continue; }
    const atualCobre = cobre(atual.vigente_de, atual.vigente_ate, data);
    if (cobreHoje && !atualCobre) porChave.set(p.chave, p);
    else if (cobreHoje === atualCobre && p.vigente_de > atual.vigente_de) porChave.set(p.chave, p);
  }
  return [...porChave.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/** Rascunhos com vigência futura ou que ainda esperam o contador (as "propostas" da lista). */
export const pendentes = (parametros: readonly Parametro[]) => parametros.filter((p) => p.situacao === "rascunho");

/** Validação do que chega da tela para uma nova vigência. Devolve a lista de problemas. */
export function problemasDaNovaVigencia(p: { chave?: unknown; escopo?: unknown; uf?: unknown; codigo_municipio?: unknown; vigente_de?: unknown; vigente_ate?: unknown; norma?: unknown; url?: unknown; confianca?: unknown; valor?: unknown }) {
  const erros: string[] = [];
  if (typeof p.chave !== "string" || !/^[a-z0-9_]{3,80}$/.test(p.chave)) erros.push("chave inválida");
  if (!["legal", "uf", "municipio"].includes(String(p.escopo))) erros.push("escopo inválido");
  if (p.escopo === "uf" && !/^[A-Z]{2}$/.test(String(p.uf ?? ""))) erros.push("UF obrigatória");
  if (p.escopo === "municipio" && !/^\d{7}$/.test(String(p.codigo_municipio ?? ""))) erros.push("código IBGE do município obrigatório");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.vigente_de ?? ""))) erros.push("início da vigência obrigatório");
  if (p.vigente_ate && (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.vigente_ate)) || String(p.vigente_ate) < String(p.vigente_de))) erros.push("fim da vigência inválido");
  if (typeof p.norma !== "string" || p.norma.trim().length < 5) erros.push("norma obrigatória");
  if (typeof p.url !== "string" || !/^https?:\/\/\S+$/.test(p.url.trim())) erros.push("link da fonte obrigatório");
  if (!["alta", "media", "baixa"].includes(String(p.confianca))) erros.push("confiança inválida");
  if (p.valor === undefined || p.valor === null || p.valor === "") erros.push("valor obrigatório");
  return erros;
}
