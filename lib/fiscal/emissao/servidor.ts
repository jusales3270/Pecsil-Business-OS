import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obterTransmissor, transmissorConfigurado } from "../transmissor";
import { totaisDaNota } from "./calculo";
import { avisosIbsCbs, cnpjValido, cpfValido, problemasDeMascara, validarNota, type IbsCbsLegal, type Problema } from "./regras";
import type { AmbienteNfe, Destinatario, Emitente, NotaNfe } from "./tipos";
import { DESTINATARIO_HOMOLOGACAO } from "./sefaz";
import { assinaturaDeTreino, gerarXmlNfe, nfeProcDeTreino } from "./xml";

/**
 * Emissão de NF-e no servidor (Entrega 2). Por ora só o ambiente TREINO: nada sai para a SEFAZ.
 * Grava com a chave de serviço DEPOIS de a rota conferir a permissão da sessão; cada passo vai
 * para a auditoria.
 */

/**
 * Treino (sem SEFAZ), homologação (a SEFAZ de teste, sem valor fiscal) e produção. A produção só aparece e só emite
 * quando a Configuração fiscal está em produção (quem aprova NF-e troca, com confirmação), e cada nota ainda passa
 * pelas travas da virada: máscara confirmada e numeração depois da do sistema anterior (docs/PLANO-VIRADA-FISCAL.md).
 */
export const AMBIENTES_LIBERADOS: AmbienteNfe[] = ["treino", "homologacao", "producao"];

/** A Configuração fiscal da empresa está em produção? */
export async function producaoLigada(admin: SupabaseClient, org: string): Promise<boolean> {
  const { data } = await admin.from("fiscal_config").select("ambiente").eq("organization_id", org).maybeSingle();
  return data?.ambiente === "producao";
}

/** Ambientes que a empresa vê agora: treino e homologação sempre; produção só com a Configuração em produção. */
export async function ambientesDaOrganizacao(admin: SupabaseClient, org: string): Promise<AmbienteNfe[]> {
  return (await producaoLigada(admin, org)) ? ["treino", "homologacao", "producao"] : ["treino", "homologacao"];
}

/** Série e número de uma chave de acesso (posições 23–25 e 26–34). */
const serieDaChave = (chave: string) => Number(chave.slice(22, 25));
const numeroDaChave = (chave: string) => Number(chave.slice(25, 34));

/**
 * Numeração da produção (trava da virada): a série precisa ter o próximo número gravado na Configuração (a
 * continuação do sistema anterior) e o número que vai sair tem de ser maior que o maior número já visto nas notas
 * da própria empresa naquela série (as notas do GRV guardadas na plataforma). Sem isso a nota repetiria um número.
 */
export async function problemasDaNumeracaoNaProducao(admin: SupabaseClient, org: string, serie: number): Promise<Problema[]> {
  const [{ data: cfg }, { data: serieCfg }, { data: usada }] = await Promise.all([
    admin.from("fiscal_config").select("cnpj").eq("organization_id", org).maybeSingle(),
    admin.from("fiscal_series").select("proximo_numero").eq("organization_id", org).eq("serie", serie).maybeSingle(),
    admin.from("fiscal_nfe_numeracao").select("proximo").eq("organization_id", org).eq("ambiente", "producao").eq("serie", serie).maybeSingle(),
  ]);
  if (!serieCfg) return [{ campo: "numeracao", mensagem: `Série ${serie}: grave em Fiscal › Configuração o próximo número (a continuação do GRV) antes da primeira nota de produção.` }];
  const proximo = Number(usada?.proximo ?? serieCfg.proximo_numero);
  const cnpj = String(cfg?.cnpj ?? "").replace(/\D/g, "");
  const { data: lidas } = cnpj.length === 14
    ? await admin.from("fiscal_ibscbs_notas").select("chave").eq("organization_id", org).eq("emitente_cnpj", cnpj).not("chave", "is", null).order("emissao", { ascending: false }).limit(500)
    : { data: [] as { chave: string }[] };
  const doSistemaAnterior = (lidas ?? []).map((l) => String(l.chave)).filter((c) => /^\d{44}$/.test(c) && serieDaChave(c) === serie).map(numeroDaChave);
  const maior = doSistemaAnterior.length ? Math.max(...doSistemaAnterior) : 0;
  if (proximo <= maior) {
    return [{ campo: "numeracao", mensagem: `Série ${serie}: o próximo número (${proximo}) já foi usado — a última nota da empresa vista na plataforma é a nº ${maior}. Grave em Fiscal › Configuração o número seguinte ao último emitido pelo GRV.` }];
  }
  return [];
}

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

/** Dados fiscais do cliente, como a tela da nota usa. */
export const COLUNAS_CLIENTE = "id, name, tax_id, ie, ind_ie, email_nfe, cep, logradouro, numero, complemento, bairro, municipio, codigo_municipio, uf, telefone";

/**
 * Ao salvar a nota, os dados do destinatário vão para o cadastro do cliente (decisão do
 * proprietário, 13/10). Escolhido do cadastro: atualiza. Sem cliente: acha pelo CNPJ/CPF ou pelo
 * nome; não achando, cria — só com documento de dígito válido, para rascunho incompleto não virar
 * cadastro. Campo vazio não apaga o que já existe. Devolve o id do cliente (ou null).
 */
export async function gravarNoCadastroDoCliente(admin: SupabaseClient, autor: Autor, customerId: string | null, d: Destinatario): Promise<string | null> {
  const doc = d.documento.replace(/\D/g, "");
  const docValido = doc.length === 14 ? cnpjValido(doc) : doc.length === 11 ? cpfValido(doc) : false;
  if (!customerId && (!docValido || !d.nome.trim())) return null;
  const { data, error } = await admin.rpc("customer_dados_fiscais_gravar", {
    p_org: autor.org, p_customer: customerId, p: { ...d, documento: docValido ? doc : "" }, p_autor: autor.nome,
  });
  if (error) { console.error("Falha ao gravar o cadastro do cliente pela nota", error.message); return customerId; }
  return (data as string | null) ?? customerId;
}

/**
 * Itens de orçamento que a nota fatura (pela marca `itemOrcamento` de cada item). O banco confere
 * o teto — nunca acima do pedido (soma das notas não canceladas) — com as linhas travadas. Devolve a mensagem de
 * recusa, ou null.
 */
export async function definirOrigens(admin: SupabaseClient, org: string, nfeId: string, nota: NotaNfe): Promise<string | null> {
  const porItem = new Map<string, number>();
  for (const i of nota.itens) if (i.itemOrcamento) porItem.set(i.itemOrcamento, (porItem.get(i.itemOrcamento) ?? 0) + i.quantidade);
  const { error } = await admin.rpc("fiscal_nfe_origens_definir", {
    p_org: org, p_nfe: nfeId, p_itens: [...porItem].map(([item, quantidade]) => ({ item, quantidade })),
  });
  return error ? error.message : null;
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
  const totais = totaisDaNota(nota);
  return {
    natureza: nota.natureza.slice(0, 60), totais, valor_total: totais.vNF,
    destinatario_nome: nota.destinatario.nome.slice(0, 200) || null, destinatario_documento: nota.destinatario.documento.replace(/\D/g, "") || null,
  };
}

const hojeEmBrasilia = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** CBS e IBS da fase de teste vigentes na data (Fiscal › Parâmetros legais); sem parâmetro, null. */
async function ibsCbsLegal(admin: SupabaseClient, data: string): Promise<IbsCbsLegal | null> {
  const { data: p } = await admin.from("contabil_parametros").select("valor, fonte, situacao")
    .eq("chave", "reforma_2026_fase_teste").eq("escopo", "legal").neq("situacao", "descartado")
    .lte("vigente_de", data).or(`vigente_ate.is.null,vigente_ate.gte.${data}`)
    .order("situacao").order("vigente_de", { ascending: false }).limit(1).maybeSingle();
  const v = p?.valor as { cbs?: unknown; ibs?: unknown } | undefined;
  if (!p || typeof v?.cbs !== "number" || typeof v?.ibs !== "number") return null;
  return { cbs: v.cbs, ibs: v.ibs, norma: String((p.fonte as { norma?: string } | null)?.norma ?? "parâmetro legal").split(";")[0], aConferir: p.situacao !== "conferido" };
}

/** Itens sem máscara, ou com máscara inativa ou ainda sem a confirmação do Fiscal: a produção recusa. */
export async function problemasDeMascaraNaProducao(admin: SupabaseClient, org: string, nota: NotaNfe): Promise<Problema[]> {
  const codigos = [...new Set(nota.itens.map((i) => i.mascara).filter((c): c is string => Boolean(c)))];
  const { data } = codigos.length
    ? await admin.from("fiscal_mascaras").select("codigo, ativo, confirmada_em").eq("organization_id", org).in("codigo", codigos)
    : { data: [] as { codigo: string; ativo: boolean; confirmada_em: string | null }[] };
  const porCodigo = new Map((data ?? []).map((m) => [m.codigo as string, m]));
  return problemasDeMascara(nota, porCodigo);
}

export type ResultadoValidacao = { ok: boolean; erros: Problema[]; avisos: Problema[]; esquema: { conferido: boolean; erros: string[] } };

/**
 * Valida: regras da plataforma e, passando, o esquema oficial da SEFAZ (pelo transmissor, sem
 * certificado). Reserva o número na primeira validação; a nota guarda o número dali em diante.
 */
export async function validarEGravar(admin: SupabaseClient, org: string, registro: { id: string; ambiente: AmbienteNfe; serie: number | null; numero: number | null; codigo_numerico: string | null; nota: NotaNfe }): Promise<ResultadoValidacao> {
  const emitente = await emitenteDaOrganizacao(admin, org);
  const { erros, avisos } = validarNota(registro.nota, emitente);
  avisos.push(...avisosIbsCbs(registro.nota, emitente?.crt ?? 3, await ibsCbsLegal(admin, hojeEmBrasilia())));
  // Produção (docs/PLANO-VIRADA-FISCAL.md, trava 3): cada item sai de uma máscara de impostos confirmada pelo Fiscal
  // com o contador. Nota digitada à mão, ou máscara ainda "a confirmar", não vai à SEFAZ de produção.
  if (registro.ambiente === "producao") {
    erros.push(...(await problemasDeMascaraNaProducao(admin, org, registro.nota)));
    if (!(await producaoLigada(admin, org))) erros.push({ campo: "ambiente", mensagem: "A Configuração fiscal não está em produção: a nota de produção não sai." });
    if (!registro.numero) erros.push(...(await problemasDaNumeracaoNaProducao(admin, org, registro.serie ?? (await serieDaOrganizacao(admin, org)))));
  }
  // Homologação: a SEFAZ de teste já rejeita nota do regime normal sem o grupo IBS/CBS ("Grupo IBSCBS não informado",
  // provado em 29/10/2026). Erro aqui, antes de gastar a transmissão.
  if (registro.ambiente === "homologacao" && (emitente?.crt ?? 3) === 3 && registro.nota.itens.some((i) => !i.ibsCbsCst)) {
    erros.push({ campo: "itens", mensagem: "Na homologação a SEFAZ rejeita item sem o grupo IBS/CBS: preencha o CST e a classificação do IBS/CBS de cada item (pela máscara de impostos)." });
  }
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
    // Homologação: a SEFAZ exige este texto no nome do destinatário (o cadastro do cliente não muda).
    const nota: NotaNfe = registro.ambiente === "treino"
      ? { ...registro.nota, infoComplementar: `SIMULACAO DE TREINO NA PLATAFORMA - SEM VALOR FISCAL. ${registro.nota.infoComplementar}`.trim() }
      : registro.ambiente === "homologacao"
        ? { ...registro.nota, destinatario: { ...registro.nota.destinatario, nome: DESTINATARIO_HOMOLOGACAO } }
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
