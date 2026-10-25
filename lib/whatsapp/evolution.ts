/**
 * Canal de WhatsApp da plataforma (PLANO-WHATSAPP, W1): a Evolution API roda no Coolify, só na rede interna,
 * e a plataforma fala com ela com a chave do servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY, nunca no
 * navegador). Aqui ficam as chamadas e as regras puras (número, estado), testadas sem a Evolution.
 */

/** O primeiro chip (W1). Cada número da plataforma é uma instância (whatsapp_canais.instancia). */
export const INSTANCIA_INTERNA = "pecsil-interno";

/**
 * Nome da instância de um canal novo, a partir do nome dado pelo proprietário: "Atendimento a cliente" →
 * "pecsil-atendimento-a-cliente". Fixo depois de criado; se já existir, ganha -2, -3…
 */
export function nomeDeInstancia(nome: string, existentes: string[]): string {
  const base = `pecsil-${String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "canal"}`;
  if (!existentes.includes(base)) return base;
  for (let i = 2; ; i++) if (!existentes.includes(`${base}-${i}`)) return `${base}-${i}`;
}
const INSTANCIA = /^pecsil-[a-z0-9-]{2,40}$/;
const conferir = (instancia: string) => { if (!INSTANCIA.test(instancia)) throw new ErroEvolution(400, "Instância inválida."); return instancia; };

export type EstadoCanal = "sem_configuracao" | "fora_do_ar" | "sem_instancia" | "desconectado" | "aguardando_qr" | "conectado";
export type Situacao = { estado: EstadoCanal; numero: string | null; nome: string | null; detalhe?: string };

/**
 * Número no formato do WhatsApp (só dígitos, com o 55): "(15) 91234-5678" → "5515912345678".
 * Aceita celular e fixo do Brasil com DDD; com o 55 já na frente também.
 */
export function numeroWhatsApp(entrada: unknown): { numero: string } | { erro: string } {
  const d = String(entrada ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return { numero: `55${d}` };
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return { numero: d };
  return { erro: "Informe o número com DDD (ex.: 15 91234-5678)." };
}

/** "5515912345678@s.whatsapp.net" → "+55 15 91234-5678", para mostrar na tela. */
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

/** Situação de um número: configurado, de pé, com instância, conectado e com qual número. */
export async function situacao(instancia: string = INSTANCIA_INTERNA, buscar: typeof fetch = fetch): Promise<Situacao> {
  const c = configuracao();
  if (!c) return { estado: "sem_configuracao", numero: null, nome: null, detalhe: "Falta EVOLUTION_API_URL ou EVOLUTION_API_KEY no servidor." };
  let lista: Instancia[];
  try {
    lista = await evolution<Instancia[]>(c, "GET", `/instance/fetchInstances?instanceName=${conferir(instancia)}`, undefined, buscar);
  } catch (e) {
    if (e instanceof ErroEvolution && e.status === 404) return { estado: "sem_instancia", numero: null, nome: null };
    return { estado: "fora_do_ar", numero: null, nome: null, detalhe: e instanceof Error ? e.message.slice(0, 200) : "sem resposta" };
  }
  const i = (Array.isArray(lista) ? lista : []).find((x) => x.name === instancia);
  if (!i) return { estado: "sem_instancia", numero: null, nome: null };
  const estado = estadoDaConexao(i.connectionStatus);
  return { estado, numero: estado === "conectado" ? numeroLegivel(i.ownerJid) : null, nome: estado === "conectado" ? i.profileName ?? null : null };
}

/** Pede o QR Code para conectar o número (cria a instância na primeira vez). Devolve a imagem em data URL. */
export async function pedirQr(instancia: string = INSTANCIA_INTERNA, buscar: typeof fetch = fetch): Promise<{ qr: string | null; conectado: boolean }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const atual = await situacao(conferir(instancia), buscar);
  if (atual.estado === "conectado") return { qr: null, conectado: true };
  if (atual.estado === "fora_do_ar") throw new ErroEvolution(503, `A Evolution não respondeu: ${atual.detalhe ?? ""}`.trim());
  if (atual.estado === "sem_instancia") {
    const r = await evolution<{ qrcode?: { base64?: string } }>(c, "POST", "/instance/create",
      { instanceName: instancia, integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true, alwaysOnline: false, readMessages: false, syncFullHistory: false }, buscar);
    if (r?.qrcode?.base64) return { qr: r.qrcode.base64, conectado: false };
  }
  const r = await evolution<{ base64?: string }>(c, "GET", `/instance/connect/${instancia}`, undefined, buscar);
  return { qr: r?.base64 ?? null, conectado: false };
}

/** Desliga o número da plataforma (o WhatsApp do celular segue normal; é só o "aparelho conectado" que sai). */
export async function desconectar(instancia: string = INSTANCIA_INTERNA, buscar: typeof fetch = fetch): Promise<void> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  await evolution(c, "DELETE", `/instance/logout/${conferir(instancia)}`, undefined, buscar);
}

/** Apaga a instância na Evolution (ao remover o canal). Se ela não existir mais, segue. */
export async function apagarInstancia(instancia: string, buscar: typeof fetch = fetch): Promise<void> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  await evolution(c, "DELETE", `/instance/logout/${conferir(instancia)}`, undefined, buscar).catch(() => null);
  try { await evolution(c, "DELETE", `/instance/delete/${instancia}`, undefined, buscar); }
  catch (e) { if (!(e instanceof ErroEvolution && e.status === 404)) throw e; }
}

/** Mensagem de texto por um número da plataforma. */
export async function enviarTexto(instancia: string, numero: string, texto: string, buscar: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const r = await evolution<{ key?: { id?: string } }>(c, "POST", `/message/sendText/${conferir(instancia)}`, { number: numero, text: texto }, buscar);
  return { id: r?.key?.id ?? null };
}

// --- W3: receber e responder (PLANO-WHATSAPP §3 e §4) ---------------------------------------------------

/** Onde a Evolution avisa a plataforma das mensagens: pela rede interna do Coolify, com o segredo no caminho. */
export function urlDoWebhook(): string | null {
  const segredo = process.env.WHATSAPP_WEBHOOK_SEGREDO?.trim();
  if (!segredo) return null;
  const base = (process.env.WHATSAPP_WEBHOOK_BASE?.trim() || "http://pecsil-business-os:3000").replace(/\/+$/, "");
  return `${base}/api/whatsapp/webhook/${segredo}`;
}

/**
 * Garante que o número avisa a plataforma das mensagens novas (com o áudio junto, em base64). Só regrava se o
 * endereço mudou. Devolve se o recebimento está ligado.
 */
export async function garantirWebhook(instancia: string, buscar: typeof fetch = fetch): Promise<{ ligado: boolean; erro?: string }> {
  const c = configuracao();
  const url = urlDoWebhook();
  if (!c || !url) return { ligado: false, erro: "Falta o segredo do webhook (WHATSAPP_WEBHOOK_SEGREDO) no servidor." };
  try {
    const atual = await evolution<{ enabled?: boolean; url?: string; webhookBase64?: boolean; events?: string[] } | null>(c, "GET", `/webhook/find/${conferir(instancia)}`, undefined, buscar).catch(() => null);
    if (atual?.enabled && atual.url === url && atual.webhookBase64 && (atual.events ?? []).includes("MESSAGES_UPSERT")) return { ligado: true };
    await evolution(c, "POST", `/webhook/set/${instancia}`, { webhook: { enabled: true, url, byEvents: false, base64: true, events: ["MESSAGES_UPSERT"] } }, buscar);
    return { ligado: true };
  } catch (e) { return { ligado: false, erro: e instanceof Error ? e.message.slice(0, 200) : "sem resposta" }; }
}

/** Marca a mensagem como lida (só para quem está na lista; número de fora nem isso recebe). */
export async function marcarLida(instancia: string, jid: string, waId: string, buscar: typeof fetch = fetch): Promise<void> {
  const c = configuracao();
  if (!c) return;
  await evolution(c, "POST", `/chat/markMessageAsRead/${conferir(instancia)}`, { readMessages: [{ remoteJid: jid, fromMe: false, id: waId }] }, buscar).catch(() => null);
}

/** "Digitando…" ou "gravando áudio…" enquanto a SARA prepara a resposta. */
export async function presenca(instancia: string, numero: string, tipo: "composing" | "recording", buscar: typeof fetch = fetch): Promise<void> {
  const c = configuracao();
  if (!c) return;
  await evolution(c, "POST", `/chat/sendPresence/${conferir(instancia)}`, { number: numero, delay: 15_000, presence: tipo }, buscar).catch(() => null);
}

/** O áudio (ou outra mídia) de uma mensagem recebida, quando não veio junto no aviso. */
export async function baixarMidia(instancia: string, waId: string, buscar: typeof fetch = fetch): Promise<{ base64: string; mimetype: string | null } | null> {
  const c = configuracao();
  if (!c) return null;
  const r = await evolution<{ base64?: string; mimetype?: string }>(c, "POST", `/chat/getBase64FromMediaMessage/${conferir(instancia)}`, { message: { key: { id: waId } }, convertToMp4: false }, buscar).catch(() => null);
  return r?.base64 ? { base64: r.base64, mimetype: r.mimetype ?? null } : null;
}

/** Nota de voz (aparece como áudio gravado no WhatsApp); a Evolution converte para o formato do WhatsApp. */
export async function enviarAudio(instancia: string, numero: string, audioBase64: string, buscar: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const r = await evolution<{ key?: { id?: string } }>(c, "POST", `/message/sendWhatsAppAudio/${conferir(instancia)}`, { number: numero, audio: audioBase64, encoding: true }, buscar);
  return { id: r?.key?.id ?? null };
}

/** Documento (PDF) por um número da plataforma: chega como arquivo no WhatsApp, com o nome e a legenda. */
export async function enviarDocumento(instancia: string, numero: string, base64: string, nomeArquivo: string, legenda: string, buscar: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const r = await evolution<{ key?: { id?: string } }>(c, "POST", `/message/sendMedia/${conferir(instancia)}`,
    { number: numero, mediatype: "document", mimetype: "application/pdf", media: base64, fileName: nomeArquivo, caption: legenda }, buscar);
  return { id: r?.key?.id ?? null };
}

// --- Botões, lista e enquete (teste de 25/10/2026) --------------------------------------------------------
// Pelo WhatsApp Web (Baileys) o WhatsApp não garante que botões e lista apareçam no celular; a enquete é nativa.
// O teste em Fundação › WhatsApp mostra o que chega e o que volta antes de usar qualquer um no "SIM + código".

export type Interativo = "botoes" | "lista" | "enquete";

/** O corpo de cada forma na Evolution v2 (sendButtons, sendList, sendPoll). Puro, para testar sem o chip. */
export function corpoInterativo(forma: Interativo, numero: string, pergunta: string, opcoes: { id: string; texto: string }[]): { caminho: string; corpo: Record<string, unknown> } {
  if (forma === "botoes") return { caminho: "/message/sendButtons", corpo: { number: numero, title: "Pecsil", description: pergunta, footer: "Pecsil Business OS",
    buttons: opcoes.slice(0, 3).map((o) => ({ type: "reply", displayText: o.texto, id: o.id })) } };
  if (forma === "lista") return { caminho: "/message/sendList", corpo: { number: numero, title: "Pecsil", description: pergunta, buttonText: "Ver opções", footerText: "Pecsil Business OS",
    sections: [{ title: "Opções", rows: opcoes.map((o) => ({ title: o.texto, description: "", rowId: o.id })) }] } };
  return { caminho: "/message/sendPoll", corpo: { number: numero, name: pergunta, selectableCount: 1, values: opcoes.map((o) => o.texto) } };
}

/** Botões, lista ou enquete por um número da plataforma. */
export async function enviarInterativo(instancia: string, forma: Interativo, numero: string, pergunta: string, opcoes: { id: string; texto: string }[], buscar: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = configuracao();
  if (!c) throw new ErroEvolution(503, "Falta a configuração da Evolution no servidor.");
  const { caminho, corpo } = corpoInterativo(forma, numero, pergunta, opcoes);
  const r = await evolution<{ key?: { id?: string } }>(c, "POST", `${caminho}/${conferir(instancia)}`, corpo, buscar);
  return { id: r?.key?.id ?? null };
}
