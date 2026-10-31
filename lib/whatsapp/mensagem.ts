/**
 * WhatsApp W3 (PLANO-WHATSAPP §4): ler o aviso de mensagem que a Evolution manda (messages.upsert) e preparar a
 * resposta da SARA para o WhatsApp. Regras puras, testadas sem a Evolution.
 */

export type TipoMensagem = "texto" | "audio" | "imagem" | "documento" | "outro";
export type Recebida = {
  instancia: string;
  waId: string;
  /** Número de quem mandou: 55 + DDD + número, só dígitos. */
  numero: string;
  /** O endereço como veio (para marcar como lida e responder no mesmo chat). */
  jid: string;
  tipo: TipoMensagem;
  texto: string;
  /** Áudio, imagem ou documento em base64, quando a Evolution manda junto (webhook com base64). */
  base64: string | null;
  mimetype: string | null;
  nome: string | null;
  /** Toque num botão ou numa lista, ou voto numa enquete (tipo "outro"). Texto vazio: chegou sem a opção legível. */
  escolha?: Escolha;
};
export type Escolha = {
  forma: "botao" | "lista" | "enquete"; id: string | null; texto: string;
  /** No voto: a enquete a que ele responde (id e conversa da mensagem original). */
  enquete?: { waId: string; jid: string | null };
};
export type Descartada = { descartar: string; instancia?: string; waId?: string; numero?: string };

type Chave = { remoteJid?: string; fromMe?: boolean; id?: string; remoteJidAlt?: string; senderPn?: string; participant?: string };
type Conteudo = {
  conversation?: string; extendedTextMessage?: { text?: string };
  audioMessage?: { mimetype?: string }; imageMessage?: { mimetype?: string; caption?: string };
  documentMessage?: { mimetype?: string; caption?: string; fileName?: string }; documentWithCaptionMessage?: { message?: Conteudo };
  base64?: string;
  buttonsResponseMessage?: { selectedButtonId?: string; selectedDisplayText?: string };
  templateButtonReplyMessage?: { selectedId?: string; selectedDisplayText?: string };
  listResponseMessage?: { title?: string; singleSelectReply?: { selectedRowId?: string } };
  interactiveResponseMessage?: { body?: { text?: string }; nativeFlowResponseMessage?: { paramsJson?: string } };
  pollUpdateMessage?: { pollCreationMessageKey?: { id?: string; remoteJid?: string }; vote?: { selectedOptions?: unknown[] } };
};

/** A escolha feita num botão, numa lista ou numa enquete, nas formas que o WhatsApp devolve. */
function lerEscolha(m: Conteudo): Escolha | null {
  const b = m.buttonsResponseMessage ?? (m.templateButtonReplyMessage && { selectedButtonId: m.templateButtonReplyMessage.selectedId, selectedDisplayText: m.templateButtonReplyMessage.selectedDisplayText });
  if (b) return { forma: "botao", id: b.selectedButtonId ?? null, texto: String(b.selectedDisplayText ?? "").trim() };
  if (m.listResponseMessage) return { forma: "lista", id: m.listResponseMessage.singleSelectReply?.selectedRowId ?? null, texto: String(m.listResponseMessage.title ?? "").trim() };
  if (m.interactiveResponseMessage) {
    const p = (() => { try { return JSON.parse(m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ?? "") as { id?: string }; } catch { return null; } })();
    return { forma: "botao", id: p?.id ?? null, texto: String(m.interactiveResponseMessage.body?.text ?? "").trim() };
  }
  if (m.pollUpdateMessage) {
    // A Evolution decifra o voto e troca as opções pelo nome (2.3.7). Sem nome: voto retirado ou não decifrado.
    const nomes = (m.pollUpdateMessage.vote?.selectedOptions ?? []).filter((x): x is string => typeof x === "string");
    const chave = m.pollUpdateMessage.pollCreationMessageKey;
    return { forma: "enquete", id: null, texto: nomes.join(", ").trim(), ...(chave?.id ? { enquete: { waId: String(chave.id), jid: chave.remoteJid ? String(chave.remoteJid) : null } } : {}) };
  }
  return null;
}

const digitos = (jid: string | undefined) => String(jid ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");

/**
 * Lê o aviso da Evolution. Descarta (sem responder nada) o que não é conversa de uma pessoa: o que o próprio chip
 * mandou, grupo, status, transmissão e evento que não é mensagem nova.
 */
export function lerMensagem(payload: unknown): Recebida | Descartada {
  const p = (payload ?? {}) as { event?: string; instance?: string; data?: { key?: Chave; message?: Conteudo; messageType?: string; pushName?: string } };
  const evento = String(p.event ?? "").toLowerCase().replace(/_/g, ".");
  if (evento !== "messages.upsert") return { descartar: "evento" };
  const instancia = String(p.instance ?? "");
  const k = p.data?.key ?? {};
  const waId = String(k.id ?? "");
  if (!instancia || !waId) return { descartar: "sem_id" };
  if (k.fromMe) return { descartar: "do_proprio_chip", instancia, waId };
  const jid = String(k.remoteJid ?? "");
  if (/@g\.us$|@broadcast$|@newsletter$/.test(jid) || jid === "status@broadcast") return { descartar: "grupo", instancia, waId };
  // Endereço novo do WhatsApp (LID): o telefone vem no campo alternativo.
  const telefone = /@lid$/.test(jid) ? (k.senderPn || k.remoteJidAlt || "") : jid;
  const numero = digitos(telefone);
  if (!/^55\d{10,11}$/.test(numero)) return { descartar: "numero_desconhecido", instancia, waId, numero };
  const m = p.data?.message ?? {};
  const doc = m.documentWithCaptionMessage?.message?.documentMessage ?? m.documentMessage;
  const base = { instancia, waId, numero, jid, base64: m.base64 ?? null, nome: p.data?.pushName?.trim() || null };
  if (m.conversation || m.extendedTextMessage?.text) return { ...base, tipo: "texto", texto: String(m.conversation || m.extendedTextMessage?.text).trim(), mimetype: null };
  if (m.audioMessage) return { ...base, tipo: "audio", texto: "", mimetype: m.audioMessage.mimetype ?? "audio/ogg" };
  if (m.imageMessage) return { ...base, tipo: "imagem", texto: (m.imageMessage.caption ?? "").trim(), mimetype: m.imageMessage.mimetype ?? "image/jpeg" };
  if (doc) return { ...base, tipo: "documento", texto: (doc.caption ?? "").trim(), mimetype: doc.mimetype ?? null };
  const escolha = lerEscolha(m);
  return { ...base, tipo: "outro", texto: escolha?.texto ?? "", mimetype: null, ...(escolha ? { escolha } : {}) };
}

/**
 * Resposta da SARA (markdown) no formato do WhatsApp: *negrito*, títulos em negrito, tabela em linhas, link
 * da plataforma com o endereço completo, sem a marcação que o WhatsApp não entende.
 */
export function paraWhatsApp(texto: string, base: string): string {
  const absoluto = (url: string) => (url.startsWith("/") ? `${base.replace(/\/+$/, "")}${url}` : url);
  const linhas: string[] = [];
  for (const bruta of String(texto ?? "").split("\n")) {
    let l = bruta.trimEnd();
    if (/^\s*\|?\s*:?-{3,}/.test(l) && /\|/.test(l)) continue; // separador de tabela
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(" · ");
    l = l.replace(/^#{1,6}\s+(.+)$/, "*$1*");
    l = l.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/__(.+?)__/g, "_$1_");
    l = l.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, u: string) => `${t}: ${absoluto(u)}`);
    l = l.replace(/^(\s*)[-*]\s+/, "$1• ");
    linhas.push(l);
  }
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Texto longo em partes (o WhatsApp corta mensagens muito grandes), quebrando em parágrafo ou linha. */
export function dividir(texto: string, max = 3500): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n\n", max);
    if (corte < max * 0.5) corte = resto.lastIndexOf("\n", max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(" ", max);
    if (corte <= 0) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/**
 * O que vai junto da resposta em áudio, por escrito: o que não dá para ouvir (link do Permitir, gráfico na
 * plataforma). Sem nada disso, a resposta em áudio vai sozinha.
 */
export function complementoEscrito(o: { acoesPendentes: number; visuais: number; linkSara: string; enquete?: boolean }): string | null {
  const partes: string[] = [];
  if (o.enquete) partes.push(`Confirme na enquete abaixo (vale 15 minutos; só o primeiro voto conta). Se preferir, pelo Permitir na plataforma: ${o.linkSara}`);
  else if (o.acoesPendentes) partes.push(`${o.acoesPendentes === 1 ? "Preparei uma ação" : `Preparei ${o.acoesPendentes} ações`} que precisa${o.acoesPendentes === 1 ? "" : "m"} do seu Permitir na plataforma: ${o.linkSara}`);
  if (o.visuais) partes.push(`${o.visuais === 1 ? "Montei um gráfico" : `Montei ${o.visuais} gráficos`}: veja na plataforma, ${o.linkSara}`);
  return partes.length ? partes.join("\n") : null;
}

/** A mensagem inteira é só um agradecimento? Qualquer outra palavra vai para a SARA ("obrigado, e o saldo?"). */
export const soAgradecimento = (texto: string | null | undefined) =>
  /^(muit[oa]s?\s+)?(obrigad[oa]s?|brigad[oa]s?|obg|vlw|valeu|agrade[cç]o)(,?\s+(sara|viu|mesmo|demais|chefe|hein))*[\s!.,🙏👍❤️]*$/iu.test(String(texto ?? "").trim());
