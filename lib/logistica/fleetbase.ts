import "server-only";

/**
 * Cliente da API pública do Fleetbase (serviço separado, docs/PLANO-LOGISTICA.md). Só no servidor: a chave
 * (`FLEETBASE_API_KEY`) nunca vai para o navegador. Em produção, a URL é a da rede interna do servidor,
 * como a da Forja; no desenvolvimento, o Fleetbase local (`http://localhost:8000`).
 */
export class FleetbaseErro extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Json = Record<string, unknown>;

export const fleetbaseConfigurado = () => Boolean(process.env.FLEETBASE_API_URL && process.env.FLEETBASE_API_KEY);

async function chamar<T = Json>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = (process.env.FLEETBASE_API_URL ?? "").replace(/\/$/, "");
  const chave = process.env.FLEETBASE_API_KEY;
  if (!base || !chave) throw new FleetbaseErro("O serviço de entregas (Fleetbase) não está configurado.", 503);
  let r: Response;
  try {
    r = await fetch(`${base}/v1${caminho}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${chave}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FleetbaseErro("O serviço de entregas não respondeu.", 503);
  }
  const texto = await r.text();
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
};
