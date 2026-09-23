/**
 * Regras da entrada de e-mail, sem rede e sem banco.
 *
 * O que o Microsoft Graph devolve na leitura incremental (delta) não serve
 * direto: vem mudança de leitura, vem remoção, vem corpo em HTML, e vem
 * mensagem de caixa que não é para ser lida por inteiro. Aqui ficam as decisões
 * — o que guardar, de quem, e com qual conteúdo. `sync.ts` faz o resto (rede,
 * gravação, estado do delta).
 */

export type ContaMonitorada = {
  id: string;
  address: string;
  mailboxId: string;
  /** 'todos' = caixa da empresa; 'remetentes_conhecidos' = caixa de uma pessoa. */
  mode: "todos" | "remetentes_conhecidos";
  /** Falso quando o aplicativo só tem Mail.ReadBasic naquela caixa. */
  readsBody: boolean;
  deltaLink: string | null;
};

export type MensagemBruta = Record<string, unknown>;

export type Mensagem = {
  graphId: string;
  internetMessageId: string;
  conversationId: string | null;
  fromName: string | null;
  fromAddress: string;
  toAddresses: string[];
  subject: string | null;
  receivedAt: string;
  hasAttachments: boolean;
  bodyText: string | null;
};

/** Campos pedidos ao Graph. Menos campo é menos dado nosso em trânsito. */
export const CAMPOS_DELTA = [
  "id",
  "internetMessageId",
  "conversationId",
  "from",
  "toRecipients",
  "subject",
  "receivedDateTime",
  "hasAttachments",
  "bodyPreview",
  "body",
].join(",");

/** Limite do corpo guardado. O classificador usa menos que isso. */
export const LIMITE_CORPO = 4000;

/**
 * Entidades nomeadas que aparecem de verdade em e-mail brasileiro. Sem os
 * acentos aqui, "Preço" chegaria ao classificador como "Pre&ccedil;o".
 */
const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ccedil: "ç",
  aacute: "á",
  agrave: "à",
  atilde: "ã",
  acirc: "â",
  eacute: "é",
  ecirc: "ê",
  iacute: "í",
  oacute: "ó",
  otilde: "õ",
  ocirc: "ô",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  ntilde: "ñ",
  ordf: "ª",
  ordm: "º",
  deg: "°",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  pound: "£",
  reg: "®",
  copy: "©",
};

/** HTML do e-mail → texto legível. Não é um renderizador: é para ler e classificar. */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (inteiro, nome) => {
      const chave = String(nome).toLowerCase();
      const letra = ENTIDADES[chave];
      if (!letra) return inteiro;
      // &Ccedil; é a versão maiúscula de &ccedil;.
      return String(nome)[0] === String(nome)[0].toUpperCase() && chave !== String(nome) ? letra.toUpperCase() : letra;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const texto = (valor: unknown): string | null => {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
};

const endereco = (valor: unknown): { nome: string | null; email: string } | null => {
  const dono = (valor as { emailAddress?: { address?: unknown; name?: unknown } } | null)?.emailAddress;
  const email = texto(dono?.address)?.toLowerCase();
  if (!email) return null;
  return { nome: texto(dono?.name), email };
};

/**
 * Item do delta → mensagem, ou null quando não é mensagem para guardar.
 *
 * O delta devolve, na mesma lista, itens `@removed` e mudanças de leitura
 * (documentado pela Microsoft): tratar isso como e-mail novo criaria registro
 * do nada. Sem remetente ou sem `internetMessageId` também não serve — é a
 * chave de deduplicação.
 */
export function interpretarMensagem(bruta: MensagemBruta, conta: ContaMonitorada): Mensagem | null {
  if (bruta["@removed"]) return null;
  const graphId = texto(bruta.id);
  const internetMessageId = texto(bruta.internetMessageId);
  const remetente = endereco(bruta.from);
  const receivedAt = texto(bruta.receivedDateTime);
  if (!graphId || !internetMessageId || !remetente || !receivedAt) return null;

  const destinos = Array.isArray(bruta.toRecipients)
    ? bruta.toRecipients.map(endereco).filter((item): item is { nome: string | null; email: string } => Boolean(item))
    : [];

  let bodyText: string | null = null;
  if (conta.readsBody) {
    const corpo = bruta.body as { content?: unknown; contentType?: unknown } | null;
    const conteudo = texto(corpo?.content);
    const bruto = conteudo
      ? String(corpo?.contentType).toLowerCase() === "html"
        ? htmlParaTexto(conteudo)
        : conteudo
      : texto(bruta.bodyPreview);
    bodyText = bruto ? bruto.slice(0, LIMITE_CORPO) : null;
  }

  return {
    graphId,
    internetMessageId,
    conversationId: texto(bruta.conversationId),
    fromName: remetente.nome,
    fromAddress: remetente.email,
    toAddresses: destinos.map((item) => item.email),
    subject: texto(bruta.subject),
    receivedAt,
    hasAttachments: bruta.hasAttachments === true,
    bodyText,
  };
}

/**
 * Guardar esta mensagem?
 *
 * Caixa da empresa ('todos'): sim. Caixa de uma pessoa
 * ('remetentes_conhecidos'): só se o remetente já estiver cadastrado como
 * cliente ou fornecedor. É o que impede o e-mail particular do diretor de
 * operações de entrar no banco.
 */
export function deveGuardar(mensagem: Mensagem, conta: ContaMonitorada, conhecidos: ReadonlySet<string>): boolean {
  if (conta.mode === "todos") return true;
  return conhecidos.has(mensagem.fromAddress);
}

/** Próxima página da rodada, ou o marcador do fim (deltaLink). */
export function proximoPasso(resposta: { "@odata.nextLink"?: unknown; "@odata.deltaLink"?: unknown }) {
  const proxima = texto(resposta["@odata.nextLink"]);
  if (proxima) return { tipo: "pagina" as const, url: proxima };
  const fim = texto(resposta["@odata.deltaLink"]);
  if (fim) return { tipo: "fim" as const, url: fim };
  // Sem nenhum dos dois o Graph mudou de contrato: parar é melhor que repetir
  // a mesma página para sempre.
  return { tipo: "indefinido" as const, url: null };
}

/** Primeira leitura de uma caixa: só a Entrada, mais recentes primeiro. */
export function urlPrimeiraRodada(mailboxId: string, base = "https://graph.microsoft.com/v1.0"): string {
  const caixa = encodeURIComponent(mailboxId);
  const query = new URLSearchParams({ $select: CAMPOS_DELTA, $orderby: "receivedDateTime desc" });
  return `${base}/users/${caixa}/mailFolders/inbox/messages/delta?${query}`;
}
