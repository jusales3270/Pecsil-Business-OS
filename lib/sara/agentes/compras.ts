import type { SupabaseClient } from "@supabase/supabase-js";
import { brl, dataBR, dias, hoje, link, num, plural, reais, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";
import { FICHA_FORNECEDOR, HISTORICO_PRECO } from "../cerebro-ferramentas.ts";
import { foraDaCurva, sugerirFornecedores, type Comprado, type Cotado } from "../../compras/compra-assistida.ts";

/**
 * SARA do Compras: cotações (que viram OC quando aprovadas), aprovações, compras realizadas e diretas,
 * pedidos de material do almoxarifado/fundição e fornecedores. Quem aprova cotação é Domingo/Ricardo;
 * o cadastro de fornecedores é da equipe de Compras e do Rafael. Nada é gravado aqui.
 */

const M = "compras";
const COTAR = ["compras.cotacoes", "compras.aprovacoes"];
const tela = (secao: string, rotulo: string): Abrir => ({ modulo: M, secao, rotulo: `Compras › ${rotulo}` });
const fonte = (secao: string, rotulo: string) => ({ rotulo: `Compras › ${rotulo}`, link: link(M, secao) });

type Item = { valor_unit: number | null; quantidade: number | null; ipi: number | null; status: string | null };
type Cotacao = { id: number; fornecedor: string | null; divisao: string | null; status: string; created_at: string; updated_at: string | null; data_decisao: string | null; frete_valor: number | null; cotacao_produtos: Item[] };
const totalDa = (c: Cotacao) => reais((c.cotacao_produtos ?? []).filter((p) => p.status !== "REJEITADO")
  .reduce((s, p) => s + Number(p.valor_unit ?? 0) * Number(p.quantidade ?? 0) * (1 + Number(p.ipi ?? 0) / 100), 0) + Number(c.frete_valor ?? 0));

async function cotacoes(sb: SupabaseClient, status: "PENDENTE" | "APROVADO"): Promise<Cotacao[]> {
  const { data, error } = await sb.from("cotacoes").select("id, fornecedor, divisao, status, created_at, updated_at, data_decisao, frete_valor, cotacao_produtos(valor_unit, quantidade, ipi, status)")
    .eq("status", status).is("deleted_at", null).order("created_at").limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Cotacao[];
}
const desde = (c: Cotacao) => (c.data_decisao ?? c.updated_at ?? c.created_at).slice(0, 10);

type Pedido = { id: number; numero: number; divisao: string; origem: string; urgencia: string; status: string; precisa_ate: string | null; requested_by_name: string | null; created_at: string; updated_at: string | null; material_request_items: { produto: string; quantidade: number; unidade: string | null }[] };
async function pedidosParaCotar(sb: SupabaseClient): Promise<Pedido[]> {
  const { data, error } = await sb.from("material_requests").select("id, numero, divisao, origem, urgencia, status, precisa_ate, requested_by_name, created_at, updated_at, material_request_items(produto, quantidade, unidade)")
    .in("status", ["aberta", "em_cotacao", "rejeitada"]).order("created_at").limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Pedido[];
}

// --- Compra assistida (24/10): a quem pedir preço e o preço fora da curva --------------------------------
type Fornec = { name: string; trade_name: string | null; tax_id: string | null } | null;
const nomeDe = (s: Fornec, texto: string | null) => s?.trade_name?.trim() || s?.name || texto || "sem nome";

/** Compras dos últimos 2 anos e itens cotados, com o fornecedor do cadastro (o RLS do Compras vale). */
async function historico(sb: SupabaseClient): Promise<{ comprados: Comprado[]; cotados: Cotado[] }> {
  const de = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
  const [c, q] = await Promise.all([
    sb.from("compras").select("produto, valor_unit, unidade, data_compra, fornecedor, supplier_id, suppliers(name, trade_name, tax_id)").gte("data_compra", de).order("data_compra", { ascending: false }).limit(3000),
    sb.from("cotacao_produtos").select("produto, valor_unit, unidade, status, created_at, cotacoes!inner(fornecedor, supplier_id, deleted_at, suppliers(name, trade_name, tax_id))")
      .gte("created_at", de).is("cotacoes.deleted_at", null).order("created_at", { ascending: false }).limit(3000),
  ]);
  if (c.error) throw new Error(c.error.message);
  if (q.error) throw new Error(q.error.message);
  type LC = { produto: string; valor_unit: number; unidade: string | null; data_compra: string; fornecedor: string; supplier_id: string | null; suppliers: Fornec };
  type LQ = { produto: string; valor_unit: number | null; unidade: string | null; status: string | null; created_at: string; cotacoes: { fornecedor: string | null; supplier_id: string | null; suppliers: Fornec } };
  return {
    comprados: ((c.data ?? []) as unknown as LC[]).map((x) => ({ produto: x.produto, fornecedor: nomeDe(x.suppliers, x.fornecedor), fornecedor_id: x.supplier_id, cnpj: x.suppliers?.tax_id ?? null,
      preco: Number(x.valor_unit), unidade: x.unidade, data: x.data_compra })),
    cotados: ((q.data ?? []) as unknown as LQ[]).map((x) => ({ produto: x.produto, fornecedor: nomeDe(x.cotacoes.suppliers, x.cotacoes.fornecedor), fornecedor_id: x.cotacoes.supplier_id,
      cnpj: x.cotacoes.suppliers?.tax_id ?? null, preco: x.valor_unit == null ? null : Number(x.valor_unit), unidade: x.unidade, data: x.created_at.slice(0, 10), status: x.status ?? "" })),
  };
}

type ItemAberto = { produto: string; busca: string };
/** Itens do pedido que ainda não foram comprados; a busca usa a descrição do catálogo quando o item está ligado. */
async function itensAbertos(sb: SupabaseClient, numero: number): Promise<{ pedido: { id: string; numero: number }; itens: ItemAberto[] } | { erro: string }> {
  const { data: ped } = await sb.from("material_requests").select("id, numero, status").eq("numero", numero).maybeSingle();
  if (!ped) return { erro: `O pedido nº ${numero} não foi encontrado (ou você não tem acesso a ele).` };
  const [{ data: itens }, { data: estados }] = await Promise.all([
    sb.from("material_request_items").select("id, produto, materials(descricao)").eq("request_id", ped.id).order("ordem"),
    sb.rpc("compras_estado_itens", { p_pedido: ped.id }),
  ]);
  const comprado = new Set(((estados ?? []) as { item_id: string; estado: string }[]).filter((x) => x.estado === "comprado").map((x) => x.item_id));
  const lista = ((itens ?? []) as unknown as { id: string; produto: string; materials: { descricao: string } | null }[]).filter((i) => !comprado.has(i.id))
    .map((i) => ({ produto: i.produto, busca: i.materials?.descricao ?? i.produto.replace(/^[\w.]+\s+·\s+/, "") }));
  return { pedido: { id: ped.id, numero: ped.numero }, itens: lista };
}

const SUGERIR_FORNECEDORES: Ferramenta = {
  nome: "compras_sugerir_fornecedores", rotulo: "a quem pedir preço", exige: ["compras.cotacoes", "compras.aprovacoes"],
  descricao: "A QUEM PEDIR PREÇO: para um pedido de material (ou uma lista de itens), quem já vendeu ou cotou cada item, com o último preço pago, a unidade e a data, e os fornecedores que cobrem mais itens do pedido. Pelo histórico das compras e cotações (o mesmo item é achado pelo nome). É sugestão: quem escolhe é o Compras. Depois, convidar_fornecedor gera o link para ele cotar.",
  esquema: { type: "object", properties: {
    pedido: { type: "integer", description: "Número do pedido de material." },
    itens: { type: "array", items: { type: "string" }, description: "Ou a descrição dos itens, sem pedido." },
  } },
  rodar: async (sb, e) => {
    let itens: ItemAberto[], pedido: number | null = null;
    if (Number.isInteger(Number(e.pedido)) && Number(e.pedido) > 0) {
      const r = await itensAbertos(sb, Number(e.pedido));
      if ("erro" in r) return { dados: { erro: r.erro }, fontes: [] };
      itens = r.itens; pedido = r.pedido.numero;
    } else itens = (Array.isArray(e.itens) ? e.itens : []).map((x) => termo(x)).filter((x) => x.length >= 2).slice(0, 20).map((x) => ({ produto: x, busca: x }));
    if (!itens.length) return { dados: { erro: pedido ? `O pedido nº ${pedido} não tem item em aberto.` : "Diga o número do pedido ou os itens." }, fontes: [] };
    const h = await historico(sb);
    const buscas = itens.map((i) => i.busca);
    const sugestoes = sugerirFornecedores(buscas, h.comprados, h.cotados);
    const porItem = itens.map((i) => ({ item: i.produto,
      quem_vendeu: sugerirFornecedores([i.busca], h.comprados, []).slice(0, 3).map((x) => ({ fornecedor: x.fornecedor, compras: x.compras, ultimo_preco: x.precos[0]?.ultimo ?? null, unidade: x.precos[0]?.unidade ?? null, em: x.precos[0]?.em ?? null })),
      quem_cotou: sugerirFornecedores([i.busca], [], h.cotados).slice(0, 3).map((x) => ({ fornecedor: x.fornecedor, cotacoes: x.cotacoes, ultima: x.ultima })) }));
    return {
      dados: {
        pedido, itens_em_aberto: itens.length,
        fornecedores: sugestoes.map((x) => ({ fornecedor: x.fornecedor, cnpj: x.cnpj, cobre: `${x.itens.length} de ${itens.length}`, compras: x.compras, cotacoes: x.cotacoes, ultima: x.ultima })),
        por_item: porItem, sem_historico: porItem.filter((x) => !x.quem_vendeu.length && !x.quem_cotou.length).map((x) => x.item),
        aviso: "Sugestão pelo histórico (compras desde jul/2026 e cotações). Quem escolhe o fornecedor é o Compras.",
      },
      fontes: [fonte("compras", "Compras realizadas"), fonte("cotacoes", "Minhas cotações")],
    };
  },
};

const ferramentas: Ferramenta[] = [
  SUGERIR_FORNECEDORES,
  FICHA_FORNECEDOR, HISTORICO_PRECO,
  {
    nome: "compras_cotacoes_pendentes", rotulo: "cotações pendentes", exige: COTAR,
    descricao: "Cotações pendentes de aprovação: quantas, o total por divisão (Usinagem/Fundição), a mais antiga e as maiores, com fornecedor, data e valor (itens + IPI + frete).",
    esquema: { type: "object", properties: { limite: { type: "integer", description: "Quantas listar, das maiores (padrão 10, máximo 30)." }, fornecedor: { type: "string", description: "Parte do nome do fornecedor." } } },
    rodar: async (sb, e) => {
      let lista = await cotacoes(sb, "PENDENTE");
      const f = termo(e.fornecedor).toLowerCase();
      if (f) lista = lista.filter((c) => (c.fornecedor ?? "").toLowerCase().includes(f));
      const h = hoje();
      const linhas = lista.map((c) => ({ cotacao: c.id, fornecedor: c.fornecedor, divisao: c.divisao, desde: c.created_at.slice(0, 10), dias_esperando: dias(c.created_at, h), total: totalDa(c) }));
      const porDivisao = Object.entries(linhas.reduce<Record<string, { quantidade: number; total: number }>>((acc, l) => {
        const d = (acc[l.divisao ?? "SEM DIVISÃO"] ??= { quantidade: 0, total: 0 }); d.quantidade++; d.total = reais(d.total + l.total); return acc;
      }, {})).map(([divisao, v]) => ({ divisao, ...v }));
      return {
        dados: { quantidade: linhas.length, total: reais(linhas.reduce((s, l) => s + l.total, 0)), por_divisao: porDivisao, mais_antiga: linhas[0] ?? null,
          mais_de_7_dias: linhas.filter((l) => l.dias_esperando > 7).length, maiores: [...linhas].sort((a, b) => b.total - a.total).slice(0, num(e.limite, 10, 1, 30)) },
        fontes: [fonte("pendentes", "Pendentes de aprovação")],
      };
    },
  },
  {
    nome: "compras_aprovadas_sem_compra", rotulo: "OCs aprovadas sem compra", exige: COTAR,
    descricao: "Cotações aprovadas (já são OC) que ainda não viraram compra: fornecedor, quando foi aprovada, há quantos dias e o valor.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const h = hoje();
      const lista = (await cotacoes(sb, "APROVADO")).map((c) => ({ oc: c.id, fornecedor: c.fornecedor, divisao: c.divisao, aprovada_em: desde(c), dias: dias(desde(c), h), total: totalDa(c) }));
      return { dados: { quantidade: lista.length, total: reais(lista.reduce((s, l) => s + l.total, 0)), ordens: lista.slice(0, 30) }, fontes: [fonte("cotacoes", "Minhas cotações")] };
    },
  },
  {
    nome: "compras_realizadas", rotulo: "compras realizadas", exige: ["compras.realizadas"],
    descricao: "Compras realizadas num período (padrão: últimos 30 dias): total, quantidade de linhas, os fornecedores que mais compraram e as maiores linhas. Filtra por fornecedor ou produto.",
    esquema: { type: "object", properties: { dias: { type: "integer", description: "Janela em dias (padrão 30, máximo 365)." }, fornecedor: { type: "string" }, produto: { type: "string" } } },
    rodar: async (sb, e) => {
      const de = new Date(Date.now() - num(e.dias, 30, 1, 365) * 86_400_000).toISOString().slice(0, 10);
      let q = sb.from("compras").select("fornecedor, produto, quantidade, unidade, valor_unit, total, data_compra").gte("data_compra", de).order("data_compra", { ascending: false }).limit(1000);
      if (termo(e.fornecedor)) q = q.ilike("fornecedor", `%${termo(e.fornecedor)}%`);
      if (termo(e.produto)) q = q.ilike("produto", `%${termo(e.produto)}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const linhas = (data ?? []) as { fornecedor: string; produto: string; quantidade: number; unidade: string | null; valor_unit: number; total: number | null; data_compra: string }[];
      const valor = (l: (typeof linhas)[number]) => Number(l.total ?? Number(l.valor_unit) * Number(l.quantidade));
      const porFornecedor = Object.entries(linhas.reduce<Record<string, number>>((acc, l) => { acc[l.fornecedor] = reais((acc[l.fornecedor] ?? 0) + valor(l)); return acc; }, {}))
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([fornecedor, total]) => ({ fornecedor, total }));
      return {
        dados: { desde: de, linhas: linhas.length, total: reais(linhas.reduce((s, l) => s + valor(l), 0)), ultima_compra: linhas[0]?.data_compra ?? null, fornecedores: porFornecedor,
          maiores: [...linhas].sort((a, b) => valor(b) - valor(a)).slice(0, 10).map((l) => ({ ...l, total: reais(valor(l)) })) },
        fontes: [fonte("compras", "Compras realizadas")],
      };
    },
  },
  {
    nome: "compras_pedidos_para_cotar", rotulo: "pedidos para cotar", exige: ["compras.cotacoes"],
    descricao: "Pedidos de material (do almoxarifado e da fundição) esperando cotação: número, divisão, urgência, precisa até, há quantos dias e os itens.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const h = hoje();
      const lista = (await pedidosParaCotar(sb)).map((p) => ({ pedido: p.numero, divisao: p.divisao, origem: p.origem, urgente: p.urgencia === "urgente", situacao: p.status,
        precisa_ate: p.precisa_ate, dias: dias(p.created_at, h), solicitante: p.requested_by_name, itens: (p.material_request_items ?? []).slice(0, 8).map((i) => `${i.quantidade} ${i.unidade ?? ""} ${i.produto}`.trim()) }));
      return { dados: { quantidade: lista.length, urgentes: lista.filter((l) => l.urgente).length, pedidos: lista.slice(0, 30) }, fontes: [fonte("solicitacoes", "Pedidos almoxarifado")] };
    },
  },
  {
    nome: "compras_fornecedores", rotulo: "fornecedores", exige: ["compras.fornecedores", "compras.cotacoes"],
    descricao: "Busca fornecedores pelo nome ou CNPJ (ativos): razão social, nome fantasia, CNPJ/CPF, IE, contato, telefone, e-mail, endereço, CEP, cidade/UF, condição de pagamento e divisões. Também diz quantos estão sem CNPJ.",
    esquema: { type: "object", properties: { busca: { type: "string", description: "Parte do nome ou do CNPJ (opcional)." } } },
    rodar: async (sb, e) => {
      const b = termo(e.busca);
      let q = sb.from("suppliers").select("name, legal_name, trade_name, tax_id, state_registration, contact_name, phone, email, address, postal_code, city, state, payment_terms, divisions").eq("active", true).is("merged_into", null).order("name").limit(15);
      // Pelo CNPJ só quando o termo é número (com ou sem pontuação): "A5FBF9" virava "59" e casava com tudo.
      const digitos = /^[\d.\-/\s]+$/.test(b) ? b.replace(/\D/g, "") : "";
      if (b) q = q.or(`name.ilike.%${b}%,legal_name.ilike.%${b}%,trade_name.ilike.%${b}%${digitos.length >= 4 ? `,tax_id.ilike.%${digitos}%` : ""}`);
      const [{ data, error }, semCnpj] = await Promise.all([q,
        sb.from("suppliers").select("id", { count: "exact", head: true }).eq("active", true).is("merged_into", null).or("tax_id.is.null,tax_id.eq.")]);
      if (error) throw new Error(error.message);
      const lista = data ?? [];
      return { dados: { encontrados: lista, ativos_sem_cnpj: semCnpj.count ?? null }, fontes: [fonte("fornecedores", "Fornecedores")] };
    },
  },
];

const telas: Tela[] = [
  { id: "compras_dashboard", modulo: M, secao: "dashboard", rotulo: "Compras › Dashboard", exige: ["compras.cotacoes", "compras.aprovacoes", "compras.realizadas"], serve: "visão geral do Compras" },
  { id: "compras_pedidos", modulo: M, secao: "solicitacoes", rotulo: "Compras › Pedidos almoxarifado", exige: ["compras.cotacoes"], serve: "pedidos de material para cotar e convidar fornecedor" },
  { id: "compras_cotacoes", modulo: M, secao: "cotacoes", rotulo: "Compras › Minhas cotações", exige: ["compras.cotacoes"], serve: "lançar e acompanhar cotações e OCs" },
  { id: "compras_pendentes", modulo: M, secao: "pendentes", rotulo: "Compras › Pendentes de aprovação", exige: ["compras.aprovacoes"], serve: "aprovar ou rejeitar cotações" },
  { id: "compras_historico", modulo: M, secao: "historico", rotulo: "Compras › Histórico de decisões", exige: ["compras.aprovacoes"], serve: "decisões já tomadas" },
  { id: "compras_realizadas", modulo: M, secao: "compras", rotulo: "Compras › Compras realizadas", exige: ["compras.realizadas"], serve: "compras efetivadas" },
  { id: "compras_diretas", modulo: M, secao: "diretas", rotulo: "Compras › Compras diretas", exige: ["compras.cotacoes", "compras.aprovacoes", "compras.realizadas"], serve: "compras sem cotação" },
  { id: "compras_fornecedores", modulo: M, secao: "fornecedores", rotulo: "Compras › Fornecedores", exige: ["compras.fornecedores", "fundacao.cadastros"], serve: "cadastro e histórico de fornecedores" },
];

const regras: Agente["regras"] = [
  {
    exige: ["compras.aprovacoes"],
    gerar: async (sb, c) => {
      const lista = await cotacoes(sb, "PENDENTE");
      const paradas = lista.filter((x) => dias(x.updated_at ?? x.created_at, c.hoje) > 2);
      if (!paradas.length) return [];
      const total = paradas.reduce((s, x) => s + totalDa(x), 0);
      return [{
        chave: `compras.pendentes:${paradas.length}:${Math.max(...paradas.map((x) => x.id))}`, nivel: "urgente",
        titulo: `${plural(paradas.length, "cotação esperando", "cotações esperando")} aprovação há mais de 2 dias`,
        detalhe: `Somam ${brl(total)}; a mais antiga é de ${dataBR(paradas[0].created_at)}. Aprove ou rejeite para o pedido andar.`,
        abrir: tela("pendentes", "Pendentes de aprovação"),
      }];
    },
  },
  {
    exige: ["compras.cotacoes"],
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const aprovadas = (await cotacoes(sb, "APROVADO")).filter((x) => dias(desde(x), c.hoje) > 2);
      if (aprovadas.length) saida.push({
        chave: `compras.aprovadas:${aprovadas.map((x) => x.id).join(",")}`, nivel: "urgente",
        titulo: `${plural(aprovadas.length, "OC aprovada", "OCs aprovadas")} sem compra há mais de 2 dias`,
        detalhe: `${aprovadas.slice(0, 3).map((x) => `OC ${x.id} (${x.fornecedor ?? "sem fornecedor"})`).join(" · ")}${aprovadas.length > 3 ? ` e mais ${aprovadas.length - 3}` : ""}. Registre a compra ou cancele.`,
        abrir: tela("cotacoes", "Minhas cotações"),
      });
      const pedidos = await pedidosParaCotar(sb);
      const parados = pedidos.filter((p) => p.status !== "rejeitada" && dias(p.updated_at ?? p.created_at, c.hoje) > 2);
      if (parados.length) saida.push({
        chave: `compras.pedidos_parados:${parados.map((p) => p.numero).join(",")}`, nivel: "urgente",
        titulo: `${plural(parados.length, "pedido de material", "pedidos de material")} esperando cotação há mais de 2 dias`,
        detalhe: parados.slice(0, 3).map((p) => `nº ${p.numero} (${p.divisao}${p.urgencia === "urgente" ? ", urgente" : ""})`).join(" · "),
        abrir: tela("solicitacoes", "Pedidos almoxarifado"),
      });
      const novos = pedidos.filter((p) => p.status !== "rejeitada" && dias(p.updated_at ?? p.created_at, c.hoje) <= 2);
      if (novos.length) saida.push({
        chave: `compras.pedidos_novos:${novos.map((p) => p.numero).join(",")}`, nivel: "aviso",
        titulo: `${plural(novos.length, "pedido de material novo", "pedidos de material novos")} para cotar`,
        detalhe: novos.slice(0, 3).map((p) => `nº ${p.numero} (${p.divisao}${p.urgencia === "urgente" ? ", urgente" : ""})`).join(" · "),
        abrir: tela("solicitacoes", "Pedidos almoxarifado"),
      });
      const { data: convites } = await sb.from("compras_convites").select("id, fornecedor, expira_em").eq("situacao", "aberto").limit(200);
      const vencendo = ((convites ?? []) as { id: string; fornecedor: string; expira_em: string }[]).filter((x) => dias(c.hoje, x.expira_em) <= 2);
      if (vencendo.length) saida.push({
        chave: `compras.convites:${vencendo.map((x) => x.id).join(",")}`, nivel: "aviso",
        titulo: `${plural(vencendo.length, "convite a fornecedor vence", "convites a fornecedor vencem")} em até 2 dias`,
        detalhe: vencendo.slice(0, 3).map((x) => `${x.fornecedor} (${dataBR(x.expira_em)})`).join(" · "),
        abrir: tela("solicitacoes", "Pedidos almoxarifado"),
      });
      return saida;
    },
  },
  {
    // Preço fora da curva: item de cotação pendente acima da mediana das últimas compras do mesmo item.
    exige: COTAR,
    gerar: async (sb, c) => {
      const { data, error } = await sb.from("cotacoes").select("id, fornecedor, cotacao_produtos(produto, valor_unit, unidade, status)")
        .eq("status", "PENDENTE").is("deleted_at", null).order("id").limit(300);
      if (error) throw new Error(error.message);
      const pendentes = (data ?? []) as unknown as { id: number; fornecedor: string | null; cotacao_produtos: { produto: string; valor_unit: number | null; unidade: string | null; status: string | null }[] }[];
      if (!pendentes.length) return [];
      const { comprados } = await historico(sb);
      const achados = pendentes.flatMap((q) => (q.cotacao_produtos ?? []).filter((p) => p.status !== "REJEITADO").map((p) => {
        const f = foraDaCurva(p.produto, Number(p.valor_unit), p.unidade, comprados);
        return f ? { cotacao: q.id, fornecedor: q.fornecedor, produto: p.produto, preco: Number(p.valor_unit), ...f } : null;
      }).filter((x) => x !== null)).sort((a, b) => b.acima - a.acima);
      if (!achados.length) return [];
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      return [{
        chave: `compras.fora_da_curva:${achados.map((a) => `${a.cotacao}-${Math.round(a.acima * 100)}`).join(",")}`, nivel: "aviso",
        titulo: `${plural(achados.length, "item cotado", "itens cotados")} acima do que a empresa costuma pagar`,
        detalhe: achados.slice(0, 3).map((a) => `Cotação nº ${a.cotacao} (${a.fornecedor ?? "sem fornecedor"}): ${a.produto.slice(0, 60)} a ${brl(a.preco)}/${a.unidade}, ${pct(a.acima)} acima da mediana de ${brl(a.referencia)} (${plural(a.compras, "compra", "compras")})`).join(" · ")
          + `${achados.length > 3 ? ` e mais ${achados.length - 3}` : ""}. Vale negociar ou cotar com outro fornecedor.`,
        abrir: c.pode("compras.aprovacoes") ? tela("pendentes", "Pendentes de aprovação") : tela("cotacoes", "Minhas cotações"),
      }];
    },
  },
  {
    // Pedido novo: a SARA já sugere a quem pedir preço e deixa o convite pronto para o Permitir.
    exige: ["compras.cotacoes"],
    gerar: async (sb) => {
      const { data } = await sb.from("material_requests").select("numero").eq("status", "aberta").order("created_at", { ascending: false }).limit(5);
      const numeros = ((data ?? []) as { numero: number }[]).map((p) => p.numero);
      if (!numeros.length) return [];
      const h = await historico(sb);
      const saida: Alerta[] = [];
      for (const n of numeros) {
        const r = await itensAbertos(sb, n);
        if ("erro" in r || !r.itens.length) continue;
        const [melhor] = sugerirFornecedores(r.itens.map((i) => i.busca), h.comprados, h.cotados, 1);
        if (!melhor?.compras) continue; // só quem já vendeu algum item; quem só cotou fica na consulta
        const cobertos = r.itens.filter((i) => melhor.itens.includes(i.busca));
        saida.push({
          chave: `compras.sugestao:${n}:${melhor.fornecedor_id ?? melhor.fornecedor}:${cobertos.length}`, nivel: "aviso",
          titulo: `Pedido nº ${n}: ${melhor.fornecedor} já vendeu ${cobertos.length === r.itens.length ? (r.itens.length === 1 ? "o item" : `os ${r.itens.length} itens`) : `${cobertos.length} de ${r.itens.length} itens`}`,
          detalhe: `${melhor.precos.slice(0, 2).map((p) => `${p.item.slice(0, 50)}: ${brl(p.ultimo)}/${p.unidade} em ${dataBR(p.em)}`).join(" · ")}. Sugestão pelo histórico; quem escolhe é você. Pergunte à SARA "a quem pedir preço do pedido ${n}?" para ver os outros.`,
          abrir: tela("solicitacoes", "Pedidos almoxarifado"),
          propor: { ferramenta: "convidar_fornecedor", entrada: { pedido: n, fornecedor: melhor.cnpj && melhor.cnpj.replace(/\D/g, "").length === 14 ? melhor.cnpj : melhor.fornecedor, itens: cobertos.map((i) => i.produto) },
            rotulo: `Convidar ${melhor.fornecedor} a cotar` },
        });
      }
      return saida;
    },
  },
  {
    exige: ["compras.fornecedores"],
    gerar: async (sb) => {
      const { count } = await sb.from("supplier_cnpj_suggestions").select("id", { count: "exact", head: true }).eq("status", "pendente");
      return count ? [{
        chave: `compras.cnpj_sugestoes:${count}`, nivel: "aviso",
        titulo: `${plural(count, "sugestão de CNPJ", "sugestões de CNPJ")} de fornecedor para conferir`,
        detalhe: "Vindas das notas recebidas. Quem decide o cadastro é a equipe de Compras com o Rafael.",
        abrir: tela("fornecedores", "Fornecedores"),
      }] : [];
    },
  },
];

const MANUAL = `Você é a SARA do Compras do Business OS.
Seções (aparecem conforme a permissão e a visão — Orçamentista cota, Gestor aprova):
- Dashboard: visão geral.
- Pedidos almoxarifado: pedidos de material do almoxarifado e da fundição para cotar; dá para convidar fornecedor por link (ele responde sem login e vira cotação ligada ao pedido).
- Minhas cotações: lançar cotações (fornecedor, itens, IPI, frete, prazo, condição de pagamento) e acompanhar. Aprovada, a cotação vira OC com o mesmo número ("OC nº").
- Pendentes de aprovação e Histórico de decisões (visão Gestor): aprovar ou rejeitar, com alçadas.
- Compras realizadas e Compras diretas (compra sem cotação).
- Fornecedores: cadastro, histórico e unificação de duplicados.
Fluxo: pedido de material → cotação → aprovação (OC) → compra → a nota é recebida no Almoxarifado, que cria a conta a pagar no Financeiro.
Ficha do fornecedor (ficha_fornecedor) e histórico de preço (historico_de_preco) vêm do Segundo Cérebro: o que cada fornecedor vende, a que preço e desde quando, juntando os nomes do mesmo item.
Compra assistida: para "a quem pedir preço?", use compras_sugerir_fornecedores (histórico de compras e cotações por item); depois, com o OK da pessoa, prepare convidar_fornecedor (o link aparece uma vez no cartão, para ela mandar ao fornecedor). Quando a cotação chegar, compare pelo comparativo e diga o que recomendaria como OPINIÃO sua, com o motivo; aprovar é do Domingo e do Ricardo, na tela de Pendentes. Preço acima do que a empresa costuma pagar aparece nos avisos.
Quem decide: aprovar cotação é do Domingo e do Ricardo; o cadastro de fornecedores é da equipe de Compras com o Rafael.`;

export const compras: Agente = {
  sara: {
    modulo: M, nome: "SARA do Compras", rotulo: "Compras", feature: M, permissao: "compras.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["A quem pedir preço do pedido mais novo?", "Quantas cotações estão esperando aprovação?", "Quais OCs aprovadas ainda não viraram compra?", "Quem vende a resina mais barato?", "Tem pedido de material para cotar?"],
  },
  ferramentas, regras,
};
