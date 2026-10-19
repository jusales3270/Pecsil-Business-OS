import type { SupabaseClient } from "@supabase/supabase-js";
import { brl, dataBR, dias, hoje, link, plural, reais, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";
import { FICHA_CLIENTE } from "../cerebro-ferramentas.ts";

/**
 * SARA do Comercial (CRM e Vendas): orçamentos (sem os de TREINO), funil, clientes, produtos e a
 * conexão de e-mail. Nunca mostra o corpo dos e-mails nem CPF de pessoa física. Quem decide é o
 * Rafael (comercial, orçamento e PCP); o faturamento é do Jefferson.
 */

const M = "comercial";
const tela = (secao: string, rotulo: string): Abrir => ({ modulo: M, secao, rotulo: `Comercial › ${rotulo}` });
const fonte = (secao: string, rotulo: string) => ({ rotulo: `Comercial › ${rotulo}`, link: link(M, secao) });
const semCpf = (doc: string | null) => ((doc ?? "").replace(/\D/g, "").length === 11 ? "(pessoa física)" : doc);
const SITUACAO: Record<string, string> = { rascunho: "rascunho", enviado: "enviado ao cliente", ganho: "ganho", perdido: "perdido", cancelado: "cancelado" };

type Orcamento = { numero: number; situacao: string; data_orcamento: string | null; validade: string | null; pedido_cliente: string | null; updated_at: string; ganho_em: string | null; motivo_perda: string | null;
  customers: { name: string } | null; sales_quote_items: { quantidade: number; preco_unitario: number }[] };
async function orcamentos(sb: SupabaseClient, situacoes: string[], diasAtras?: number): Promise<Orcamento[]> {
  let q = sb.from("sales_quotes").select("numero, situacao, data_orcamento, validade, pedido_cliente, updated_at, ganho_em, motivo_perda, customers(name), sales_quote_items(quantidade, preco_unitario)")
    .eq("treino", false).in("situacao", situacoes).order("updated_at", { ascending: false }).limit(500);
  if (diasAtras) q = q.gte("updated_at", new Date(Date.now() - diasAtras * 86_400_000).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Orcamento[];
}
const totalDo = (o: Orcamento) => reais((o.sales_quote_items ?? []).reduce((s, i) => s + Number(i.quantidade ?? 0) * Number(i.preco_unitario ?? 0), 0));

/** O que foi ganho e ainda tem saldo a faturar (mesma consulta da tela "A faturar" do Fiscal). */
export async function aFaturar(sb: SupabaseClient) {
  const { data, error } = await sb.rpc("fiscal_a_faturar", { p_ambiente: "producao" });
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as { numero: number; cliente: string; pedido_cliente: string | null; codigo: string | null; descricao: string; unidade: string | null; preco_unitario: number; disponivel: number; falta: number }[];
  const porOrcamento = Object.values(linhas.reduce<Record<string, { orcamento: number; cliente: string; pedido_cliente: string | null; itens: number; disponivel_para_faturar: number }>>((acc, l) => {
    const o = (acc[l.numero] ??= { orcamento: l.numero, cliente: l.cliente, pedido_cliente: l.pedido_cliente, itens: 0, disponivel_para_faturar: 0 });
    o.itens++; o.disponivel_para_faturar = reais(o.disponivel_para_faturar + Number(l.disponivel ?? 0) * Number(l.preco_unitario ?? 0)); return acc;
  }, {}));
  return { linhas: linhas.length, orcamentos: porOrcamento };
}

const ferramentas: Ferramenta[] = [
  FICHA_CLIENTE,
  {
    nome: "comercial_orcamentos", rotulo: "orçamentos", exige: ["comercial.orcamentos"],
    descricao: "Orçamentos de venda (sem os de treino) por situação: em aberto (rascunho e enviados), ganhos, perdidos (com o motivo) ou todos dos últimos 90 dias. Número, cliente, data, validade, pedido do cliente e total.",
    esquema: { type: "object", properties: { situacao: { type: "string", enum: ["em_aberto", "ganhos", "perdidos", "todos"] }, cliente: { type: "string" } } },
    rodar: async (sb, e) => {
      const mapa: Record<string, string[]> = { em_aberto: ["rascunho", "enviado"], ganhos: ["ganho"], perdidos: ["perdido", "cancelado"], todos: ["rascunho", "enviado", "ganho", "perdido", "cancelado"] };
      const chave = String(e.situacao ?? "em_aberto");
      let lista = await orcamentos(sb, mapa[chave] ?? mapa.em_aberto, chave === "em_aberto" ? undefined : 90);
      const c = termo(e.cliente).toLowerCase();
      if (c) lista = lista.filter((o) => (o.customers?.name ?? "").toLowerCase().includes(c));
      const h = hoje();
      const linhas = lista.map((o) => ({ orcamento: o.numero, cliente: o.customers?.name ?? null, situacao: SITUACAO[o.situacao] ?? o.situacao, data: o.data_orcamento, validade: o.validade,
        vencido: Boolean(o.validade && o.validade < h && ["rascunho", "enviado"].includes(o.situacao)), sem_mexer_ha_dias: dias(o.updated_at, h), pedido_cliente: o.pedido_cliente,
        motivo_perda: o.motivo_perda, total: totalDo(o) }));
      return { dados: { situacao: chave, quantidade: linhas.length, total: reais(linhas.reduce((s, l) => s + l.total, 0)), orcamentos: linhas.slice(0, 25) }, fontes: [fonte("orcamentos", "Orçamentos")] };
    },
  },
  {
    nome: "comercial_a_faturar", rotulo: "a faturar", exige: ["comercial.orcamentos", "fiscal.nfe"],
    descricao: "Orçamentos ganhos com saldo a faturar (o que a produção já entregou e ainda não virou nota): orçamento, cliente, pedido do cliente, itens e valor disponível para faturar.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => ({ dados: await aFaturar(sb), fontes: [{ rotulo: "Fiscal › A faturar", link: link("fiscal", "A faturar") }] }),
  },
  {
    nome: "comercial_funil", rotulo: "funil", exige: ["comercial.funil"],
    descricao: "Cards abertos do funil por etapa (triagem, análise, proposta, aguardando…): título, tipo, valor, prazo, há quantos dias sem mexer, e os vencidos.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const { data, error } = await sb.from("crm_cards").select("title, kind, value_cents, due_date, updated_at, crm_stages(label, position), customers(name)").eq("status", "aberto").order("updated_at").limit(500);
      if (error) throw new Error(error.message);
      const h = hoje();
      const cards = ((data ?? []) as unknown as { title: string; kind: string; value_cents: number | null; due_date: string | null; updated_at: string; crm_stages: { label: string } | null; customers: { name: string } | null }[])
        .map((x) => ({ titulo: x.title, tipo: x.kind, etapa: x.crm_stages?.label ?? null, cliente: x.customers?.name ?? null, valor: x.value_cents != null ? reais(x.value_cents / 100) : null,
          prazo: x.due_date, vencido: Boolean(x.due_date && x.due_date < h), sem_mexer_ha_dias: dias(x.updated_at, h) }));
      const porEtapa = Object.entries(cards.reduce<Record<string, number>>((a, x) => { a[x.etapa ?? "?"] = (a[x.etapa ?? "?"] ?? 0) + 1; return a; }, {})).map(([etapa, quantidade]) => ({ etapa, quantidade }));
      return { dados: { abertos: cards.length, vencidos: cards.filter((x) => x.vencido).length, por_etapa: porEtapa, cards: cards.slice(0, 25) }, fontes: [fonte("funil", "Funil")] };
    },
  },
  {
    nome: "comercial_clientes", rotulo: "clientes", exige: ["comercial.clientes", "comercial.orcamentos"],
    descricao: "Busca clientes pelo nome ou CNPJ: nome, CNPJ, município/UF e se os dados fiscais estão completos para a NF-e (IE, e-mail da nota, endereço). Também diz quantos estão sem CNPJ.",
    esquema: { type: "object", properties: { busca: { type: "string" } } },
    rodar: async (sb, e) => {
      const b = termo(e.busca);
      let q = sb.from("customers").select("name, tax_id, ie, email_nfe, municipio, uf, cep, logradouro").eq("active", true).is("merged_into", null).order("name").limit(15);
      if (b) q = q.or(`name.ilike.%${b}%,tax_id.ilike.%${b.replace(/\D/g, "") || b}%`);
      const [{ data, error }, sem] = await Promise.all([q, sb.from("customers").select("id", { count: "exact", head: true }).eq("active", true).is("merged_into", null).or("tax_id.is.null,tax_id.eq.")]);
      if (error) throw new Error(error.message);
      const lista = ((data ?? []) as { name: string; tax_id: string | null; ie: string | null; email_nfe: string | null; municipio: string | null; uf: string | null; cep: string | null; logradouro: string | null }[])
        .map((x) => ({ cliente: x.name, cnpj: semCpf(x.tax_id), municipio: x.municipio, uf: x.uf, pronto_para_nfe: Boolean(x.tax_id && x.cep && x.logradouro && x.municipio),
          falta: [!x.tax_id && "CNPJ", !x.ie && "IE", !x.email_nfe && "e-mail da nota", !(x.cep && x.logradouro) && "endereço"].filter(Boolean) }));
      return { dados: { encontrados: lista, ativos_sem_cnpj: sem.count ?? null }, fontes: [fonte("clientes", "Clientes")] };
    },
  },
  {
    nome: "comercial_produtos", rotulo: "produtos", exige: ["comercial.produtos", "comercial.orcamentos"],
    descricao: "Busca produtos pelo código ou descrição (código interno, tipo de peça, NCM, material, desenho e cliente) e diz quantos produtos ativos estão sem NCM.",
    esquema: { type: "object", properties: { busca: { type: "string" } } },
    rodar: async (sb, e) => {
      const b = termo(e.busca);
      let q = sb.from("products").select("codigo, descricao, tipo_peca, ncm, material, desenho_codigo, desenho_revisao, customers(name)").eq("ativo", true).order("codigo").limit(15);
      if (b) q = q.or(`codigo.ilike.%${b}%,descricao.ilike.%${b}%`);
      const [{ data, error }, semNcm] = await Promise.all([q, sb.from("products").select("id", { count: "exact", head: true }).eq("ativo", true).is("ncm", null)]);
      if (error) throw new Error(error.message);
      return { dados: { encontrados: data ?? [], ativos_sem_ncm: semNcm.count ?? null }, fontes: [fonte("produtos", "Produtos")] };
    },
  },
  {
    nome: "comercial_conexao_email", rotulo: "conexão de e-mail", exige: ["comercial.conexao"],
    descricao: "Situação das caixas de e-mail ligadas ao Comercial: endereço, ativa, última leitura e o último erro. E quantos e-mails de saída falharam.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const [{ data, error }, erros] = await Promise.all([
        sb.from("mail_accounts").select("address, label, active, last_sync_at, last_error, last_error_at").order("address"),
        sb.from("mail_outbox").select("id", { count: "exact", head: true }).eq("status", "erro"),
      ]);
      if (error) throw new Error(error.message);
      return { dados: { caixas: data ?? [], envios_com_erro: erros.count ?? null }, fontes: [fonte("conexao", "Conexão de e-mail")] };
    },
  },
];

const telas: Tela[] = [
  { id: "comercial_funil", modulo: M, secao: "funil", rotulo: "Comercial › Funil", exige: ["comercial.funil"], serve: "cards de pedido e atendimento por etapa" },
  { id: "comercial_clientes", modulo: M, secao: "clientes", rotulo: "Comercial › Clientes", exige: ["comercial.clientes"], serve: "cadastro de clientes" },
  { id: "comercial_conexao", modulo: M, secao: "conexao", rotulo: "Comercial › Conexão de e-mail", exige: ["comercial.conexao"], serve: "leitura das caixas de e-mail" },
  { id: "comercial_orcamentos", modulo: M, secao: "orcamentos", rotulo: "Comercial › Orçamentos", exige: ["comercial.orcamentos"], serve: "montar, enviar e acompanhar orçamentos" },
  { id: "comercial_produtos", modulo: M, secao: "produtos", rotulo: "Comercial › Produtos", exige: ["comercial.produtos"], serve: "cadastro de produtos (código, NCM, desenho)" },
  { id: "fiscal_a_faturar", modulo: "fiscal", secao: "A faturar", rotulo: "Fiscal › A faturar", exige: ["fiscal.nfe"], serve: "o que já pode virar nota" },
];

const regras: Agente["regras"] = [
  {
    exige: ["comercial.conexao"],
    gerar: async (sb) => {
      const saida: Alerta[] = [];
      const { data } = await sb.from("mail_accounts").select("address, last_error, last_error_at").eq("active", true).not("last_error", "is", null);
      for (const x of (data ?? []) as { address: string; last_error: string; last_error_at: string | null }[]) saida.push({
        chave: `comercial.email_erro:${x.address}:${x.last_error_at ?? ""}`, nivel: "urgente", titulo: `A caixa ${x.address} não está sendo lida`,
        detalhe: `Último erro${x.last_error_at ? ` em ${dataBR(x.last_error_at)}` : ""}. Os pedidos que chegam por e-mail podem não aparecer no funil.`, abrir: tela("conexao", "Conexão de e-mail"),
      });
      const { count } = await sb.from("mail_outbox").select("id", { count: "exact", head: true }).eq("status", "erro");
      if (count) saida.push({ chave: `comercial.envio_erro:${count}`, nivel: "urgente", titulo: `${plural(count, "e-mail não foi enviado", "e-mails não foram enviados")}`, detalhe: "Confira a conexão de e-mail.", abrir: tela("conexao", "Conexão de e-mail") });
      return saida;
    },
  },
  {
    exige: ["comercial.orcamentos"],
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const abertos = await orcamentos(sb, ["rascunho", "enviado"]);
      const semResposta = abertos.filter((o) => o.situacao === "enviado" && dias(o.updated_at, c.hoje) >= 7);
      if (semResposta.length) saida.push({
        chave: `comercial.sem_resposta:${semResposta.map((o) => o.numero).join(",")}`, nivel: "aviso",
        titulo: `${plural(semResposta.length, "orçamento enviado", "orçamentos enviados")} sem resposta há 7 dias ou mais`,
        detalhe: semResposta.slice(0, 3).map((o) => `nº ${o.numero} (${o.customers?.name ?? "cliente"})`).join(" · ") + ". Vale um contato com o cliente.", abrir: tela("orcamentos", "Orçamentos"),
      });
      const vencidos = abertos.filter((o) => o.validade && o.validade < c.hoje);
      if (vencidos.length) saida.push({
        chave: `comercial.validade:${vencidos.map((o) => o.numero).join(",")}`, nivel: "aviso",
        titulo: `${plural(vencidos.length, "orçamento em aberto passou", "orçamentos em aberto passaram")} da validade`,
        detalhe: vencidos.slice(0, 3).map((o) => `nº ${o.numero} (até ${dataBR(o.validade!)})`).join(" · "), abrir: tela("orcamentos", "Orçamentos"),
      });
      const fat = await aFaturar(sb).catch(() => null);
      if (fat?.orcamentos.length) saida.push({
        chave: `comercial.a_faturar:${fat.orcamentos.map((o) => o.orcamento).join(",")}`, nivel: "urgente",
        titulo: `${plural(fat.orcamentos.length, "orçamento ganho tem", "orçamentos ganhos têm")} saldo para faturar`,
        detalhe: `${brl(fat.orcamentos.reduce((s, o) => s + o.disponivel_para_faturar, 0))} já produzidos e sem nota. O faturamento é com o Jefferson.`,
        abrir: { modulo: "fiscal", secao: "A faturar", rotulo: "Fiscal › A faturar" },
      });
      return saida;
    },
  },
  {
    exige: ["comercial.funil"],
    gerar: async (sb, c) => {
      const { data } = await sb.from("crm_cards").select("title, due_date").eq("status", "aberto").lt("due_date", c.hoje).limit(200);
      const lista = (data ?? []) as { title: string; due_date: string }[];
      return lista.length ? [{ chave: `comercial.funil_vencido:${lista.length}`, nivel: "aviso", titulo: `${plural(lista.length, "card do funil passou", "cards do funil passaram")} do prazo`,
        detalhe: lista.slice(0, 3).map((x) => x.title).join(" · "), abrir: tela("funil", "Funil") }] : [];
    },
  },
  {
    exige: ["comercial.produtos"],
    gerar: async (sb) => {
      const { count } = await sb.from("products").select("id", { count: "exact", head: true }).eq("ativo", true).is("ncm", null);
      return count ? [{ chave: `comercial.sem_ncm:${count}`, nivel: "aviso", titulo: `${plural(count, "produto ativo", "produtos ativos")} sem NCM`,
        detalhe: "Sem NCM o produto não entra numa nota fiscal. Complete o cadastro antes de faturar.", abrir: tela("produtos", "Produtos") }] : [];
    },
  },
];

const MANUAL = `Você é a SARA do Comercial do Business OS (CRM e Vendas).
Seções:
- CRM › Funil: cards de pedido e atendimento por etapa (triagem, análise, proposta, aguardando, ganho, perdido).
- CRM › Clientes: cadastro (CNPJ, IE, e-mail da nota, endereço — o que a NF-e precisa).
- CRM › Conexão de e-mail: a leitura das caixas de e-mail que alimentam o funil.
- Vendas › Orçamentos: montar o orçamento (itens do catálogo, máscara de impostos, condição de pagamento, prazo), ler o pedido do cliente (PDF) direto para o orçamento, enviar, marcar ganho ou perdido. Orçamentos de TREINO (T-n) não contam.
- Vendas › Produtos: cadastro (código interno, NCM, desenho, material); as peças da Forja entram aqui.
Fluxo: orçamento ganho → OS em rascunho na Forja (o Rafael completa e libera) → produção → "A faturar" no Fiscal → nota (Jefferson).
A ficha do cliente (ficha_cliente) vem do Segundo Cérebro: faturado e recebido no histórico, atraso médio para pagar, peças e OS.
Quem decide: Rafael (comercial, orçamento e PCP); faturamento é do Jefferson.`;

export const comercial: Agente = {
  sara: {
    modulo: M, nome: "SARA do Comercial", rotulo: "Comercial", feature: M, permissao: "comercial.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["Quais orçamentos estão em aberto?", "Tem algum orçamento ganho para faturar?", "O cliente Verallia está pronto para a NF-e?", "Quantos produtos estão sem NCM?"],
  },
  ferramentas, regras,
};
