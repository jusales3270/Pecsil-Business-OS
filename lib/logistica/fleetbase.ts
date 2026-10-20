import "server-only";

import http from "node:http";
import https from "node:https";

/**
 * Cliente da API pública do Fleetbase (serviço separado, docs/PLANO-LOGISTICA.md). Só no servidor: a chave
 * (`FLEETBASE_API_KEY`) nunca vai para o navegador.
 * - Produção: como a Forja, pelo Traefik interno do Coolify: `FLEETBASE_API_URL=http://coolify-proxy` e
 *   `FLEETBASE_API_HOST=frota.pecsil` (o nome no Traefik). O `fetch` do Node descarta um `Host` próprio, por
 *   isso, com o `FLEETBASE_API_HOST`, a chamada usa `node:http`.
 * - Desenvolvimento: o Fleetbase local (`FLEETBASE_API_URL=http://localhost:8000`, sem `FLEETBASE_API_HOST`).
 */
export class FleetbaseErro extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Json = Record<string, unknown>;

export const fleetbaseConfigurado = () => Boolean(process.env.FLEETBASE_API_URL && process.env.FLEETBASE_API_KEY);

/** Uma requisição com o cabeçalho Host próprio (o Traefik roteia por ele), até 15 s e 5 MB. */
function comHost(url: URL, host: string, metodo: string, cabecalhos: Record<string, string>, corpo?: string) {
  return new Promise<{ status: number; texto: string }>((ok, falha) => {
    const cliente = url.protocol === "https:" ? https : http;
    const req = cliente.request(url, {
      method: metodo,
      headers: { ...cabecalhos, Host: host, ...(corpo ? { "content-length": String(Buffer.byteLength(corpo)) } : {}) },
      timeout: 15_000,
    }, (res) => {
      const partes: Buffer[] = [];
      let tamanho = 0;
      res.on("data", (c: Buffer) => { tamanho += c.length; if (tamanho > 5_000_000) { req.destroy(new Error("resposta grande demais")); return; } partes.push(c); });
      res.on("end", () => ok({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", falha);
    if (corpo) req.write(corpo);
    req.end();
  });
}

async function chamar<T = Json>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = (process.env.FLEETBASE_API_URL ?? "").replace(/\/$/, "");
  const chave = process.env.FLEETBASE_API_KEY;
  const host = process.env.FLEETBASE_API_HOST;
  if (!base || !chave) throw new FleetbaseErro("O serviço de entregas (Fleetbase) não está configurado.", 503);
  const metodo = init.method ?? "GET";
  const cabecalhos: Record<string, string> = { authorization: `Bearer ${chave}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) };
  const corpoTexto = init.body ? JSON.stringify(init.body) : undefined;
  let r: { ok: boolean; status: number; texto: string };
  try {
    if (host) {
      const x = await comHost(new URL(`${base}/v1${caminho}`), host, metodo, cabecalhos, corpoTexto);
      r = { ok: x.status >= 200 && x.status < 300, status: x.status, texto: x.texto };
    } else {
      const x = await fetch(`${base}/v1${caminho}`, { method: metodo, headers: cabecalhos, body: corpoTexto, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      r = { ok: x.ok, status: x.status, texto: await x.text() };
    }
  } catch {
    throw new FleetbaseErro("O serviço de entregas não respondeu.", 503);
  }
  const texto = r.texto;
  let corpo: unknown = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = null; }
  if (!r.ok) {
    const erros = (corpo as { errors?: unknown })?.errors;
    const msg = Array.isArray(erros) ? erros.map(String).join(" ") : (corpo as { error?: string })?.error;
    throw new FleetbaseErro(msg ? `Fleetbase: ${String(msg).slice(0, 200)}` : `O serviço de entregas recusou o pedido (${r.status}).`, r.status);
  }
  return corpo as T;
}

export type LocalNovo = { nome: string; endereco: string; municipio?: string | null; uf?: string | null; cep?: string | null; lat: number; lng: number };

export const fleetbase = {
  criarLocal: (l: LocalNovo) => chamar<{ id: string }>("/places", {
    method: "POST",
    body: { name: l.nome.slice(0, 120), street1: l.endereco.slice(0, 190), city: l.municipio ?? undefined, province: l.uf ?? undefined,
      postal_code: l.cep ?? undefined, country: "BR", latitude: l.lat, longitude: l.lng },
  }),
  criarOrdem: (o: { origem: string; destino: string; notas: string; meta: Json }) => chamar<Json & { id: string; tracking_number?: { tracking_number?: string } }>("/orders", {
    method: "POST", body: { pickup: o.origem, dropoff: o.destino, notes: o.notas.slice(0, 500), meta: o.meta },
  }),
  ordem: (id: string) => chamar<Json>(`/orders/${encodeURIComponent(id)}`),
  rastreio: (id: string) => chamar<Json>(`/orders/${encodeURIComponent(id)}/tracker`),
  cancelarOrdem: (id: string) => chamar<Json>(`/orders/${encodeURIComponent(id)}/cancel`, { method: "DELETE" }),
  motoristas: () => chamar<Json[]>("/drivers?limit=200"),
  motorista: (id: string) => chamar<Json>(`/drivers/${encodeURIComponent(id)}`),
  /**
   * Motoristas com a posição ATUAL. A lista do Fleetbase fica em cache e não se renova quando o motorista manda o
   * GPS (o registro é gravado sem avisar o cache); o detalhe de cada um vem sempre atual. A lista dá só quem são.
   */
  motoristasComPosicao: async () => {
    const lista = await chamar<Json[]>("/drivers?limit=200");
    const ids = (Array.isArray(lista) ? lista : []).map((d) => String(d.id ?? "")).filter(Boolean).slice(0, 40);
    const atuais = await Promise.all(ids.map((id) => chamar<Json>(`/drivers/${encodeURIComponent(id)}`).catch(() => null)));
    return (Array.isArray(lista) ? lista : []).slice(0, 40).map((d, i) => atuais[i] ?? d);
  },
  veiculos: () => chamar<Json[]>("/vehicles?limit=200"),
  /** Veículo e motorista: a plataforma é a dona do cadastro, aqui só o espelho (ao Fleetbase vai o mínimo). */
  salvarVeiculo: (id: string | null, v: { placa: string; marca: string | null; modelo: string | null; ano: number | null }) =>
    chamar<{ id: string }>(id ? `/vehicles/${encodeURIComponent(id)}` : "/vehicles", {
      method: id ? "PUT" : "POST", body: { plate_number: v.placa, make: v.marca ?? undefined, model: v.modelo ?? undefined, year: v.ano ? String(v.ano) : undefined },
    }),
  salvarMotorista: (id: string | null, m: { nome: string; veiculo: string | null; ativo: boolean }) =>
    chamar<{ id: string }>(id ? `/drivers/${encodeURIComponent(id)}` : "/drivers", {
      method: id ? "PUT" : "POST", body: { name: m.nome, vehicle: m.veiculo ?? undefined, status: m.ativo ? "active" : "inactive" },
    }),
  /** Designa o motorista (e o veículo) da ordem e despacha para o celular dele. */
  designar: async (ordem: string, motorista: string, veiculo: string | null) => {
    await chamar(`/orders/${encodeURIComponent(ordem)}`, { method: "PUT", body: { driver: motorista, ...(veiculo ? { vehicle: veiculo } : {}) } });
    return chamar<Json>(`/orders/${encodeURIComponent(ordem)}/dispatch`, { method: "POST" });
  },
};
