import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getForjaSession } from "./client";
import { ForjaError } from "./forja-session";
import { montarRascunhoOS, proximaTentativa, type EnvioFila } from "./envio-os-core";

/**
 * Orçamento ganho → OS em rascunho na Forja (docs/PLANO-ORCAMENTO.md, O1 ajustada).
 *
 * A fila `forja_os_envios` nasce pelo gatilho do orçamento (ganho: criar; reabrir/cancelar: cancelar).
 * Aqui, com a chave de serviço, cada linha vai para a Forja (`/api/integracao/*`, conta de integração).
 * Roda na sincronização de 10 em 10 minutos e logo depois do ganho. Também envia o catálogo de
 * materiais do Almoxarifado (a lista de materiais da OS escolhe dele) e lê de volta a situação das OS.
 */

export type ResultadoEnvios = { criados: number; cancelados: number; erros: number; verificados: number; materiais: number; aviso?: string };

const SELECAO = `id, organization_id, ref, status, tentativas, forja_os_id, quote_item_id,
  quote:sales_quotes(numero, situacao, treino, pedido_cliente, prazo_entrega, observacoes, customer_id, cliente:customers(name)),
  item:sales_quote_items(ordem, descricao, desenho, quantidade, preco_unitario, prazo_entrega, item_pedido, observacao,
    produto:products(codigo, descricao, tipo_peca, material, forja_artigo_id))`;

const mensagem = (body: unknown, status: number) => {
  const m = body && typeof body === "object" ? (body as { message?: unknown }).message : null;
  return typeof m === "string" && m ? m : `A Forja respondeu ${status}.`;
};

export async function processarEnviosForja(admin: SupabaseClient, opcoes: { quoteId?: string; limite?: number } = {}): Promise<ResultadoEnvios> {
  const r: ResultadoEnvios = { criados: 0, cancelados: 0, erros: 0, verificados: 0, materiais: 0 };
  const forja = getForjaSession();
  const agora = new Date();

  let consulta = admin.from("forja_os_envios").select(SELECAO).in("status", ["pendente", "cancelar", "erro"]).lte("proxima_tentativa", agora.toISOString())
    .order("created_at").limit(opcoes.limite ?? 20);
  if (opcoes.quoteId) consulta = consulta.eq("quote_id", opcoes.quoteId);
  const { data: fila, error } = await consulta;
  if (error) throw new Error(`fila de envios: ${error.message}`);

  // Vínculo cliente da plataforma → cliente da Forja (o espelho grava).
  const clientes = [...new Set((fila ?? []).map((e) => (e as unknown as EnvioFila).quote?.customer_id).filter(Boolean))] as string[];
  const { data: vinculos } = clientes.length
    ? await admin.from("customer_external_ids").select("customer_id, external_id").eq("source", "forja").in("customer_id", clientes)
    : { data: [] };
  const forjaDoCliente = new Map((vinculos ?? []).map((v) => [String(v.customer_id), String(v.external_id)]));

  for (const linha of (fila ?? []) as unknown as EnvioFila[]) {
    const cancelar = linha.status === "cancelar" || (linha.status === "erro" && linha.quote?.situacao !== "ganho");
    const gravar = (dados: Record<string, unknown>) => admin.from("forja_os_envios").update({ ...dados, updated_at: new Date().toISOString() }).eq("id", linha.id);
    const falhar = async (texto: string, permanente: boolean) => {
      r.erros += 1;
      await gravar({ status: "erro", ultimo_erro: texto.slice(0, 500), tentativas: linha.tentativas + 1, proxima_tentativa: proximaTentativa(linha.tentativas + 1, permanente, agora).toISOString() });
    };
    try {
      if (cancelar) {
        if (!linha.forja_os_id) { await gravar({ status: "cancelado" }); continue; }
        const resp = await forja.send("POST", `/api/integracao/os-rascunho/${encodeURIComponent(linha.ref)}/cancelar`);
        if (resp.status === 200) {
          r.cancelados += 1;
          await gravar({ status: "cancelado", forja_status: "cancelada", ultimo_erro: null });
        } else {
          await falhar(mensagem(resp.body, resp.status), resp.status >= 400 && resp.status < 500);
        }
        continue;
      }
      const montado = montarRascunhoOS(linha, linha.quote?.customer_id ? forjaDoCliente.get(linha.quote.customer_id) ?? null : null);
      if ("erro" in montado) { await falhar(montado.erro, true); continue; }
      const resp = await forja.send("POST", "/api/integracao/os-rascunho", montado.payload);
      const d = (resp.body as { data?: { id?: string; codigoGrv?: string; status?: string } } | null)?.data;
      if ((resp.status === 200 || resp.status === 201) && d?.id) {
        r.criados += 1;
        await gravar({ status: "enviado", forja_os_id: d.id, forja_codigo: d.codigoGrv ?? null, forja_status: d.status ?? "rascunho", ultimo_erro: null, enviado_em: new Date().toISOString(), verificado_em: new Date().toISOString() });
      } else {
        await falhar(mensagem(resp.body, resp.status), resp.status >= 400 && resp.status < 500);
      }
    } catch (e) {
      await falhar(e instanceof ForjaError ? e.message : `Falha ao falar com a Forja: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  // Situação das OS enviadas (rascunho → aberta → em produção…) e a lista de materiais da OS.
  if (!opcoes.quoteId) {
    const limite = new Date(agora.getTime() - 10 * 60_000).toISOString();
    const { data: enviados } = await admin.from("forja_os_envios").select("id, ref").eq("status", "enviado")
      .or(`forja_status.is.null,forja_status.not.in.(finalizada,cancelada)`).or(`verificado_em.is.null,verificado_em.lt.${limite}`).limit(50);
    for (const e of enviados ?? []) {
      try {
        const os = (await forja.getData(`/api/integracao/os-rascunho/${encodeURIComponent(e.ref)}`)) as { id?: string; codigoGrv?: string; status?: string; materiais?: unknown[] } | null;
        if (!os?.id) continue;
        r.verificados += 1;
        await admin.from("forja_os_envios").update({
          forja_codigo: os.codigoGrv ?? null, forja_status: os.status ?? null, verificado_em: new Date().toISOString(), updated_at: new Date().toISOString(),
          materiais: Array.isArray(os.materiais) && os.materiais.length ? os.materiais : null,
        }).eq("id", e.id);
      } catch {
        // Fica para a próxima rodada; o envio continua valendo.
      }
    }
    try {
      r.materiais = await enviarCatalogoMateriais(admin);
    } catch (e) {
      r.aviso = `catálogo de materiais: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return r;
}

const POR_LOTE = 1000;
const LOTES_POR_RODADA = 5;

/**
 * Catálogo do Almoxarifado → Forja: só o que mudou desde o último envio (inativo vai como inativo).
 * Cursor pelo par (alterado em, código): a carga grava centenas de materiais no mesmo instante.
 */
export async function enviarCatalogoMateriais(admin: SupabaseClient): Promise<number> {
  const { data: orgs } = await admin.from("organizations").select("id");
  if (!orgs || orgs.length !== 1) return 0;
  const org = orgs[0].id as string;
  const { data: cursor } = await admin.from("integration_cursors").select("valor, marca").eq("organization_id", org).eq("chave", "forja_materiais").maybeSingle();
  let desde = (cursor?.valor as string | null) ?? null;
  let marca = (cursor?.marca as string | null) ?? "";
  const forja = getForjaSession();
  let enviados = 0;
  for (let lote = 0; lote < LOTES_POR_RODADA; lote++) {
    let consulta = admin.from("materials").select("codigo, descricao, unidade, familia, grupo_nome, ativo, updated_at")
      .eq("organization_id", org).order("updated_at").order("codigo").limit(POR_LOTE);
    if (desde) consulta = consulta.or(`updated_at.gt."${desde}",and(updated_at.eq."${desde}",codigo.gt."${marca}")`);
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    const resp = await forja.send("PUT", "/api/integracao/materiais", {
      itens: data.map((m) => ({ codigo: m.codigo, descricao: m.descricao, unidade: m.unidade, familia: m.familia, grupo: m.grupo_nome, ativo: m.ativo })),
    });
    if (resp.status !== 200) throw new Error(mensagem(resp.body, resp.status));
    enviados += data.length;
    const ultimo = data[data.length - 1];
    desde = ultimo.updated_at as string;
    marca = ultimo.codigo as string;
    const { error: erroCursor } = await admin.from("integration_cursors").upsert(
      { organization_id: org, chave: "forja_materiais", valor: desde, marca, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,chave" },
    );
    if (erroCursor) throw new Error(erroCursor.message);
    if (data.length < POR_LOTE) break;
  }
  return enviados;
}
