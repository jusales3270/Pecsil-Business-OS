import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getForjaSession } from "./client";
import { normalizePartyName, parseClients, parseOrders, similarPairs, type MirrorFinancials, type MirrorOrder } from "./orders-core";

/**
 * Sincronização das OS do Forja com o Business OS (etapas 2 e 3 do
 * docs/PLANO-CUSTO-MARGEM.md).
 *
 * 1. Clientes: cada cliente do Forja ganha um vínculo com o cliente único
 *    (`customer_external_ids`). Sem vínculo, é encontrado pelo nome
 *    normalizado ou criado (`resolve_customer`). Nunca unifica dois clientes
 *    sozinho: nomes parecidos vão para o relatório.
 * 2. OS: espelho só de leitura, gravado só quando algo mudou. OS que some da
 *    lista do Forja é marcada, não apagada.
 *
 * Em modo simulação, lê tudo e monta o mesmo relatório sem gravar nada além
 * do registro da rodada.
 */

const SOURCE = "forja";
const LOTE = 400;

type Row = Record<string, unknown>;

export type RelatorioSync = {
  modo: "apply" | "simulate";
  clientes: { noForja: number; jaVinculados: number; vinculadosAExistente: number; criados: number; parecidos: [string, string][] };
  ordens: { noForja: number; rejeitadas: number; novas: number; alteradas: number; iguais: number; removidas: number; semCliente: number };
  erro?: string;
};

const chunks = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / LOTE) }, (_, i) => list.slice(i * LOTE, (i + 1) * LOTE));

async function todas(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, contexto: string) {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(`${contexto}: ${error.message}`);
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const ORDER_FIELDS = ["code", "external_customer_id", "customer_name", "article_code", "article_description", "product_type", "quantity", "due_date", "opened_at", "priority", "status", "lots_count", "source_updated_at"] as const;
const FIN_FIELDS = ["unit_price", "total_value", "customer_po", "invoice_number", "invoice_status", "invoice_date", "amount_received", "paid_at"] as const;

/** Compara o que veio do Forja com a linha gravada (números e datas normalizados). */
function mudou<T extends Row>(novo: T, atual: Row | undefined, campos: readonly string[]) {
  if (!atual) return true;
  return campos.some((campo) => {
    const a = novo[campo] ?? null;
    let b = atual[campo] ?? null;
    if (typeof a === "number" && b !== null) b = Number(b);
    if (typeof a === "string" && typeof b === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a)) return Date.parse(a) !== Date.parse(b);
    return a !== b;
  });
}

export async function sincronizarOrdens(admin: SupabaseClient, { simular }: { simular: boolean }): Promise<RelatorioSync> {
  const modo = simular ? "simulate" : "apply";
  const relatorio: RelatorioSync = {
    modo,
    clientes: { noForja: 0, jaVinculados: 0, vinculadosAExistente: 0, criados: 0, parecidos: [] },
    ordens: { noForja: 0, rejeitadas: 0, novas: 0, alteradas: 0, iguais: 0, removidas: 0, semCliente: 0 },
  };

  const { data: orgs, error: orgError } = await admin.from("organizations").select("id");
  if (orgError || !orgs || orgs.length !== 1) throw new Error("Esperada exatamente 1 organização.");
  const org = orgs[0].id as string;

  const { data: run } = await admin.from("integration_sync_runs").insert({ organization_id: org, source: SOURCE, mode: modo }).select("id").single();
  const finish = async (ok: boolean, erro?: string) => {
    if (!run) return;
    await admin.from("integration_sync_runs").update({
      finished_at: new Date().toISOString(), ok, error: erro ?? null,
      counts: { clientes: { ...relatorio.clientes, parecidos: relatorio.clientes.parecidos.length }, ordens: relatorio.ordens },
    }).eq("id", run.id);
  };

  try {
    const forja = getForjaSession();
    const clientes = parseClients(await forja.getData("/api/clientes"));
    const { orders, rejected } = parseOrders(await forja.getData("/api/os"));
    relatorio.ordens.noForja = orders.length;
    relatorio.ordens.rejeitadas = rejected;

    // --- Clientes ---------------------------------------------------------
    // A lista do Forja só traz os ativos; uma OS antiga pode apontar para um
    // cliente inativo. Os dois entram.
    const porId = new Map(clientes.map((c) => [c.externalId, c.name]));
    for (const { order } of orders) {
      if (order.external_customer_id && order.customer_name && !porId.has(order.external_customer_id)) {
        porId.set(order.external_customer_id, order.customer_name);
      }
    }
    relatorio.clientes.noForja = porId.size;
    relatorio.clientes.parecidos = similarPairs([...new Set(porId.values())]);

    const vinculos = await todas((a, b) => admin.from("customer_external_ids").select("external_id, customer_id").eq("organization_id", org).eq("source", SOURCE).range(a, b), "vínculos");
    const clienteDe = new Map(vinculos.map((v) => [String(v.external_id), String(v.customer_id)]));
    const existentes = await todas((a, b) => admin.from("customers").select("id, normalized_name, merged_into").eq("organization_id", org).range(a, b), "clientes");
    const porNome = new Map(existentes.map((c) => [String(c.normalized_name), String(c.merged_into ?? c.id)]));
    const criadosNaSimulacao = new Set<string>();

    for (const [externalId, nome] of porId) {
      if (clienteDe.has(externalId)) {
        relatorio.clientes.jaVinculados += 1;
        continue;
      }
      const chave = normalizePartyName(nome);
      const existente = chave ? porNome.get(chave) : undefined;
      if (existente) relatorio.clientes.vinculadosAExistente += 1;
      else if (chave && !criadosNaSimulacao.has(chave)) relatorio.clientes.criados += 1;
      if (simular) {
        if (chave) criadosNaSimulacao.add(chave);
        continue;
      }
      const { data: customerId, error } = await admin.rpc("resolve_customer", { target_org: org, raw_name: nome });
      if (error || !customerId) throw new Error(`cliente "${nome}": ${error?.message ?? "sem id"}`);
      const { error: linkError } = await admin.from("customer_external_ids").upsert(
        { organization_id: org, customer_id: customerId, source: SOURCE, external_id: externalId, external_name: nome },
        { onConflict: "organization_id,source,external_id" },
      );
      if (linkError) throw new Error(`vínculo "${nome}": ${linkError.message}`);
      clienteDe.set(externalId, String(customerId));
      if (chave) porNome.set(chave, String(customerId));
    }

    // --- OS ---------------------------------------------------------------
    const atuais = await todas((a, b) => admin.from("production_orders").select(`id, external_id, customer_id, removed_from_source_at, ${ORDER_FIELDS.join(", ")}`).eq("organization_id", org).eq("source", SOURCE).range(a, b), "OS espelhadas");
    const porExterno = new Map(atuais.map((o) => [String(o.external_id), o]));
    const financeiros = await todas((a, b) => admin.from("production_order_financials").select(`order_id, ${FIN_FIELDS.join(", ")}`).eq("organization_id", org).range(a, b), "valores");
    const finDe = new Map(financeiros.map((f) => [String(f.order_id), f]));

    const gravarOrdens: (MirrorOrder & Row)[] = [];
    const gravarValores: { externalId: string; financials: MirrorFinancials }[] = [];
    for (const { order, financials } of orders) {
      const customerId = order.external_customer_id ? clienteDe.get(order.external_customer_id) ?? null : null;
      if (!customerId && !(simular && order.external_customer_id)) relatorio.ordens.semCliente += 1;
      const atual = porExterno.get(order.external_id);
      const linha = { ...order, customer_id: customerId } as MirrorOrder & Row;
      const ordemMudou = !atual || atual.removed_from_source_at !== null || atual.customer_id !== customerId || mudou(linha, atual, ORDER_FIELDS);
      const valoresMudaram = mudou(financials as unknown as Row, atual ? finDe.get(String(atual.id)) : undefined, FIN_FIELDS);
      if (!atual) relatorio.ordens.novas += 1;
      else if (ordemMudou || valoresMudaram) relatorio.ordens.alteradas += 1;
      else relatorio.ordens.iguais += 1;
      if (ordemMudou) gravarOrdens.push(linha);
      if (valoresMudaram) gravarValores.push({ externalId: order.external_id, financials });
    }
    const noForja = new Set(orders.map((o) => o.order.external_id));
    const removidas = atuais.filter((o) => !noForja.has(String(o.external_id)) && o.removed_from_source_at === null);
    relatorio.ordens.removidas = removidas.length;

    if (!simular) {
      const agora = new Date().toISOString();
      for (const parte of chunks(gravarOrdens)) {
        const { error } = await admin.from("production_orders").upsert(
          parte.map((o) => ({ ...o, organization_id: org, source: SOURCE, synced_at: agora, removed_from_source_at: null })),
          { onConflict: "organization_id,source,external_id" },
        );
        if (error) throw new Error(`OS: ${error.message}`);
      }
      if (gravarValores.length) {
        const ids = await todas((a, b) => admin.from("production_orders").select("id, external_id").eq("organization_id", org).eq("source", SOURCE).range(a, b), "ids das OS");
        const idDe = new Map(ids.map((o) => [String(o.external_id), String(o.id)]));
        for (const parte of chunks(gravarValores)) {
          const { error } = await admin.from("production_order_financials").upsert(
            parte.map((v) => ({ order_id: idDe.get(v.externalId), organization_id: org, ...v.financials })),
            { onConflict: "order_id" },
          );
          if (error) throw new Error(`valores das OS: ${error.message}`);
        }
      }
      for (const parte of chunks(removidas.map((o) => String(o.id)))) {
        const { error } = await admin.from("production_orders").update({ removed_from_source_at: agora }).in("id", parte);
        if (error) throw new Error(`OS removidas: ${error.message}`);
      }
    }

    await finish(true);
    return relatorio;
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    relatorio.erro = mensagem;
    await finish(false, mensagem);
    return relatorio;
  }
}
