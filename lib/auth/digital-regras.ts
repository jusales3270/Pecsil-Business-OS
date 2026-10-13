/**
 * Regras do "Entrar com a digital" (passkey/WebAuthn) que não dependem do servidor — testáveis.
 *
 * - A chave fica presa ao ENDEREÇO (rpID) em que foi criada: o celular só a usa nesse mesmo
 *   endereço. Por isso o endereço vem do próprio pedido (multiempresa: cada instalação o seu) e
 *   só vale por HTTPS — ou localhost, para desenvolvimento.
 * - Decisão do proprietário (13/10/2026): só no celular.
 */

export type Origem = { rpID: string; origem: string };

/** Endereço do pedido, conferido com o cabeçalho Origin (o navegador não deixa forjar). */
export function origemDoPedido(h: { host: string | null; forwardedHost?: string | null; forwardedProto?: string | null; origin: string | null }): Origem | { erro: string } {
  const host = (h.forwardedHost?.split(",")[0] ?? h.host ?? "").trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/.test(host)) return { erro: "Endereço do pedido inválido." };
  const rpID = host.replace(/:\d+$/, "");
  const local = rpID === "localhost";
  const proto = (h.forwardedProto?.split(",")[0]?.trim() || (local ? "http" : "https")).toLowerCase();
  if (proto !== "https" && !local) return { erro: "A digital só funciona pelo endereço seguro (https) da plataforma." };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(rpID)) return { erro: "A digital não funciona pelo IP; use o endereço da plataforma." };
  const origem = `${proto}://${host}`;
  if (h.origin && h.origin.toLowerCase() !== origem) return { erro: "Pedido de outra origem." };
  return { rpID, origem };
}

/** Celular ou tablet (a decisão é "só no celular"). */
export function ehCelular(userAgent: string | null | undefined): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? "");
}

/** Nome amigável do aparelho, para a lista de aparelhos ("iPhone · Safari", "Android · Chrome"). */
export function nomeDoAparelho(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  // O Chrome moderno esconde o modelo ("Android 10; K"): aí fica só "Android".
  const modelo = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim();
  const sistema = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Android/i.test(ua)
    ? `Android${modelo && modelo !== "K" ? ` (${modelo})` : ""}`
    : "Celular";
  const navegador = /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /EdgA|EdgiOS/i.test(ua) ? "Edge" : /CriOS|Chrome/i.test(ua) ? "Chrome" : /FxiOS|Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "";
  return `${sistema}${navegador ? ` · ${navegador}` : ""}`.slice(0, 120);
}

/** Limite de aparelhos com digital ativa por pessoa. */
export const MAX_APARELHOS = 5;
