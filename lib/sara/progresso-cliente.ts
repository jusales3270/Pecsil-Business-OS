/**
 * No navegador: pergunta à SARA pedindo os passos ao vivo (lib/sara/progresso.ts) e devolve a resposta final
 * como antes ({ ok, status, body }). Cada passo chega em `aoPasso` assim que acontece.
 */

export type PassoSara = {
  id: string; agente: string | null;
  tipo: "pensando" | "consulta" | "agente" | "acao" | "internet" | "visual" | "conta" | "conferencia";
  texto: string; estado: "rodando" | "feito" | "falhou"; ms?: number;
};

export async function perguntarComPassos(url: string, corpo: Record<string, unknown>, aoPasso: (p: PassoSara) => void, aoSinal?: () => void):
  Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...corpo, progresso: true }) });
  // Erro antes de começar (sem permissão, limite do mês…): resposta JSON comum.
  if (!(r.headers.get("content-type") ?? "").includes("ndjson") || !r.body) {
    return { ok: r.ok, status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  }
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let resto = "";
  let fim: { status: number; corpo: Record<string, unknown> | null } | null = null;
  const tratar = (linha: string) => {
    if (!linha.trim()) return;
    let m: { tipo?: string; passo?: PassoSara; status?: number; corpo?: Record<string, unknown> | null };
    try { m = JSON.parse(linha); } catch { return; }
    aoSinal?.();
    if (m.tipo === "passo" && m.passo) aoPasso(m.passo);
    else if (m.tipo === "fim") fim = { status: Number(m.status ?? 503), corpo: m.corpo ?? null };
  };
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const linhas = resto.split("\n");
    resto = linhas.pop() ?? "";
    linhas.forEach(tratar);
  }
  tratar(resto);
  const f = fim as { status: number; corpo: Record<string, unknown> | null } | null;
  if (!f) return { ok: false, status: 503, body: { error: "A conexão caiu antes da resposta. Tente de novo." } };
  return { ok: f.status >= 200 && f.status < 300, status: f.status, body: f.corpo };
}

/** Junta o passo novo à lista: o mesmo id atualiza (rodando → feito), id novo entra no fim. */
export function juntarPasso<T extends PassoSara>(lista: T[], p: T): T[] {
  const i = lista.findIndex((x) => x.id === p.id && x.agente === p.agente);
  if (i < 0) return [...lista, p];
  const nova = [...lista]; nova[i] = p; return nova;
}

/** O passo a mostrar na linha principal: o último que está rodando (o mais recente), senão o último. */
export function passoAtual<T extends PassoSara>(lista: T[]): T | null {
  for (let i = lista.length - 1; i >= 0; i--) if (lista[i].estado === "rodando") return lista[i];
  return lista.at(-1) ?? null;
}

/** "8 s", "1 min 12 s". */
export const duracao = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
