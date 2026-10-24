/**
 * Canal de WhatsApp da plataforma (PLANO-WHATSAPP, W1): a Evolution API roda no Coolify, só na rede interna,
 * e a plataforma fala com ela com a chave do servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY, nunca no
 * navegador). Aqui ficam as chamadas e as regras puras (número, estado), testadas sem a Evolution.
 */

/** A instância do chip interno (WhatsApp Web). Quem é de fora fica para a API oficial (W5), em outra instância. */
export const INSTANCIA_INTERNA = "pecsil-interno";

export type EstadoCanal = "sem_configuracao" | "fora_do_ar" | "sem_instancia" | "desconectado" | "aguardando_qr" | "conectado";
export type Situacao = { estado: EstadoCanal; numero: string | null; nome: string | null; detalhe?: string };

/**
 * Número no formato do WhatsApp (só dígitos, com o 55): "(15) 99662-2530" → "5515996622530".
 * Aceita celular e fixo do Brasil com DDD; com o 55 já na frente também.
 */
export function numeroWhatsApp(entrada: unknown): { numero: string } | { erro: string } {
  const d = String(entrada ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return { numero: `55${d}` };
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return { numero: d };
  return { erro: "Informe o número com DDD (ex.: 15 99662-2530)." };
}

/** "5515996622530@s.whatsapp.net" → "+55 15 99662-2530", para mostrar na tela. */
export function numeroLegivel(jid: string | null | undefined): string | null {
  const d = String(jid ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
  if (!d) return null;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}

/** O estado da conexão que a Evolution devolve ("open", "connecting", "close") no estado da tela. */
export function estadoDaConexao(state: unknown): EstadoCanal {
  if (state === "open") return "conectado";
  if (state === "connecting") return "aguardando_qr";
  return "desconectado";
}

type Config = { url: string; chave: string };
export function configuracao(): Config | null {
  const url = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const chave = process.env.EVOLUTION_API_KEY?.trim();
  return url && chave ? { url, chave } : null;
}

export class ErroEvolution extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) { super(mensagem); this.status = status; }
}

/** Chamada à Evolution com a chave do servidor e prazo curto (a tela não fica pendurada). */
export async function evolution<T = unknown>(c: Config, metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown, buscar: typeof fetch = fetch): Promise<T> {
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await buscar(`${c.url}${caminho}`, {
      method: metodo, signal: ctrl.signal, cache: "no-store",
      headers: { apikey: c.chave, ...(corpo ? { "content-type": "application/json" } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await r.text();
    const json = (() => { try { return JSON.parse(texto); } catch { return null; } })();
    if (!r.ok) {
      const m = json?.response?.message ?? json?.message ?? json?.error ?? texto;
      throw new ErroEvolution(r.status, (Array.isArray(m) ? m.join("; ") : String(m ?? "")).slice(0, 300));
    }
    return json as T;
  } finally { clearTimeout(relogio); }
}

type Instancia = { name?: string; connectionStatus?: string; ownerJid?: string | null; profileName?: string | null };

/** Situação do chip interno: configurado, de pé, com instância, conectado e com qual número. */
export async function situacao(buscar: typeof fetch = fetch): Promise<Situacao> {
  const c = configuracao();
  if (!c) return { estado: "sem_configuracao", numero: null, nome: null, detalhe: "Falta EVOLUTION_API_URL ou EVOLUTION_API_KEY no servidor." };
  let lista: Instancia[];
  try {
    lista = await evolution<Instancia[]>(c, "GET", `/instance/fetchInstances?instanceName=${INSTANCIA_INTERNA}`, undefined, buscar);
  } catch (e) {
    if (e instanceof ErroEvolution && e.status === 404) return { estado: "sem_instancia", numero: null, nome: null };
    return { estado: "fora_do_ar", numero: null, nome: null, detalhe: e instanceof Error ? e.message.slice(0, 200) : "sem resposta" };
  }
  const i = (Array.isArray(lista) ? lista : []).find((x) => x.name === INSTANCIA_INTERNA);
  if (!i) return { estado: "sem_instancia", numero: null, nome: null };
  const estado = estadoDaConexao(i.connectionStatus);
  return { estado, numero: estado === "conectado" ? numeroLegivel(i.ownerJid) : null, nome: estado === "conectado" ? i.profileName ?? null : null };
}

/** Pede o QR Code para conectar o chip (cria a instância na primeira vez). Devolve a imagem em data URL. */
export async function pedirQr(buscar: typeof fetch = fetch): Promise<{ qr: string | null; conectado: boolean }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const atual = await situacao(buscar);
  if (atual.estado === "conectado") return { qr: null, conectado: true };
  if (atual.estado === "fora_do_ar") throw new ErroEvolution(503, `A Evolution não respondeu: ${atual.detalhe ?? ""}`.trim());
  if (atual.estado === "sem_instancia") {
    const r = await evolution<{ qrcode?: { base64?: string } }>(c, "POST", "/instance/create",
      { instanceName: INSTANCIA_INTERNA, integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true, alwaysOnline: false, readMessages: false, syncFullHistory: false }, buscar);
    if (r?.qrcode?.base64) return { qr: r.qrcode.base64, conectado: false };
  }
  const r = await evolution<{ base64?: string }>(c, "GET", `/instance/connect/${INSTANCIA_INTERNA}`, undefined, buscar);
  return { qr: r?.base64 ?? null, conectado: false };
}

/** Desliga o chip da plataforma (o WhatsApp do celular segue normal; é só o "aparelho conectado" que sai). */
export async function desconectar(buscar: typeof fetch = fetch): Promise<void> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  await evolution(c, "DELETE", `/instance/logout/${INSTANCIA_INTERNA}`, undefined, buscar);
}

/** Mensagem de texto pelo chip interno. */
export async function enviarTexto(numero: string, texto: string, buscar: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const r = await evolution<{ key?: { id?: string } }>(c, "POST", `/message/sendText/${INSTANCIA_INTERNA}`, { number: numero, text: texto }, buscar);
  return { id: r?.key?.id ?? null };
}
