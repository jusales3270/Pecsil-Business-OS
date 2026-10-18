import type { SupabaseClient } from "@supabase/supabase-js";
import { brl, dataBR, dias, hoje, link, num, plural, reais, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";

/**
 * SARA do Almoxarifado: pedidos de material, o que está a caminho (comprado e ainda não recebido),
 * recebimento de nota e o catálogo de materiais. O saldo vindo do GRV NÃO é confiável (o saldo de
 * abertura virá da contagem física): a SARA não informa estoque. Quem decide é o Henrique.
 */

const M = "almoxarifado";
const PEDIDOS = ["almoxarifado.solicitacoes", "almoxarifado.recebimento"];
/** Mesmo grupo que lê o catálogo (lib/almoxarifado/materiais.ts, LEITORES_MATERIAIS). */
export const LEITORES_MATERIAIS = ["almoxarifado.materiais", "almoxarifado.solicitacoes", "almoxarifado.recebimento", "compras.cotacoes", "compras.realizadas", "compras.aprovacoes", "fundicao.pedidos", "rh.sst"];
const tela = (secao: string): Abrir => ({ modulo: M, secao, rotulo: `Almoxarifado › ${secao}` });
const fonte = (secao: string) => ({ rotulo: `Almoxarifado › ${secao}`, link: link(M, secao) });

export const SITUACAO_PEDIDO: Record<string, string> = {
  aberta: "com o Compras (aberto)", em_cotacao: "com o Compras (em cotação)", aprovada: "aprovado, aguardando compra", rejeitada: "rejeitado",
  comprada: "comprado (a caminho)", parcial: "recebido em parte", recebida: "recebido", cancelada: "cancelado",
};

type Pedido = { numero: number; divisao: string; origem: string; urgencia: string; status: string; precisa_ate: string | null; requested_by_name: string | null; cancel_reason: string | null; created_at: string; updated_at: string | null; material_request_items: { produto: string; quantidade: number; unidade: string | null }[] };
/** Pedidos de material (o RLS já restringe: quem só tem a Fundição vê só os da Fundição). */
export async function pedidosDeMaterial(sb: SupabaseClient, f: { status?: string[]; origem?: string; dias?: number } = {}): Promise<Pedido[]> {
  let q = sb.from("material_requests").select("numero, divisao, origem, urgencia, status, precisa_ate, requested_by_name, cancel_reason, created_at, updated_at, material_request_items(produto, quantidade, unidade)")
    .order("created_at", { ascending: false }).limit(500);
  if (f.status?.length) q = q.in("status", f.status);
  if (f.origem) q = q.eq("origem", f.origem);
  if (f.dias) q = q.gte("created_at", new Date(Date.now() - f.dias * 86_400_000).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Pedido[];
}
export const linhaDoPedido = (p: Pedido, h: string) => ({
  pedido: p.numero, divisao: p.divisao, origem: p.origem, urgente: p.urgencia === "urgente", situacao: SITUACAO_PEDIDO[p.status] ?? p.status,
  precisa_ate: p.precisa_ate, aberto_ha_dias: dias(p.created_at, h), parado_ha_dias: dias(p.updated_at ?? p.created_at, h), solicitante: p.requested_by_name,
  motivo_cancelamento: p.cancel_reason, itens: (p.material_request_items ?? []).slice(0, 8).map((i) => `${i.quantidade} ${i.unidade ?? ""} ${i.produto}`.trim()),
});

/** Catálogo de materiais (sem o saldo do GRV, que não é confiável). */
export async function buscarMateriais(sb: SupabaseClient, e: Record<string, unknown>) {
  const { data, error } = await sb.rpc("almoxarifado_materiais_buscar", { p_q: termo(e.busca), p_ativos: true, p_limite: num(e.limite, 10, 1, 30) });
  if (error) throw new Error(error.message);
  const lista = ((data ?? []) as { codigo: string; descricao: string; unidade: string | null; familia: string | null; grupo_nome: string | null; ncm: string | null; pendencias: string[] | null }[])
    .map((m) => ({ codigo: m.codigo, descricao: m.descricao, unidade: m.unidade, familia: m.familia, grupo: m.grupo_nome, ncm: m.ncm, pendencias_do_cadastro: m.pendencias ?? [] }));
  return { dados: { busca: termo(e.busca), encontrados: lista, observacao: "Saldo em estoque não é informado: o saldo do GRV não é confiável até a contagem física." }, fontes: [fonte("Materiais")] };
}

type ACaminho = { cotacaoId: number; fornecedor: string; divisao: string; origem: string | null; solicitante: string | null; compradoEm: string | null; totalComprado: number; jaRecebido: number; previsaoVencimento: string | null; itens: { produto: string; quantidade: number; unidade: string | null }[] };
async function aCaminho(sb: SupabaseClient): Promise<ACaminho[]> {
  const { data, error } = await sb.rpc("almoxarifado_a_caminho");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as ACaminho[];
}

const ferramentas: Ferramenta[] = [
  {
    nome: "almoxarifado_a_caminho", rotulo: "material a caminho", exige: PEDIDOS,
    descricao: "Material comprado que ainda não chegou (a caminho): por OC, fornecedor, divisão, quando foi comprado, valor comprado e já recebido, vencimento previsto do pagamento e itens.",
    esquema: { type: "object", properties: { fornecedor: { type: "string" } } },
    rodar: async (sb, e) => {
      let lista = await aCaminho(sb);
      const f = termo(e.fornecedor).toLowerCase();
      if (f) lista = lista.filter((x) => (x.fornecedor ?? "").toLowerCase().includes(f));
      const h = hoje();
      return {
        dados: { quantidade: lista.length, total: reais(lista.reduce((s, x) => s + Number(x.totalComprado ?? 0), 0)),
          ocs: lista.slice(0, 25).map((x) => ({ oc: x.cotacaoId, fornecedor: x.fornecedor, divisao: x.divisao, comprado_em: x.compradoEm, ha_dias: x.compradoEm ? dias(x.compradoEm, h) : null,
            total: reais(Number(x.totalComprado ?? 0)), ja_recebido: reais(Number(x.jaRecebido ?? 0)), vencimento_previsto: x.previsaoVencimento,
            itens: (x.itens ?? []).slice(0, 6).map((i) => `${i.quantidade} ${i.unidade ?? ""} ${i.produto}`.trim()) })) },
        fontes: [fonte("A caminho")],
      };
    },
  },
  {
    nome: "almoxarifado_pedidos", rotulo: "pedidos de material", exige: PEDIDOS,
    descricao: "Pedidos de material por situação (padrão: em andamento — com o Compras, aprovados e a caminho): número, divisão, origem, urgência, precisa até, há quantos dias e itens.",
    esquema: { type: "object", properties: { situacao: { type: "string", enum: ["em_andamento", "com_compras", "aprovados", "a_caminho", "recebidos", "rejeitados_cancelados", "todos"] } } },
    rodar: async (sb, e) => {
      const mapa: Record<string, string[] | undefined> = {
        em_andamento: ["aberta", "em_cotacao", "aprovada", "comprada", "parcial"], com_compras: ["aberta", "em_cotacao"], aprovados: ["aprovada"],
        a_caminho: ["comprada", "parcial"], recebidos: ["recebida"], rejeitados_cancelados: ["rejeitada", "cancelada"], todos: undefined,
      };
      const chave = String(e.situacao ?? "em_andamento");
      const h = hoje();
      const lista = (await pedidosDeMaterial(sb, { status: mapa[chave] ?? mapa.em_andamento, dias: chave === "recebidos" || chave === "todos" ? 90 : undefined })).map((p) => linhaDoPedido(p, h));
      return { dados: { situacao: chave, quantidade: lista.length, urgentes: lista.filter((l) => l.urgente).length, pedidos: lista.slice(0, 30) }, fontes: [fonte("Solicitações")] };
    },
  },
  {
    nome: "almoxarifado_recebidos", rotulo: "notas recebidas", exige: ["almoxarifado.recebimento", "almoxarifado.solicitacoes", "financeiro.pagar", "fiscal.icms"],
    descricao: "Notas recebidas no almoxarifado num período (padrão 30 dias): quantas, valor total, as com divergência e as últimas, com fornecedor, número da nota e valor.",
    esquema: { type: "object", properties: { dias: { type: "integer" } } },
    rodar: async (sb, e) => {
      const de = new Date(Date.now() - num(e.dias, 30, 1, 365) * 86_400_000).toISOString();
      const { data, error } = await sb.from("receipts").select("numero, fornecedor, nf_numero, recebido_em, valor_total, divisao, divergencia, divergencia_motivo, received_by_name")
        .gte("recebido_em", de).order("recebido_em", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      const lista = (data ?? []) as { valor_total: number | null; divergencia: boolean | null }[];
      return {
        dados: { desde: de.slice(0, 10), quantidade: lista.length, total: reais(lista.reduce((s, r) => s + Number(r.valor_total ?? 0), 0)),
          com_divergencia: lista.filter((r) => r.divergencia).length, ultimas: lista.slice(0, 15) },
        fontes: [fonte("Recebidos")],
      };
    },
  },
  {
    nome: "almoxarifado_materiais", rotulo: "catálogo de materiais", exige: LEITORES_MATERIAIS,
    descricao: "Busca no catálogo de materiais pelo código (do GRV) ou pela descrição: código, descrição, unidade, família, grupo, NCM e pendências do cadastro. Não informa saldo (o do GRV não é confiável).",
    esquema: { type: "object", properties: { busca: { type: "string", description: "Código ou parte da descrição." }, limite: { type: "integer" } }, required: ["busca"] },
    rodar: buscarMateriais,
  },
];

const telas: Tela[] = [
  { id: "almox_painel", modulo: M, secao: "Painel", rotulo: "Almoxarifado › Painel", exige: [...PEDIDOS, "almoxarifado.materiais"], serve: "visão geral" },
  { id: "almox_solicitacoes", modulo: M, secao: "Solicitações", rotulo: "Almoxarifado › Solicitações", exige: PEDIDOS, serve: "pedidos de material" },
  { id: "almox_a_caminho", modulo: M, secao: "A caminho", rotulo: "Almoxarifado › A caminho", exige: PEDIDOS, serve: "material comprado ainda não recebido; dar entrada da nota" },
  { id: "almox_recebidos", modulo: M, secao: "Recebidos", rotulo: "Almoxarifado › Recebidos", exige: PEDIDOS, serve: "notas já recebidas" },
  { id: "almox_diretas", modulo: M, secao: "Compras diretas", rotulo: "Almoxarifado › Compras diretas", exige: ["almoxarifado.recebimento"], serve: "compras sem cotação" },
  { id: "almox_materiais", modulo: M, secao: "Materiais", rotulo: "Almoxarifado › Materiais", exige: LEITORES_MATERIAIS, serve: "catálogo de materiais" },
];

const regras: Agente["regras"] = [
  {
    exige: PEDIDOS,
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const { data: div } = await sb.from("receipts").select("numero, fornecedor, nf_numero").eq("divergencia", true).order("recebido_em", { ascending: false }).limit(100);
      const divs = (div ?? []) as { numero: number; fornecedor: string; nf_numero: string | null }[];
      if (divs.length) saida.push({
        chave: `almoxarifado.divergencias:${divs.map((d) => d.numero).join(",")}`, nivel: "urgente",
        titulo: `${plural(divs.length, "recebimento com divergência", "recebimentos com divergência")}`,
        detalhe: `${divs.slice(0, 3).map((d) => `${d.fornecedor}${d.nf_numero ? ` (NF ${d.nf_numero})` : ""}`).join(" · ")}. Confira com o Compras e o fornecedor.`,
        abrir: tela("Recebidos"),
      });
      const lista = await aCaminho(sb);
      if (lista.length) {
        const semana = lista.filter((x) => x.previsaoVencimento && dias(c.hoje, x.previsaoVencimento) <= 7);
        saida.push({
          chave: `almoxarifado.a_caminho:${lista.map((x) => x.cotacaoId).join(",")}`, nivel: "aviso",
          titulo: `${plural(lista.length, "OC a caminho", "OCs a caminho")} (${brl(lista.reduce((s, x) => s + Number(x.totalComprado ?? 0), 0))})`,
          detalhe: `${semana.length ? `${plural(semana.length, "tem pagamento previsto", "têm pagamento previsto")} em até 7 dias. ` : ""}Quando a nota chegar, dê entrada em A caminho.`,
          abrir: tela("A caminho"),
        });
      }
      const comCompras = await pedidosDeMaterial(sb, { status: ["aberta", "em_cotacao"] });
      if (comCompras.length) {
        const urg = comCompras.filter((p) => p.urgencia === "urgente").length;
        saida.push({
          chave: `almoxarifado.com_compras:${comCompras.map((p) => p.numero).join(",")}`, nivel: "aviso",
          titulo: `${plural(comCompras.length, "pedido de material", "pedidos de material")} com o Compras${urg ? ` (${urg} urgente${urg > 1 ? "s" : ""})` : ""}`,
          detalhe: comCompras.slice(0, 3).map((p) => `nº ${p.numero} desde ${dataBR(p.created_at)}`).join(" · "),
          abrir: tela("Solicitações"),
        });
      }
      return saida;
    },
  },
];

const MANUAL = `Você é a SARA do Almoxarifado do Business OS.
Seções:
- Painel: visão geral.
- Solicitações: pedidos de material (almoxarifado e fundição), com urgência e "precisa até"; seguem para o Compras cotar.
- A caminho: o que foi comprado e ainda não chegou; ali se dá entrada da nota (com o XML ou digitada). Confirmar o recebimento cria a conta a pagar no Financeiro e a linha do ICMS no Fiscal.
- Recebidos: notas já recebidas, com divergências.
- Compras diretas: compras sem cotação.
- Materiais: catálogo (9 mil itens vindos do GRV), com família, grupo, NCM e pendências do cadastro. O saldo do GRV não é confiável: o saldo de abertura virá da contagem física — não informe estoque.
Quem decide: Henrique (contagem, reposição, localização); o custo do estoque é da Ana.`;

export const almoxarifado: Agente = {
  sara: {
    modulo: M, nome: "SARA do Almoxarifado", rotulo: "Almoxarifado", feature: M, permissao: "almoxarifado.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["O que está a caminho?", "Quais pedidos de material estão com o Compras?", "Recebemos alguma nota com divergência?", "Qual o código do material para rebolo?"],
  },
  ferramentas, regras,
};
