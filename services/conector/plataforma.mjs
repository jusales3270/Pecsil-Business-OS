/**
 * Conversa com a plataforma (rota /api/conector/v1). O segredo vai no cabeçalho e nunca aparece em log nem em erro.
 * Erro de rede: tenta de novo 3 vezes, com espera crescente. 404: fonte ou segredo errado (não adianta repetir).
 */
export const VERSAO = "0.1.0";

export function plataforma({ url, fonte, segredo, buscar = fetch, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = String(url ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("PLATAFORMA_URL inválida.");
  const cab = { authorization: `Bearer ${segredo}`, "x-conector-fonte": fonte, "x-conector-versao": VERSAO, "content-type": "application/json" };
  async function chamar(metodo, acao, corpo) {
    let ultimo;
    for (let i = 0; i < 4; i++) {
      try {
        const ctrl = new AbortController();
        const relogio = setTimeout(() => ctrl.abort(), 120_000);
        const r = await buscar(`${base}/api/conector/v1/${acao}`, { method: metodo, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined, signal: ctrl.signal }).finally(() => clearTimeout(relogio));
        if (r.status === 404) throw Object.assign(new Error("A plataforma não reconheceu esta fonte (CONECTOR_FONTE ou CONECTOR_SEGREDO errado)."), { definitivo: true });
        const texto = await r.text();
        const json = (() => { try { return JSON.parse(texto); } catch { return null; } })();
        if (!r.ok) throw Object.assign(new Error(`A plataforma respondeu ${r.status}: ${String(json?.error ?? texto).slice(0, 200)}`), { definitivo: r.status < 500 });
        return json;
      } catch (e) {
        ultimo = e;
        if (e.definitivo || i === 3) break;
        await esperar(2000 * 2 ** i);
      }
    }
    throw ultimo;
  }
  return {
    tarefa: () => chamar("GET", "tarefa"),
    descoberta: (descoberta) => chamar("POST", "descoberta", { descoberta }),
    lote: (objeto, registros) => chamar("POST", "lote", { objeto, registros }),
    erro: (erro) => chamar("POST", "erro", { erro: String(erro).slice(0, 500) }).catch(() => null),
  };
}
