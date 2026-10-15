"use client";

import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ehCelularOuTablet } from "./digital-regras";

/**
 * "Entrar com a digital" no navegador (passkey). No celular e no tablet com biometria (digital, rosto ou
 * o bloqueio do aparelho). A biometria fica no aparelho; aqui só passa a assinatura do desafio.
 */

/** E-mail de quem ativou a digital NESTE aparelho (para mostrar "Entrar com a digital" no login). */
export const CHAVE_DIGITAL_ATIVA = "pecsil_digital_ativa";
/** Quando a pessoa disse "agora não" à oferta (para não perguntar toda vez). */
export const CHAVE_DIGITAL_DISPENSADA = "pecsil_digital_dispensada";

const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento local */ } };

export const digitalAtivaNesteAparelho = () => ler(CHAVE_DIGITAL_ATIVA);
export const esquecerDigitalNesteAparelho = () => gravar(CHAVE_DIGITAL_ATIVA, null);
export const dispensarOferta = () => gravar(CHAVE_DIGITAL_DISPENSADA, String(Date.now()));
/** Ofertar de novo só 30 dias depois de um "agora não". */
export const ofertaDispensada = () => Date.now() - Number(ler(CHAVE_DIGITAL_DISPENSADA) ?? 0) < 30 * 86_400_000;

export async function digitalDisponivel(): Promise<boolean> {
  if (typeof window === "undefined" || !ehCelularOuTablet(navigator.userAgent, temToque()) || !browserSupportsWebAuthn()) return false;
  try { return await platformAuthenticatorIsAvailable(); } catch { return false; }
}

const cancelou = (e: unknown) => e instanceof Error && /NotAllowedError|AbortError/.test(e.name);

async function post<T>(url: string, corpo: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; codigo?: string; status: number }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), cache: "no-store" }).catch(() => null);
  const b = await r?.json().catch(() => ({}));
  if (!r?.ok) return { ok: false, error: b?.error ?? "Sem conexão com o servidor.", codigo: b?.codigo, status: r?.status ?? 0 };
  return { ok: true, data: b as T };
}

/** Tela de toque: separa o iPad (que se apresenta como Mac) do computador. */
const temToque = () => typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;

/** Ativa a digital neste celular ou tablet para a conta da sessão aberta. */
export async function ativarDigital(email: string): Promise<{ ok: true; aparelho: string } | { ok: false; erro: string }> {
  const o = await post<{ desafio: string; opcoes: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/api/auth/digital/registro", { etapa: "opcoes", toque: temToque() });
  if (!o.ok) return { ok: false, erro: o.error };
  let resposta;
  try { resposta = await startRegistration({ optionsJSON: o.data.opcoes }); } catch (e) {
    if (e instanceof Error && e.name === "InvalidStateError") return { ok: false, erro: "Este aparelho já está com a digital ativa." };
    return { ok: false, erro: cancelou(e) ? "Ativação cancelada." : "O aparelho não conseguiu ativar a digital." };
  }
  const v = await post<{ aparelho: string }>("/api/auth/digital/registro", { etapa: "verificar", desafio: o.data.desafio, resposta, toque: temToque() });
  if (!v.ok) return { ok: false, erro: v.error };
  gravar(CHAVE_DIGITAL_ATIVA, email);
  return { ok: true, aparelho: v.data.aparelho };
}

/** Entra com a digital. Em caso de sucesso, a sessão já está aberta (cookies). */
export async function entrarComDigital(): Promise<{ ok: true } | { ok: false; erro: string; expirou?: string }> {
  const o = await post<{ desafio: string; opcoes: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/auth/digital/login", { etapa: "opcoes" });
  if (!o.ok) return { ok: false, erro: o.error };
  let resposta;
  try { resposta = await startAuthentication({ optionsJSON: o.data.opcoes }); } catch (e) {
    return { ok: false, erro: cancelou(e) ? "Entrada com a digital cancelada." : "O aparelho não encontrou uma digital ativa para esta plataforma. Entre com a senha." };
  }
  const v = await post<{ ok: true }>("/api/auth/digital/login", { etapa: "verificar", desafio: o.data.desafio, resposta });
  if (!v.ok) {
    if (v.codigo === "DIGITAL_INATIVA") esquecerDigitalNesteAparelho();
    if (v.error === "ACCESS_EXPIRED") return { ok: false, erro: "ACCESS_EXPIRED" };
    return { ok: false, erro: v.error };
  }
  return { ok: true };
}
