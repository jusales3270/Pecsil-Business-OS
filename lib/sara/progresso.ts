import { AsyncLocalStorage } from "node:async_hooks";

/**
 * O que a SARA está fazendo agora (24/10/2026, pedido do proprietário): cada passo da resposta (pensar,
 * consultar, conversar com a SARA de uma área, montar gráfico, fazer conta, pesquisar) vai para a tela
 * enquanto acontece, para a pessoa saber se a demora é tarefa grande ou se travou.
 *
 * O canal acompanha a execução (AsyncLocalStorage): a SARA central chama as SARAs das áreas dentro dela, e
 * os passos de cada área saem com o nome da área sem passar o canal de função em função. Sem canal (voz,
 * guia, teste), nada é emitido.
 */

export type Passo = {
  id: string;
  /** Quem está fazendo: null = a SARA com quem a pessoa conversa; "Financeiro" = a SARA dessa área. */
  agente: string | null;
  tipo: "pensando" | "consulta" | "agente" | "acao" | "internet" | "visual" | "conta" | "conferencia";
  texto: string;
  estado: "rodando" | "feito" | "falhou";
  /** Duração, quando terminou. */
  ms?: number;
};

type Canal = { emitir: (p: Passo) => void; agente: string | null; seq: { n: number } };
const canal = new AsyncLocalStorage<Canal>();

/** Roda `fn` com o canal ligado (a rota que transmite os passos). */
export function comProgresso<T>(emitir: (p: Passo) => void, fn: () => Promise<T>): Promise<T> {
  return canal.run({ emitir, agente: null, seq: { n: 0 } }, fn);
}

/** Os passos dentro de `fn` saem em nome da SARA desta área (a subagente da central). */
export function comoAgente<T>(agente: string, fn: () => Promise<T>): Promise<T> {
  const c = canal.getStore();
  return c ? canal.run({ ...c, agente }, fn) : fn();
}

/** Começa um passo; `fim` fecha com a duração. Sem canal, não faz nada. */
export function iniciarPasso(tipo: Passo["tipo"], texto: string): { fim: (ok?: boolean, texto?: string) => void } {
  const c = canal.getStore();
  if (!c) return { fim: () => undefined };
  const id = `p${++c.seq.n}`, t0 = Date.now(), agente = c.agente;
  const emitir = (p: Passo) => { try { c.emitir(p); } catch { /* a tela fechou: segue sem mostrar */ } };
  emitir({ id, agente, tipo, texto, estado: "rodando" });
  let fechado = false;
  return { fim: (ok = true, final = texto) => { if (fechado) return; fechado = true; emitir({ id, agente, tipo, texto: final, estado: ok ? "feito" : "falhou", ms: Date.now() - t0 }); } };
}

/** Passo que já aconteceu (ex.: a busca na internet que o modelo fez dentro da própria chamada). */
export function passoFeito(tipo: Passo["tipo"], texto: string) { iniciarPasso(tipo, texto).fim(true); }

/** Um detalhe curto da entrada da consulta, para a pessoa saber o que está sendo buscado. */
export function detalheDaEntrada(entrada: Record<string, unknown> | undefined): string {
  if (!entrada) return "";
  for (const k of ["pedido", "item", "busca", "fornecedor", "cliente", "nome", "tabela", "termo", "os", "numero", "mes", "periodo", "de"]) {
    const v = entrada[k];
    if (v == null || v === "") continue;
    const s = typeof v === "object" ? "" : String(v).replace(/\s+/g, " ").trim();
    if (s) return s.length > 48 ? `${s.slice(0, 47)}…` : s;
  }
  return "";
}

/** O texto do passo de cada ferramenta, em português de quem usa. */
export function textoDoPasso(nome: string, rotulo: string | undefined, entrada: Record<string, unknown> | undefined, ehAcao: boolean): { tipo: Passo["tipo"]; texto: string } {
  const detalhe = detalheDaEntrada(entrada);
  const com = (t: string) => (detalhe ? `${t} · ${detalhe}` : t);
  if (nome === "mostrar") return { tipo: "visual", texto: "Montando o gráfico" };
  if (nome === "calcular") return { tipo: "conta", texto: "Fazendo as contas" };
  if (nome === "periodo") return { tipo: "conta", texto: "Calculando o período" };
  if (nome === "abrir_tela" || nome === "abrir_lancamento") return { tipo: "consulta", texto: "Abrindo a tela" };
  if (nome === "criar_documento") return { tipo: "acao", texto: "Montando o documento" };
  if (ehAcao) return { tipo: "acao", texto: `Preparando o cartão para você permitir${rotulo ? ` (${rotulo.replace(/^preparou /, "")})` : ""}` };
  if (nome === "consultar_dados") return { tipo: "consulta", texto: com("Consultando as tabelas") };
  return { tipo: "consulta", texto: com(`Consultando ${rotulo ?? nome.replace(/_/g, " ")}`) };
}
