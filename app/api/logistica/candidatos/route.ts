import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { enderecoCompleto, freteEhNosso } from "../../../../lib/logistica/regras.mjs";
import { respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

type Cli = { id: string; name: string; logradouro: string | null; cep: string | null; municipio: string | null; uf: string | null };

/**
 * O que pode virar entrega: as OS abertas ou em produção e os pedidos ganhos (frete nosso primeiro), que
 * ainda não têm entrega aberta, e a lista de clientes para a entrega avulsa (com o aviso de endereço incompleto).
 */
export async function GET() {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const sb = guard.supabase;
  const [os, pedidos, clientes, abertas, motoristas] = await Promise.all([
    sb.from("production_orders").select("id, code, customer_id, customer_name, article_description, quantity, due_date, status")
      .in("status", ["aberta", "em_producao"]).not("customer_id", "is", null).order("due_date", { ascending: true, nullsFirst: false }).limit(200),
    sb.from("sales_quotes").select("id, numero, customer_id, frete_modalidade, prazo_entrega, pedido_cliente, treino, customers(name)")
      .eq("situacao", "ganho").order("ganho_em", { ascending: false }).limit(200),
    sb.from("customers").select("id, name, logradouro, cep, municipio, uf").eq("active", true).is("merged_into", null).order("name").limit(1000),
    sb.from("logistica_entregas").select("origem_tipo, origem_id").in("situacao", ["criada", "enviada", "a_caminho", "entregue"]),
    sb.from("logistica_motoristas").select("id, nome, fleetbase_motorista, logistica_veiculos(placa)").eq("ativo", true).order("nome"),
  ]);
  const falha = [os, pedidos, clientes, abertas].find((x) => x.error);
  if (falha?.error) return respostaDeErro(falha.error, "Não foi possível ler as OS e os pedidos.");
  const ja = new Set((abertas.data ?? []).map((e) => `${e.origem_tipo}:${e.origem_id}`));
  const semEndereco = new Set(((clientes.data ?? []) as Cli[]).filter((c) => !enderecoCompleto(c)).map((c) => c.id));
  return NextResponse.json({
    os: (os.data ?? []).filter((o) => !ja.has(`os:${o.id}`)).map((o) => ({ ...o, semEndereco: semEndereco.has(o.customer_id as string) })),
    pedidos: (pedidos.data ?? []).filter((p) => !ja.has(`pedido:${p.id}`)).map((p) => ({
      id: p.id, numero: p.numero, customer_id: p.customer_id, cliente: (p.customers as unknown as { name?: string } | null)?.name ?? "—",
      freteNosso: freteEhNosso(p.frete_modalidade), prazo: p.prazo_entrega, pedidoCliente: p.pedido_cliente, treino: p.treino,
      semEndereco: semEndereco.has(p.customer_id as string),
    })).sort((a, b) => Number(b.freteNosso) - Number(a.freteNosso)),
    clientes: ((clientes.data ?? []) as Cli[]).map((c) => ({ id: c.id, nome: c.name, semEndereco: semEndereco.has(c.id) })),
    motoristas: (motoristas.data ?? []).filter((m) => m.fleetbase_motorista).map((m) => ({
      id: m.id, nome: m.nome, placa: (m.logistica_veiculos as unknown as { placa?: string } | null)?.placa ?? null,
    })),
  });
}
