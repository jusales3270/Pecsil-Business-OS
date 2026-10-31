import type { SupabaseClient } from "@supabase/supabase-js";
import type { Abrir, Ferramenta, ModoRegistro, Registro, Resultado } from "./base.ts";

/**
 * Abrir ou destacar um registro exato (T3 do E7.T, 31/10/2026). O modelo só aponta tipo e id, e cada resolvedor confere no
 * banco com a sessão da pessoa: id inventado ou fora da permissão não abre nada. Navegar não grava nada.
 * Título do Financeiro segue pelo abrir_lancamento (lib/sara/ferramentas.ts). OS e card do funil não têm detalhe na
 * tela, então abrir e destacar dão no mesmo. A chave de cada tipo é a da tela: código da OS, número da compra, UUID nos demais.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAO_ACHEI = "Registro não encontrado ou fora das permissões desta pessoa. Use o id que veio da busca.";

type Resolvido = { erro: string } | { abrir: Abrir; dados: Record<string, unknown> };
export type TipoRegistro = "os" | "card_comercial" | "nc" | "pedido_compra";

const RESOLVEDORES: Record<TipoRegistro, { aceita: RegExp; resolver: (sb: SupabaseClient, id: string, modo: ModoRegistro) => Promise<Resolvido> }> = {
  os: { aceita: /^[\w./-]{1,30}$/, resolver: async (sb, id) => {
    const { data, error } = await sb.from("production_orders").select("code, customer_name, status").eq("code", id).is("removed_from_source_at", null).limit(1).maybeSingle<{ code: string; customer_name: string | null; status: string }>();
    if (error) throw new Error(error.message);
    if (!data) return { erro: NAO_ACHEI };
    return { abrir: { modulo: "producao", secao: "Ordens de serviço", rotulo: `Produção › Ordens de serviço › OS ${data.code}`, registro: { tipo: "os", id: data.code, modo: "destacar" } },
      dados: { os: data.code, cliente: data.customer_name, situacao: data.status } };
  } },
  card_comercial: { aceita: UUID, resolver: async (sb, id) => {
    const { data, error } = await sb.from("crm_cards").select("id, title, crm_stages(label)").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { erro: NAO_ACHEI };
    const c = data as unknown as { id: string; title: string; crm_stages: { label: string } | null };
    return { abrir: { modulo: "comercial", secao: "funil", rotulo: `Comercial › Funil › ${c.title}`, registro: { tipo: "card_comercial", id: c.id, modo: "destacar" } },
      dados: { card: c.title, etapa: c.crm_stages?.label ?? null } };
  } },
  nc: { aceita: UUID, resolver: async (sb, id, modo) => {
    const { data, error } = await sb.from("qualidade_nao_conformidades").select("id, numero, tipo, situacao").eq("id", id).maybeSingle<{ id: string; numero: number; tipo: string; situacao: string }>();
    if (error) throw new Error(error.message);
    if (!data) return { erro: NAO_ACHEI };
    return { abrir: { modulo: "qualidade", secao: "Não conformidades", rotulo: `Qualidade › Não conformidades › NC-${data.numero}`, registro: { tipo: "nc", id: data.id, modo } },
      dados: { nc: `NC-${data.numero}`, tipo: data.tipo, situacao: data.situacao } };
  } },
  pedido_compra: { aceita: /^\d{1,18}$/, resolver: async (sb, id, modo) => {
    const { data, error } = await sb.from("compras").select("id, fornecedor, produto, cotacao_id").eq("id", id).maybeSingle<{ id: number; fornecedor: string; produto: string; cotacao_id: number | null }>();
    if (error) throw new Error(error.message);
    if (!data) return { erro: NAO_ACHEI };
    return { abrir: { modulo: "compras", secao: "compras", rotulo: `Compras › Compras realizadas › ${data.fornecedor}`, registro: { tipo: "pedido_compra", id: String(data.id), cotacao: data.cotacao_id, modo } },
      dados: { fornecedor: data.fornecedor, produto: data.produto } };
  } },
};

export async function resolverRegistro(sb: SupabaseClient, tipo: unknown, id: unknown, modo: ModoRegistro = "abrir"): Promise<Resolvido> {
  const r = Object.hasOwn(RESOLVEDORES, String(tipo)) ? RESOLVEDORES[tipo as TipoRegistro] : null;
  if (!r) return { erro: "Tipo de registro desconhecido." };
  const chave = String(id ?? "").trim();
  if (!r.aceita.test(chave)) return { erro: "id inválido: use o id que veio da busca." };
  return r.resolver(sb, chave, modo);
}

/** O nome do registro aberto na tela, resolvido no servidor (T2): nunca o que veio do navegador. */
export async function rotuloDoRegistro(sb: SupabaseClient, registro: unknown): Promise<string | null> {
  const r = registro as { tipo?: unknown; id?: unknown } | null;
  if (!r) return null;
  if (r.tipo === "titulo") {
    if (!UUID.test(String(r.id ?? ""))) return null;
    const { data } = await sb.from("finance_titles").select("direction, counterparty_name").eq("id", String(r.id)).maybeSingle<{ direction: string; counterparty_name: string }>();
    return data ? `Financeiro › ${data.direction === "payable" ? "Contas a pagar" : "Contas a receber"} › ${data.counterparty_name}` : null;
  }
  const v = await resolverRegistro(sb, r.tipo, r.id).catch(() => null);
  return v && "abrir" in v ? v.abrir.rotulo : null;
}

export const ABRIR_REGISTRO: Ferramenta = {
  nome: "abrir_registro", exige: ["producao.os", "producao.painel", "producao.bi", "comercial.funil", "qualidade.nao_conformidades", "compras.realizadas"],
  descricao: "Leva a pessoa até um registro exato. modo abrir: abre o detalhe. modo destacar: rola até ele e acende na tela (\"mostra onde está\"). tipo os usa o código da OS; card_comercial, nc e pedido_compra usam o id que veio da consulta. Use só id que veio de uma consulta. Quando pedirem para mostrar um registro exato, prefira isto a abrir_tela e a gráfico. Diga que levou a pessoa até ele, sem afirmar que já está aceso: quem acende é a tela.",
  esquema: { type: "object", properties: {
    tipo: { type: "string", enum: Object.keys(RESOLVEDORES) },
    id: { type: "string", description: "O id que veio da consulta (na OS, o código)." },
    modo: { type: "string", enum: ["abrir", "destacar"] },
  }, required: ["tipo", "id"] },
  rodar: async (sb, e): Promise<Resultado> => {
    const r = await resolverRegistro(sb, e.tipo, e.id, e.modo === "destacar" ? "destacar" : "abrir");
    if ("erro" in r) return { dados: r, fontes: [] };
    return { dados: { aberto: r.abrir.rotulo, ...r.dados }, fontes: [], abrir: r.abrir };
  },
};

export type { Registro };
