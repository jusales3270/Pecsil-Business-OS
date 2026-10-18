import type { SupabaseClient } from "@supabase/supabase-js";
import { brl, dataBR, dias, hoje, link, plural, reais, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";
import { aFaturar } from "./comercial.ts";

/**
 * SARA do Fiscal: ICMS do mês, notas recebidas (SEFAZ), notas emitidas (só PRODUÇÃO conta), o que
 * está a faturar, o fechamento do mês com o escritório e o certificado. Nunca mostra XML, linha
 * digitável, segredo do certificado nem CPF. Quem decide é o Jefferson (com o contador).
 */

const M = "fiscal";
const tela = (secao: string): Abrir => ({ modulo: M, secao, rotulo: `Fiscal › ${secao}` });
const fonte = (secao: string) => ({ rotulo: `Fiscal › ${secao}`, link: link(M, secao) });
const PORTAL = ["fiscal.escritorio", "fiscal.portal"];
const mesDe = (iso: string) => `${iso.slice(0, 7)}-01`;
/** Primeiro dia do mês seguinte a AAAA-MM. */
const proximoMes = (mes: string) => { const [a, m] = mes.split("-").map(Number); return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`; };

async function competenciaAtual(sb: SupabaseClient) {
  const { data } = await sb.from("fiscal_competencias").select("id, competencia, situacao, fiscal_competencia_itens(rotulo, situacao)").order("competencia", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; competencia: string; situacao: string; fiscal_competencia_itens: { rotulo: string; situacao: string }[] } | null;
}
async function guias(sb: SupabaseClient, competencia: string) {
  const { data, error } = await sb.rpc("fiscal_portal_guias", { p_competencia: competencia });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { tipo: string; credor: string | null; valor: number; vencimento: string | null; situacao: string; pagamento: string }[])
    .filter((g) => g.situacao !== "cancelada").map((g) => ({ tipo: g.tipo, credor: g.credor, valor: reais(Number(g.valor)), vencimento: g.vencimento, pagamento: g.pagamento }));
}

const ferramentas: Ferramenta[] = [
  {
    nome: "fiscal_icms_mes", rotulo: "ICMS do mês", exige: ["fiscal.icms"],
    descricao: "ICMS das notas de entrada de um mês (padrão: o atual): quantas notas, valor, base, ICMS e IPI, quantas notas são de cada área (fundição, usinagem, administrativo — uma nota pode ser de mais de uma) e as notas ainda pendentes (sem XML, não lançadas ou não autorizadas).",
    esquema: { type: "object", properties: { mes: { type: "string", description: "AAAA-MM (padrão: o mês atual)." } } },
    rodar: async (sb, e) => {
      const mes = /^\d{4}-\d{2}$/.test(String(e.mes ?? "")) ? `${e.mes}-01` : mesDe(hoje());
      const { data, error } = await sb.from("fiscal_icms_entries").select("fornecedor, nfe, valor, base_icms, icms, ipi, fundicao, usinagem, administrativo, xml_ok, lancado, autorizado").eq("competencia", mes).limit(2000);
      if (error) throw new Error(error.message);
      const l = (data ?? []) as { fornecedor: string; nfe: string | null; valor: number; base_icms: number; icms: number; ipi: number; fundicao: boolean; usinagem: boolean; administrativo: boolean; xml_ok: boolean; lancado: boolean; autorizado: boolean }[];
      const soma = (k: "valor" | "base_icms" | "icms" | "ipi") => reais(l.reduce((s, x) => s + Number(x[k] ?? 0), 0));
      const pend = l.filter((x) => !x.xml_ok || !x.lancado || !x.autorizado);
      return {
        dados: { competencia: mes.slice(0, 7), notas: l.length, valor: soma("valor"), base_icms: soma("base_icms"), icms: soma("icms"), ipi: soma("ipi"),
          notas_por_area: { fundicao: l.filter((x) => x.fundicao).length, usinagem: l.filter((x) => x.usinagem).length, administrativo: l.filter((x) => x.administrativo).length,
            observacao: "Quantidade de notas marcadas para cada área; uma nota pode ser de mais de uma, então não é divisão de valor." },
          pendentes: pend.length, pendencias: pend.slice(0, 15).map((x) => ({ fornecedor: x.fornecedor, nfe: x.nfe, falta: [!x.xml_ok && "XML", !x.lancado && "lançar", !x.autorizado && "autorizar"].filter(Boolean) })) },
        fontes: [fonte("Painel do ICMS")],
      };
    },
  },
  {
    nome: "fiscal_notas_recebidas", rotulo: "notas recebidas", exige: ["fiscal.icms", "fiscal.nfe"],
    descricao: "Notas de fornecedores vindas da SEFAZ: quantas, as que ainda não estão no Painel do ICMS, sem XML, canceladas e com erro de manifestação; e se a consulta automática está ligada.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const contar = async (f: string) => { const { data } = await sb.rpc("fiscal_dfe_listar", { p_filtro: f, p_limite: 200 }); return (data ?? []) as { emitente_nome: string; valor: number; emissao: string; manifestacao_erro: string | null }[]; };
      const [todas, fora, semXml, canceladas, cfg] = await Promise.all([contar("todas"), contar("fora_do_painel"), contar("sem_xml"), contar("canceladas"),
        sb.from("fiscal_config").select("dfe_ativo, dfe_ultima_consulta, dfe_ultimo_status").maybeSingle()]);
      return {
        dados: { recebidas: todas.length, fora_do_painel: fora.length, sem_xml: semXml.length, canceladas: canceladas.length, com_erro_de_manifestacao: todas.filter((n) => n.manifestacao_erro).length,
          consulta_automatica: cfg.data ?? null, ultimas_fora_do_painel: fora.slice(0, 10).map((n) => ({ emitente: n.emitente_nome, valor: reais(Number(n.valor)), emissao: n.emissao?.slice(0, 10) })) },
        fontes: [fonte("Notas recebidas")],
      };
    },
  },
  {
    nome: "fiscal_notas_emitidas", rotulo: "notas emitidas", exige: ["fiscal.nfe"],
    descricao: "NF-e emitidas de verdade (ambiente de produção) num mês (padrão: o atual): quantas por situação, valor autorizado, as rejeitadas (com o motivo) e as aguardando aprovação. Treino e homologação não contam.",
    esquema: { type: "object", properties: { mes: { type: "string", description: "AAAA-MM." } } },
    rodar: async (sb, e) => {
      const mes = /^\d{4}-\d{2}$/.test(String(e.mes ?? "")) ? String(e.mes) : hoje().slice(0, 7);
      const { data, error } = await sb.from("fiscal_nfe").select("numero, serie, situacao, emissao, valor_total, destinatario_nome, motivo, created_at").eq("ambiente", "producao")
        .gte("created_at", `${mes}-01`).lt("created_at", proximoMes(mes)).order("created_at", { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      const l = (data ?? []) as { numero: number | null; situacao: string; valor_total: number | null; destinatario_nome: string | null; motivo: string | null }[];
      const por = l.reduce<Record<string, number>>((a, x) => { a[x.situacao] = (a[x.situacao] ?? 0) + 1; return a; }, {});
      return {
        dados: { mes, total: l.length, por_situacao: por, valor_autorizado: reais(l.filter((x) => x.situacao === "autorizada").reduce((s, x) => s + Number(x.valor_total ?? 0), 0)),
          rejeitadas: l.filter((x) => x.situacao === "rejeitada").slice(0, 10).map((x) => ({ numero: x.numero, destinatario: x.destinatario_nome, motivo: x.motivo })),
          aguardando_aprovacao: l.filter((x) => x.situacao === "aguardando_aprovacao").length },
        fontes: [fonte("Notas emitidas")],
      };
    },
  },
  {
    nome: "fiscal_a_faturar", rotulo: "a faturar", exige: ["fiscal.nfe"],
    descricao: "O que já foi produzido e ainda não virou nota (orçamentos ganhos com saldo a faturar): orçamento, cliente, pedido do cliente e valor disponível.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => ({ dados: await aFaturar(sb), fontes: [fonte("A faturar")] }),
  },
  {
    nome: "fiscal_fechamento_mes", rotulo: "fechamento do mês", exige: PORTAL,
    descricao: "Fechamento do mês com o escritório contábil: competência atual, situação (em preparação, enviada, conferida, fechada), itens do checklist pendentes, pendências abertas e as guias (DARF, DAS, GARE, FGTS…) com valor, vencimento e se já foram pagas.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const comp = await competenciaAtual(sb);
      if (!comp) return { dados: { competencia: null, observacao: "Nenhuma competência aberta." }, fontes: [fonte("Escritório contábil")] };
      const [g, pend] = await Promise.all([guias(sb, comp.id).catch(() => []), sb.from("fiscal_pendencias").select("assunto, aberta_por_lado, situacao").eq("competencia_id", comp.id).neq("situacao", "resolvida")]);
      return {
        dados: { competencia: comp.competencia.slice(0, 7), situacao: comp.situacao, itens_pendentes: (comp.fiscal_competencia_itens ?? []).filter((i) => i.situacao === "pendente").map((i) => i.rotulo),
          pendencias: pend.data ?? [], guias: g, guias_a_pagar: reais(g.filter((x) => x.pagamento !== "paga").reduce((s, x) => s + x.valor, 0)) },
        fontes: [fonte("Escritório contábil")],
      };
    },
  },
  {
    nome: "fiscal_certificado", rotulo: "certificado", exige: ["fiscal.config", "fiscal.certificado"],
    descricao: "Certificado digital (A1) e ambiente de emissão: se há certificado, titular, CNPJ, validade e quantos dias faltam; ambiente (homologação/produção).",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const { data } = await sb.from("fiscal_config").select("ambiente, cert_titular, cert_cnpj, cert_validade, cert_enviado_em").maybeSingle();
      const c = data as { ambiente: string; cert_titular: string | null; cert_cnpj: string | null; cert_validade: string | null } | null;
      return { dados: { ambiente: c?.ambiente ?? null, tem_certificado: Boolean(c?.cert_validade), titular: c?.cert_titular ?? null, cnpj: c?.cert_cnpj ?? null, validade: c?.cert_validade ?? null,
        dias_para_vencer: c?.cert_validade ? dias(hoje(), c.cert_validade) : null }, fontes: [fonte("Configuração")] };
    },
  },
];

const telas: Tela[] = [
  { id: "fiscal_icms", modulo: M, secao: "Painel do ICMS", rotulo: "Fiscal › Painel do ICMS", exige: ["fiscal.icms"], serve: "ICMS das notas de entrada do mês" },
  { id: "fiscal_recebidas", modulo: M, secao: "Notas recebidas", rotulo: "Fiscal › Notas recebidas", exige: ["fiscal.icms", "fiscal.nfe"], serve: "notas de fornecedores vindas da SEFAZ" },
  { id: "fiscal_a_faturar", modulo: M, secao: "A faturar", rotulo: "Fiscal › A faturar", exige: ["fiscal.nfe"], serve: "o que já pode virar nota" },
  { id: "fiscal_emitidas", modulo: M, secao: "Notas emitidas", rotulo: "Fiscal › Notas emitidas", exige: ["fiscal.nfe"], serve: "NF-e emitidas, DANFE" },
  { id: "fiscal_mascaras", modulo: M, secao: "Máscaras de impostos", rotulo: "Fiscal › Máscaras de impostos", exige: ["fiscal.nfe", "fiscal.config"], serve: "regras de impostos por tipo de operação" },
  { id: "fiscal_escritorio", modulo: M, secao: "Escritório contábil", rotulo: "Fiscal › Escritório contábil", exige: ["fiscal.escritorio"], serve: "fechamento do mês e guias" },
  { id: "fiscal_portal", modulo: M, secao: "Portal do contador", rotulo: "Fiscal › Portal do contador", exige: ["fiscal.portal"], serve: "o lado do escritório no fechamento" },
  { id: "fiscal_configuracao", modulo: M, secao: "Configuração", rotulo: "Fiscal › Configuração", exige: ["fiscal.config", "fiscal.certificado"], serve: "dados do emitente, ambiente e certificado" },
];

const regras: Agente["regras"] = [
  {
    exige: ["fiscal.config", "fiscal.certificado"],
    gerar: async (sb, c) => {
      const { data } = await sb.from("fiscal_config").select("cert_validade").maybeSingle();
      const v = (data as { cert_validade: string | null } | null)?.cert_validade;
      // Sem certificado não avisa: retirar o certificado foi decisão do Jefferson (16/10).
      if (!v || dias(c.hoje, v) > 30) return [];
      return [{ chave: `fiscal.certificado:${v}`, nivel: "urgente", titulo: dias(c.hoje, v) < 0 ? "O certificado digital venceu" : `O certificado digital vence em ${dias(c.hoje, v)} dia(s)`,
        detalhe: `Validade: ${dataBR(v)}. Sem ele não sai nota.`, abrir: tela("Configuração") }];
    },
  },
  {
    exige: ["fiscal.nfe"],
    gerar: async (sb) => {
      const saida: Alerta[] = [];
      const { data } = await sb.from("fiscal_nfe").select("numero, motivo").eq("ambiente", "producao").eq("situacao", "rejeitada").limit(50);
      const rej = (data ?? []) as { numero: number | null; motivo: string | null }[];
      if (rej.length) saida.push({ chave: `fiscal.rejeitadas:${rej.map((x) => x.numero ?? "?").join(",")}`, nivel: "urgente", titulo: `${plural(rej.length, "nota rejeitada", "notas rejeitadas")} pela SEFAZ`,
        detalhe: rej.slice(0, 2).map((x) => `nº ${x.numero ?? "?"}: ${x.motivo ?? "sem motivo"}`).join(" · "), abrir: tela("Notas emitidas") });
      const { count } = await sb.from("fiscal_nfe").select("id", { count: "exact", head: true }).eq("ambiente", "producao").eq("situacao", "aguardando_aprovacao");
      if (count) saida.push({ chave: `fiscal.aguardando:${count}`, nivel: "aviso", titulo: `${plural(count, "nota aguardando", "notas aguardando")} aprovação para emitir`, detalhe: "Quem aprova a emissão é quem tem a aprovação da NF-e.", abrir: tela("Notas emitidas") });
      const fat = await aFaturar(sb).catch(() => null);
      if (fat?.orcamentos.length) saida.push({ chave: `fiscal.a_faturar:${fat.orcamentos.map((o) => o.orcamento).join(",")}`, nivel: "aviso", titulo: `${plural(fat.orcamentos.length, "orçamento com saldo", "orçamentos com saldo")} a faturar`,
        detalhe: `${brl(fat.orcamentos.reduce((s, o) => s + o.disponivel_para_faturar, 0))} já produzidos e sem nota.`, abrir: tela("A faturar") });
      return saida;
    },
  },
  {
    exige: ["fiscal.icms"],
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const { data } = await sb.from("fiscal_icms_entries").select("id").eq("competencia", mesDe(c.hoje)).or("xml_ok.eq.false,lancado.eq.false,autorizado.eq.false").limit(500);
      const n = (data ?? []).length;
      if (n) saida.push({ chave: `fiscal.icms_pendente:${c.hoje.slice(0, 7)}:${n}`, nivel: "aviso", titulo: `${plural(n, "nota de entrada do mês", "notas de entrada do mês")} com pendência no ICMS`, detalhe: "Falta XML, lançar ou autorizar.", abrir: tela("Painel do ICMS") });
      const { data: cfg } = await sb.from("fiscal_config").select("dfe_ativo, dfe_ultimo_status, dfe_ultima_consulta").maybeSingle();
      const st = cfg as { dfe_ativo: boolean; dfe_ultimo_status: string | null; dfe_ultima_consulta: string | null } | null;
      if (st?.dfe_ativo && st.dfe_ultimo_status && /erro|falha|rejei/i.test(st.dfe_ultimo_status)) saida.push({ chave: `fiscal.dfe_erro:${st.dfe_ultima_consulta ?? ""}`, nivel: "urgente",
        titulo: "A consulta de notas na SEFAZ está com erro", detalhe: st.dfe_ultimo_status.slice(0, 160), abrir: tela("Notas recebidas") });
      return saida;
    },
  },
  {
    exige: PORTAL,
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const comp = await competenciaAtual(sb);
      if (!comp) return saida;
      const g = await guias(sb, comp.id).catch(() => []);
      const vencendo = g.filter((x) => x.pagamento !== "paga" && x.vencimento && dias(c.hoje, x.vencimento) <= 3);
      if (vencendo.length) saida.push({ chave: `fiscal.guias:${vencendo.map((x) => `${x.tipo}${x.vencimento}`).join(",")}`, nivel: "urgente", titulo: `${plural(vencendo.length, "guia vence", "guias vencem")} em até 3 dias`,
        detalhe: vencendo.map((x) => `${x.tipo} ${brl(x.valor)} (${dataBR(x.vencimento!)})`).join(" · "), abrir: tela("Escritório contábil") });
      const { data: pend } = await sb.from("fiscal_pendencias").select("id, assunto, aberta_por_lado").eq("competencia_id", comp.id).eq("situacao", "aguardando_empresa");
      const p = (pend ?? []) as { id: string; assunto: string }[];
      if (p.length) saida.push({ chave: `fiscal.pendencias:${p.map((x) => x.id).join(",")}`, nivel: "urgente", titulo: `O escritório está esperando a empresa em ${plural(p.length, "pendência", "pendências")}`,
        detalhe: p.slice(0, 3).map((x) => x.assunto).join(" · "), abrir: tela("Escritório contábil") });
      const itens = (comp.fiscal_competencia_itens ?? []).filter((i) => i.situacao === "pendente");
      if (comp.situacao === "em_preparacao" && itens.length) saida.push({ chave: `fiscal.fechamento:${comp.competencia}:${itens.length}`, nivel: "aviso",
        titulo: `Fechamento de ${dataBR(comp.competencia).slice(3)}: ${plural(itens.length, "item pendente", "itens pendentes")}`, detalhe: itens.slice(0, 4).map((i) => i.rotulo).join(" · "), abrir: tela("Escritório contábil") });
      return saida;
    },
  },
];

const MANUAL = `Você é a SARA do Fiscal do Business OS.
Seções:
- Painel do ICMS: as notas de entrada do mês (fornecedor, valor, base, ICMS, IPI e a área a que cada nota se refere — fundição, usinagem, administrativo; uma nota pode ser de mais de uma), com XML, lançado e autorizado.
- Notas recebidas: notas de fornecedores vindas da SEFAZ (ciência/manifestação) e as que ainda não entraram no painel.
- A faturar: o que a produção já entregou de orçamentos ganhos e ainda não virou nota.
- Notas emitidas: NF-e emitidas (TREINO e homologação são de teste; só a produção vale), DANFE, rejeições.
- Máscaras de impostos: regras de impostos por operação (com o contador).
- Escritório contábil / Portal do contador: fechamento do mês (checklist, pendências, malote) e as guias (DARF, DAS, GARE, FGTS…), que viram conta a pagar no Financeiro.
- Configuração: dados do emitente, ambiente e certificado digital.
Nunca informe XML, linha digitável de guia nem dados do certificado além de titular e validade.
Quem decide: Jefferson (fiscal e faturamento), com o contador nas regras fiscais.`;

export const fiscal: Agente = {
  sara: {
    modulo: M, nome: "SARA do Fiscal", rotulo: "Fiscal", feature: M, permissao: "fiscal.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["Quanto deu o ICMS deste mês?", "Tem nota de fornecedor fora do painel?", "O que já pode ser faturado?", "Como está o fechamento do mês com o escritório?"],
  },
  ferramentas, regras,
};
