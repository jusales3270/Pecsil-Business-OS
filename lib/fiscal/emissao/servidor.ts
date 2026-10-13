import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obterTransmissor, transmissorConfigurado } from "../transmissor";
import { calcularItens, calcularTotais } from "./calculo";
import { validarNota, type Problema } from "./regras";
import type { AmbienteNfe, Emitente, NotaNfe } from "./tipos";
import { assinaturaDeTreino, gerarXmlNfe, nfeProcDeTreino } from "./xml";

/**
 * Emissão de NF-e no servidor (Entrega 2). Por ora só o ambiente TREINO: nada sai para a SEFAZ.
 * Grava com a chave de serviço DEPOIS de a rota conferir a permissão da sessão; cada passo vai
 * para a auditoria.
 */

export const AMBIENTES_LIBERADOS: AmbienteNfe[] = ["treino"];

export type Autor = { org: string; userId: string; profileId: string; nome: string };

/** Quem está agindo (organização, perfil e nome), lido pela sessão. */
export async function autorDaSessao(supabase: SupabaseClient): Promise<Autor | null> {
  const [{ data: org }, { data: perfil }, { data: u }] = await Promise.all([
    supabase.rpc("current_organization_id"), supabase.rpc("current_profile_id"), supabase.auth.getUser(),
  ]);
  if (!org || !perfil || !u.user) return null;
  const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
  return { org: String(org), profileId: String(perfil), userId: u.user.id, nome: (p?.full_name || p?.email || "Usuário").slice(0, 120) };
}

/** Cliente do cadastro, só se for da organização. */
export async function clienteDaOrganizacao(admin: SupabaseClient, org: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("customers").select("id").eq("organization_id", org).eq("id", id).maybeSingle();
  return data?.id ?? null;
}

/** Colunas da lista (sem o XML, que pesa). */
export const COLUNAS_LISTA = "id, ambiente, situacao, serie, numero, chave, emissao, natureza, valor_total, destinatario_nome, destinatario_documento, protocolo, autorizada_em, motivo, montada_por_nome, aprovada_por_nome, cancelada_em, created_at, updated_at";

export async function emitenteDaOrganizacao(admin: SupabaseClient, org: string): Promise<Partial<Emitente> | null> {
  const { data: c } = await admin.from("fiscal_config").select("*").eq("organization_id", org).maybeSingle();
  if (!c) return null;
  return {
    cnpj: c.cnpj ?? "", razaoSocial: c.razao_social ?? "", fantasia: c.nome_fantasia, ie: c.ie ?? "", im: c.im, cnae: c.cnae, crt: c.crt ?? 0,
    logradouro: c.logradouro ?? "", numero: c.numero ?? "", complemento: c.complemento, bairro: c.bairro ?? "", codigoMunicipio: c.codigo_municipio ?? "",
    municipio: c.municipio ?? "", uf: c.uf ?? "", cep: c.cep ?? "", telefone: c.telefone,
  };
}

export async function serieDaOrganizacao(admin: SupabaseClient, org: string): Promise<number> {
  const { data } = await admin.from("fiscal_config").select("serie_padrao").eq("organization_id", org).maybeSingle();
  return Number(data?.serie_padrao ?? 1);
}

export async function auditar(admin: SupabaseClient, a: Autor & { evento: string; nfeId: string | null; dados: Record<string, unknown> }) {
  await admin.from("audit_logs").insert({
    organization_id: a.org, actor_user_id: a.userId, actor_profile_id: a.profileId, module_code: "fiscal",
    event_type: `fiscal_nfe.${a.evento}`, entity_type: "fiscal_nfe", entity_id: a.nfeId, risk_level: "normal", metadata: a.dados,
  });
}

/** Resumo para a lista (o que a tela mostra sem abrir a nota). */
export function resumoDaNota(nota: NotaNfe) {
  const totais = calcularTotais(calcularItens(nota));
  return {
    natureza: nota.natureza.slice(0, 60), totais, valor_total: totais.vNF,
    destinatario_nome: nota.destinatario.nome.slice(0, 200) || null, destinatario_documento: nota.destinatario.documento.replace(/\D/g, "") || null,
  };
}

export type ResultadoValidacao = { ok: boolean; erros: Problema[]; avisos: Problema[]; esquema: { conferido: boolean; erros: string[] } };

/**
 * Valida: regras da plataforma e, passando, o esquema oficial da SEFAZ (pelo transmissor, sem
 * certificado). Reserva o número na primeira validação; a nota guarda o número dali em diante.
 */
export async function validarEGravar(admin: SupabaseClient, org: string, registro: { id: string; ambiente: AmbienteNfe; serie: number | null; numero: number | null; codigo_numerico: string | null; nota: NotaNfe }): Promise<ResultadoValidacao> {
  const emitente = await emitenteDaOrganizacao(admin, org);
  const { erros, avisos } = validarNota(registro.nota, emitente);
  let esquema: ResultadoValidacao["esquema"] = { conferido: false, erros: [] };
  const atualizar: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (!erros.length && emitente) {
    const serie = registro.serie ?? (await serieDaOrganizacao(admin, org));
    let numero = registro.numero;
    if (!numero) {
      const { data, error } = await admin.rpc("fiscal_nfe_reservar_numero", { p_org: org, p_ambiente: registro.ambiente, p_serie: serie });
      if (error) throw new Error("Não foi possível reservar o número.");
      numero = Number(data);
    }
    let codigo = registro.codigo_numerico ?? String(randomInt(10_000_000, 99_999_999));
    if (codigo === String(numero).padStart(8, "0")) codigo = String(randomInt(10_000_000, 99_999_999));
    const emissao = new Date();
    // Treino: a nota leva o aviso no texto, além da marca d'água do DANFE.
    const nota: NotaNfe = registro.ambiente === "treino"
      ? { ...registro.nota, infoComplementar: `SIMULACAO DE TREINO NA PLATAFORMA - SEM VALOR FISCAL. ${registro.nota.infoComplementar}`.trim() }
      : registro.nota;
    const { xml, chave } = gerarXmlNfe({ nota, emitente: emitente as Emitente, serie, numero, emissao, codigoNumerico: codigo, tpAmb: registro.ambiente === "producao" ? 1 : 2 });
    if (transmissorConfigurado()) {
      const paraEsquema = xml.replace("</infNFe></NFe>", `</infNFe>${assinaturaDeTreino(chave)}</NFe>`);
      const r = await obterTransmissor().validar(paraEsquema);
      esquema = { conferido: true, erros: r.success ? [] : (r.errors ?? []).map((e) => e.humanized ?? e.message ?? e.raw ?? "Erro no esquema").slice(0, 20) };
    } else {
      avisos.push({ campo: "esquema", mensagem: "O transmissor não está disponível: o esquema oficial não foi conferido agora." });
    }
    Object.assign(atualizar, { serie, numero, codigo_numerico: codigo, chave, emissao: emissao.toISOString(), xml });
  }
  const ok = !erros.length && (esquema.conferido ? !esquema.erros.length : true);
  const resultado: ResultadoValidacao = { ok, erros, avisos, esquema };
  await admin.from("fiscal_nfe").update({ ...atualizar, validacao: resultado, situacao: ok ? "validada" : "rascunho" }).eq("id", registro.id);
  return resultado;
}

/** Protocolo fictício do treino: começa com 9 (nenhum protocolo real da SEFAZ começa assim). */
export const protocoloDeTreino = () => `9${String(Date.now()).slice(-10)}${String(randomInt(1000, 9999))}`;

export function xmlAutorizadoDeTreino(xml: string, chave: string, protocolo: string, quando: Date) {
  return nfeProcDeTreino(xml, chave, protocolo, quando);
}

export function ambienteLiberado(a: unknown): a is AmbienteNfe {
  return typeof a === "string" && (AMBIENTES_LIBERADOS as string[]).includes(a);
}
