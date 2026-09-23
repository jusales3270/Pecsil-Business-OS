import "server-only";

/**
 * Conversa com o Microsoft Graph pela conta de aplicativo (client credentials).
 *
 * O segredo fica só no servidor (`MS_GRAPH_CLIENT_SECRET`, nunca
 * `NEXT_PUBLIC_*`). O escopo é `.default`: quem decide o que o aplicativo pode
 * fazer, e em QUAIS caixas, é o Exchange Online — via RBAC for Applications,
 * com um papel por caixa. É lá que a caixa comercial ganha leitura completa e
 * envio, e a caixa do diretor de operações ganha só `Mail.ReadBasic` (remetente,
 * assunto e data, sem corpo). Nada disso é consentido no Entra de forma ampla:
 * permissão concedida lá valeria para TODAS as caixas da empresa e anularia o
 * escopo (a própria Microsoft documenta que os dois se somam).
 */

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphConfig = { tenantId: string; clientId: string; clientSecret: string };

/** Configuração completa, ou null quando ainda não foi preenchida. */
export function lerConfigGraph(): GraphConfig | null {
  const tenantId = process.env.MS_GRAPH_TENANT_ID?.trim();
  const clientId = process.env.MS_GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

type TokenEmCache = { valor: string; expiraEm: number };
const tokens = new Map<string, TokenEmCache>();

/** Token do aplicativo, reaproveitado até 60s antes de vencer. */
export async function obterToken(config: GraphConfig): Promise<string> {
  const emCache = tokens.get(config.clientId);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.valor;

  const corpo = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const resposta = await fetch(`${LOGIN}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo,
    cache: "no-store",
  });
  const dados = (await resposta.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!resposta.ok || !dados.access_token) {
    // A descrição da Microsoft costuma dizer exatamente o que falta
    // (segredo vencido, tenant errado, aplicativo sem consentimento).
    throw new Error(`Microsoft recusou o aplicativo: ${dados.error_description ?? dados.error ?? resposta.status}`);
  }
  const validade = Number(dados.expires_in ?? 3600);
  tokens.set(config.clientId, { valor: dados.access_token, expiraEm: Date.now() + Math.max(60, validade - 60) * 1000 });
  return dados.access_token;
}

export type RespostaGraph = Record<string, unknown>;

/** GET no Graph. `alvo` pode ser caminho relativo ou a URL inteira do delta. */
export async function graphGet(config: GraphConfig, alvo: string): Promise<RespostaGraph> {
  const token = await obterToken(config);
  const url = alvo.startsWith("http") ? alvo : `${GRAPH}${alvo}`;
  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", Prefer: "odata.maxpagesize=50" },
    cache: "no-store",
  });
  const dados = (await resposta.json().catch(() => ({}))) as RespostaGraph;
  if (!resposta.ok) throw new Error(mensagemDeErro(resposta.status, dados));
  return dados;
}

/** Envia e-mail pela caixa indicada (precisa do papel de envio naquela caixa). */
export async function graphEnviar(
  config: GraphConfig,
  mailboxId: string,
  mensagem: { para: string; assunto: string; corpo: string },
): Promise<void> {
  const token = await obterToken(config);
  const resposta = await fetch(`${GRAPH}/users/${encodeURIComponent(mailboxId)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: mensagem.assunto,
        body: { contentType: "Text", content: mensagem.corpo },
        toRecipients: [{ emailAddress: { address: mensagem.para } }],
      },
      saveToSentItems: true,
    }),
    cache: "no-store",
  });
  if (!resposta.ok) {
    const dados = (await resposta.json().catch(() => ({}))) as RespostaGraph;
    throw new Error(mensagemDeErro(resposta.status, dados));
  }
}

/** Erro do Graph em português, dizendo o que provavelmente está faltando. */
export function mensagemDeErro(status: number, dados: RespostaGraph): string {
  const detalhe = (dados.error as { message?: string; code?: string } | undefined)?.message;
  if (status === 401) return "Microsoft recusou o token (401). Confira o segredo do aplicativo.";
  if (status === 403) {
    return "Microsoft negou o acesso a esta caixa (403). Falta o papel no Exchange (RBAC for Applications) com escopo nesta caixa.";
  }
  if (status === 404) return "Caixa não encontrada (404). Confira o endereço configurado.";
  if (status === 429) return "Microsoft pediu para esperar (429). A próxima rodada tenta de novo.";
  return `Microsoft respondeu ${status}${detalhe ? `: ${detalhe}` : ""}`;
}
