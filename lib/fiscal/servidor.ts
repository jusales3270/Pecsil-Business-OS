import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarOriginalSistema } from "../documentos/guardar";
import { lerDocumentoDistribuido, proximaConsulta } from "./dfe";
import { ErroTransmissor, obterTransmissor, type AmbienteFiscal, type Credenciais, type Transmissor } from "./transmissor";

/**
 * Fiscal no servidor (Entrega 1 da NF-e, 12/10/2026): credenciais da organização, a rodada que
 * busca na SEFAZ as notas emitidas contra o nosso CNPJ e a ciência da operação.
 * Tudo com a chave de serviço (`admin`): o certificado só sai do cofre aqui, em memória, a caminho
 * do transmissor, e nunca vai para log nem para resposta.
 */

export class FiscalNaoPronto extends Error {}

type ConfigFiscal = {
  organization_id: string; cnpj: string | null; uf: string | null; ambiente: AmbienteFiscal;
  dfe_ativo: boolean; ciencia_automatica: boolean; dfe_ultimo_nsu: string; dfe_proxima_consulta: string | null; cert_validade: string | null;
};

const COLUNAS = "organization_id, cnpj, uf, ambiente, dfe_ativo, ciencia_automatica, dfe_ultimo_nsu, dfe_proxima_consulta, cert_validade";

export async function credenciaisDaOrganizacao(admin: SupabaseClient, org: string, config?: ConfigFiscal): Promise<Credenciais> {
  const c = config ?? ((await admin.from("fiscal_config").select(COLUNAS).eq("organization_id", org).maybeSingle()).data as ConfigFiscal | null);
  if (!c?.cnpj || !c.uf) throw new FiscalNaoPronto("Configuração fiscal incompleta: falta o CNPJ ou a UF do emitente.");
  if (!c.cert_validade) throw new FiscalNaoPronto("Nenhum certificado digital enviado.");
  if (new Date(c.cert_validade).getTime() < Date.now()) throw new FiscalNaoPronto("O certificado digital venceu. Envie o novo em Configuração.");
  const { data, error } = await admin.rpc("fiscal_certificado_ler", { p_org: org });
  const cert = (Array.isArray(data) ? data[0] : data) as { pfx: string; senha: string } | null;
  if (error || !cert?.pfx) throw new FiscalNaoPronto("O certificado não foi encontrado no cofre. Envie de novo em Configuração.");
  return { uf: c.uf, cnpj: c.cnpj, ambiente: c.ambiente, certificado: { pfx: cert.pfx, senha: cert.senha } };
}

export type ResultadoRodada = {
  organizacao: string;
  consultou: boolean;
  motivo?: string;
  documentos: number;
  notasNovas: number;
  xmlGuardados: number;
  ciencias: number;
  erros: number;
};

/**
 * Uma rodada da distribuição para uma organização: consulta enquanto houver documento novo (até o
 * prazo), registra cada um, guarda o XML completo em Documentos e, com a ciência automática
 * ligada, dá ciência nos resumos (a SEFAZ libera o XML completo nas próximas consultas).
 * Respeita a regra da 1 hora: com `dfe_proxima_consulta` no futuro, não consulta.
 */
export async function rodadaDistribuicao(
  admin: SupabaseClient,
  org: string,
  opcoes: { prazoMs?: number; transmissor?: Transmissor } = {},
): Promise<ResultadoRodada> {
  const r: ResultadoRodada = { organizacao: org, consultou: false, documentos: 0, notasNovas: 0, xmlGuardados: 0, ciencias: 0, erros: 0 };
  const { data } = await admin.from("fiscal_config").select(COLUNAS).eq("organization_id", org).maybeSingle();
  const config = data as ConfigFiscal | null;
  if (!config?.dfe_ativo) return { ...r, motivo: "Busca automática desligada." };
  if (config.dfe_proxima_consulta && new Date(config.dfe_proxima_consulta).getTime() > Date.now()) {
    return { ...r, motivo: `Próxima consulta permitida às ${new Date(config.dfe_proxima_consulta).toISOString()}.` };
  }

  const fim = Date.now() + (opcoes.prazoMs ?? 45_000);
  const transmissor = opcoes.transmissor ?? obterTransmissor();
  const cred = await credenciaisDaOrganizacao(admin, org, config);
  let ultimoNsu = config.dfe_ultimo_nsu;
  let status = "";
  let proxima: Date = new Date(Date.now() + 61 * 60_000);

  try {
    for (let volta = 0; volta < 20 && Date.now() < fim; volta++) {
      r.consultou = true;
      const ret = await transmissor.distribuicao(cred, { ultimoNsu });
      for (const doc of ret.documentos) {
        r.documentos++;
        try {
          await registrarDocumento(admin, org, doc, r);
        } catch (e) {
          r.erros++;
          console.error("Falha ao registrar documento da distribuição", (e as Error).message);
        }
      }
      if (ret.ultimoNsu && /^\d{15}$/.test(ret.ultimoNsu)) ultimoNsu = ret.ultimoNsu;
      proxima = proximaConsulta(ret);
      status = `${ret.cStat} · ${ret.motivo ?? ""}`.trim();
      await admin.from("fiscal_config").update({
        dfe_ultimo_nsu: ultimoNsu, dfe_max_nsu: ret.maxNsu && /^\d{15}$/.test(ret.maxNsu) ? ret.maxNsu : null,
        dfe_ultima_consulta: new Date().toISOString(), dfe_proxima_consulta: proxima.toISOString(), dfe_ultimo_status: status.slice(0, 300),
      }).eq("organization_id", org);
      // Fim da fila (137, ou ultNSU = maxNSU): esperar a hora.
      if (proxima.getTime() - Date.now() > 5 * 60_000) break;
    }
  } catch (e) {
    const consumo = e instanceof ErroTransmissor && e.codigo === "CONSUMO_INDEVIDO";
    const mensagem = e instanceof Error ? e.message : "Falha na consulta.";
    await admin.from("fiscal_config").update({
      dfe_ultima_consulta: new Date().toISOString(),
      // Erro: recuar 1 hora (consumo indevido) ou 15 minutos (rede, SEFAZ fora do ar).
      dfe_proxima_consulta: new Date(Date.now() + (consumo ? 61 : 15) * 60_000).toISOString(),
      dfe_ultimo_status: `Erro: ${mensagem}`.slice(0, 300),
    }).eq("organization_id", org);
    throw e;
  }

  if (config.ciencia_automatica) {
    const { data: semXml } = await admin.from("fiscal_dfe").select("id")
      .eq("organization_id", org).is("document_id", null).eq("situacao", "autorizada").eq("manifestacao", "nenhuma")
      .order("created_at").limit(20);
    for (const linha of semXml ?? []) {
      if (Date.now() > fim + 10_000) break;
      const ok = await darCiencia(admin, org, linha.id, { transmissor, credenciais: cred }).then(() => true, () => false);
      if (ok) r.ciencias++; else r.erros++;
    }
  }
  return r;
}

async function registrarDocumento(admin: SupabaseClient, org: string, doc: { nsu: string | null; schema: string | null; xml: string }, r: ResultadoRodada) {
  const lido = lerDocumentoDistribuido(doc);
  if (!lido) return;
  const { data, error } = await admin.rpc("fiscal_dfe_registrar", { p_org: org, p: lido.registro });
  if (error) throw new Error(error.message);
  const registrado = data as { nova: boolean; id?: string };
  if (registrado.nova) r.notasNovas++;
  if (lido.arquivo && registrado.id) {
    const guardado = await guardarOriginalSistema(admin, org, {
      modulo: "fiscal", feature: "fiscal.icms", origem: "sefaz", autor: "SEFAZ (busca automática)",
      arquivo: { nome: lido.arquivo.nome, tipo: "application/xml", dados: new TextEncoder().encode(lido.arquivo.xml) },
      titulo: lido.arquivo.titulo, entidade: { tipo: "fiscal_dfe", id: registrado.id },
    });
    await admin.rpc("fiscal_dfe_registrar", { p_org: org, p: { ...lido.registro, document_id: guardado.id } });
    if (!guardado.existente) r.xmlGuardados++;
  }
}

/** Ciência da Operação (evento 210210) numa nota recebida: informa a SEFAZ e libera o XML completo. */
export async function darCiencia(
  admin: SupabaseClient,
  org: string,
  dfeId: string,
  opcoes: { transmissor?: Transmissor; credenciais?: Credenciais } = {},
): Promise<{ jaTinha: boolean }> {
  const { data: linha } = await admin.from("fiscal_dfe").select("id, chave, manifestacao").eq("organization_id", org).eq("id", dfeId).maybeSingle();
  if (!linha) throw new FiscalNaoPronto("Nota não encontrada.");
  if (linha.manifestacao !== "nenhuma") return { jaTinha: true };
  const transmissor = opcoes.transmissor ?? obterTransmissor();
  const cred = opcoes.credenciais ?? (await credenciaisDaOrganizacao(admin, org));
  const agora = () => new Date().toISOString();
  const registrarCiencia = () => admin.from("fiscal_dfe").update({ manifestacao: "ciencia", manifestacao_em: agora(), manifestacao_erro: null, updated_at: agora() }).eq("id", linha.id);
  try {
    // A biblioteca transforma toda "Rejeição" em erro; o que volta aqui foi aceito (128/135/136).
    await transmissor.evento(cred, { tipo: "ciencia", chave: linha.chave });
    await registrarCiencia();
    return { jaTinha: false };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha na ciência.";
    // 573 — duplicidade de evento: a ciência já estava dada (por nós ou por outro sistema).
    if (/duplicidade de evento/i.test(mensagem)) { await registrarCiencia(); return { jaTinha: true }; }
    await admin.from("fiscal_dfe").update({ manifestacao_erro: mensagem.slice(0, 600), updated_at: agora() }).eq("id", linha.id);
    throw e;
  }
}
