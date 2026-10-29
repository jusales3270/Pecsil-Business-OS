import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { FiscalNaoPronto, credenciaisDaOrganizacao } from "../servidor";
import { ErroTransmissor, type Credenciais } from "../transmissor";
import type { AmbienteNfe } from "./tipos";

/**
 * A emissão falando com a SEFAZ (homologação e, depois, produção — docs/PLANO-EMISSAO-NFE.md, F1). O treino nunca
 * chega aqui. Regras que valem para toda chamada:
 *   - a Configuração precisa estar no MESMO ambiente da nota (nota de homologação não sai com a Configuração em
 *     produção, e vice-versa);
 *   - autorizar nunca é repetido às cegas: sem resposta, a nota fica "transmitindo" até a consulta pela chave.
 */

export const naSefaz = (ambiente: AmbienteNfe) => ambiente !== "treino";

/** Credenciais da emissão, conferindo que a Configuração está no ambiente da nota. */
export async function credenciaisDaEmissao(admin: SupabaseClient, org: string, ambiente: AmbienteNfe): Promise<Credenciais> {
  const cred = await credenciaisDaOrganizacao(admin, org, undefined, "emissao");
  if (cred.ambiente !== ambiente) {
    const nome = (a: string) => (a === "producao" ? "produção" : "homologação");
    throw new FiscalNaoPronto(`A Configuração fiscal está em ${nome(cred.ambiente)} e esta nota é de ${nome(ambiente)}. Nada foi enviado.`);
  }
  return cred;
}

/** Códigos da SEFAZ que contam como autorizada e como evento aceito. */
export const AUTORIZADA = new Set(["100", "150"]);
export const EVENTO_ACEITO = new Set(["135", "136", "155"]);
export const INUTILIZACAO_ACEITA = new Set(["102"]);

/** Na consulta pela chave: o que a SEFAZ diz da nota. */
export function situacaoDaConsulta(cStat: string | null): "autorizada" | "cancelada" | "nao_consta" | "indefinida" {
  if (cStat && AUTORIZADA.has(cStat)) return "autorizada";
  if (cStat === "101" || cStat === "151" || cStat === "155") return "cancelada";
  if (cStat === "217") return "nao_consta";
  return "indefinida";
}

/**
 * O que fazer com um erro ao falar com a SEFAZ:
 *   rejeitada  → a SEFAZ recusou: volta para correção com o motivo;
 *   nao_enviou → o pedido nem saiu (configuração, dado do pedido): pode tentar de novo;
 *   incerto    → pode ter chegado (rede, tempo esgotado, SEFAZ fora): consultar antes de qualquer reenvio.
 */
export function tipoDoErro(e: unknown): "rejeitada" | "nao_enviou" | "incerto" {
  if (e instanceof FiscalNaoPronto) return "nao_enviou";
  if (!(e instanceof ErroTransmissor)) return "incerto";
  if (e.codigo === "REJEITADA") return "rejeitada";
  if (e.codigo === "NAO_CONFIGURADO" || e.codigo === "NAO_AUTORIZADO" || e.codigo === "PEDIDO_INVALIDO") return "nao_enviou";
  return "incerto";
}

/** Texto do motivo da SEFAZ, sem o prefixo "Rejeição:" repetido. */
export const motivoLimpo = (m: string | null | undefined) => String(m ?? "").replace(/^\s*rejei[cç][aã]o\s*:\s*/i, "").trim().slice(0, 400);

/** Regra da SEFAZ em homologação: o nome do destinatário é este texto (senão, rejeição 598). */
export const DESTINATARIO_HOMOLOGACAO = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
