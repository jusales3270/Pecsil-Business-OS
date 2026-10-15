/**
 * Regras do "Entrar com a digital" (passkey/WebAuthn) que não dependem do servidor — testáveis.
 *
 * - A chave fica presa ao ENDEREÇO (rpID) em que foi criada: o celular só a usa nesse mesmo
 *   endereço. Por isso o endereço vem do próprio pedido (multiempresa: cada instalação o seu) e
 *   só vale por HTTPS — ou localhost, para desenvolvimento.
 * - Decisão do proprietário: só no celular (13/10/2026); celular e tablet (15/10/2026). Computador, não.
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

/**
 * Celular ou tablet. O iPad atual se apresenta como Mac ("Macintosh"); o que o separa do
 * computador é a tela de toque, que o navegador informa (`toque`, de navigator.maxTouchPoints).
 */
export function ehCelularOuTablet(userAgent: string | null | undefined, toque = false): boolean {
  const ua = userAgent ?? "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (toque && /Macintosh/i.test(ua));
}

/** Nome amigável do aparelho, para a lista de aparelhos ("iPhone · Safari", "Android · Chrome"). */
export function nomeDoAparelho(userAgent: string | null | undefined, toque = false): string {
  const ua = userAgent ?? "";
  // O Chrome moderno esconde o modelo ("Android 10; K"): aí fica só "Android".
  const modelo = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim();
  // Tablet Android: o Chrome não põe "Mobile" no navegador do tablet.
  const sistema = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) || (toque && /Macintosh/i.test(ua)) ? "iPad" : /Android/i.test(ua)
    ? `${/Mobile/i.test(ua) ? "Android" : "Tablet Android"}${modelo && modelo !== "K" ? ` (${modelo})` : ""}`
    : "Aparelho";
  const navegador = /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /EdgA|EdgiOS/i.test(ua) ? "Edge" : /CriOS|Chrome/i.test(ua) ? "Chrome" : /FxiOS|Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "";
  return `${sistema}${navegador ? ` · ${navegador}` : ""}`.slice(0, 120);
}

/** Limite de aparelhos com digital ativa por pessoa. */
export const MAX_APARELHOS = 5;
