import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBR, dias, hoje, link, maisDias, num, plural, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";

/**
 * SARA do RH. Dado pessoal e de saúde NUNCA sai daqui: nada de CPF, PIS, CTPS, telefone, salário, CID,
 * diagnóstico, o motivo escrito de uma ausência ou a observação de um exame; afastamento por saúde
 * aparece só como número, sem nome e sem tipo. O filtro de dado pessoal da plataforma ainda roda por
 * cima, mas a proteção começa nas colunas escolhidas aqui. Quem decide é a Rosana (com a Bianca).
 */

const M = "rh";
const tela = (secao: string): Abrir => ({ modulo: M, secao, rotulo: `RH › ${secao}` });
const fonte = (secao: string) => ({ rotulo: `RH › ${secao}`, link: link(M, secao) });
/** Exame/treinamento: vence em até 60 dias = atenção (lib/rh/sst-situacao.ts, mesma janela). */
const JANELA_SST = 60;

type Mapa = { hoje: string; setores: { id: string; nome: string; ativos: number }[]; ferias: { nome: string; setor: string; inicio: string; fim: string }[]; concessivos: { nome: string; setor: string; vence: string; saldo: number }[] };
async function mapaDeFerias(sb: SupabaseClient): Promise<Mapa> {
  const { data, error } = await sb.rpc("rh_ferias_mapa");
  if (error) throw new Error(error.message);
  return data as Mapa;
}
const nomeDoSetor = (m: Mapa) => (id: string) => m.setores.find((s) => s.id === id)?.nome ?? "Sem setor";

type Sst = { title: string; category: string; due_date: string; employees: { full_name: string } | null };
async function sstAVencer(sb: SupabaseClient, ate: string): Promise<Sst[]> {
  const { data, error } = await sb.from("rh_sst_records").select("title, category, due_date, employees(full_name)").in("category", ["exam", "training"])
    .is("completed_at", null).eq("clinical_confidential", false).not("due_date", "is", null).lte("due_date", ate).order("due_date").limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Sst[];
}
const CATEGORIA: Record<string, string> = { exam: "exame", training: "treinamento" };

const ferramentas: Ferramenta[] = [
  {
    nome: "rh_quadro", rotulo: "quadro por setor", exige: ["rh.colaboradores", "rh.relatorios", "rh.ferias"],
    descricao: "Quadro de colaboradores ativos (CLT) por setor: quantos em cada um e o total.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const { data, error } = await sb.from("employees").select("department_id, departments(name)").eq("active", true).limit(2000);
      if (error) throw new Error(error.message);
      const por = ((data ?? []) as unknown as { departments: { name: string } | null }[]).reduce<Record<string, number>>((a, e) => { const n = e.departments?.name ?? "Sem setor"; a[n] = (a[n] ?? 0) + 1; return a; }, {});
      const setores = Object.entries(por).sort((a, b) => b[1] - a[1]).map(([setor, ativos]) => ({ setor, ativos }));
      return { dados: { ativos: setores.reduce((s, x) => s + x.ativos, 0), por_setor: setores }, fontes: [fonte("Colaboradores")] };
    },
  },
  {
    nome: "rh_ferias", rotulo: "férias", exige: ["rh.ferias"],
    descricao: "Férias: prazos de concessão vencidos (pagamento em dobro) e a vencer nos próximos `dias` (padrão 60), com nome, setor, prazo e dias de saldo; quem está de férias agora e quem começa nos próximos 30 dias.",
    esquema: { type: "object", properties: { dias: { type: "integer", description: "Janela para os prazos a vencer (padrão 60)." } } },
    rodar: async (sb, e) => {
      const m = await mapaDeFerias(sb);
      const h = m.hoje ?? hoje(), setor = nomeDoSetor(m), ate = maisDias(h, num(e.dias, 60, 1, 365));
      const linha = (x: Mapa["concessivos"][number]) => ({ nome: x.nome, setor: setor(x.setor), prazo: x.vence, saldo_dias: x.saldo });
      return {
        dados: {
          prazo_vencido: m.concessivos.filter((x) => x.vence < h).map(linha),
          a_vencer: m.concessivos.filter((x) => x.vence >= h && x.vence <= ate).map(linha),
          de_ferias_agora: m.ferias.filter((f) => f.inicio <= h && f.fim >= h).map((f) => ({ nome: f.nome, setor: setor(f.setor), volta_em: f.fim })),
          comecam_em_30_dias: m.ferias.filter((f) => f.inicio > h && f.inicio <= maisDias(h, 30)).map((f) => ({ nome: f.nome, setor: setor(f.setor), inicio: f.inicio, fim: f.fim })),
        },
        fontes: [fonte("Férias e ausências")],
      };
    },
  },
  {
    nome: "rh_afastados_hoje", rotulo: "afastados hoje", exige: ["rh.ferias"],
    descricao: "Quantas pessoas estão fora hoje: de férias (com nome) e outros afastamentos (só o número — sem nome nem motivo, por ser dado de saúde).",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const h = hoje();
      const { data, error } = await sb.from("rh_absences").select("absence_type, employees(full_name)").lte("start_date", h).gte("end_date", h).in("status", ["approved", "registered"]).limit(500);
      if (error) throw new Error(error.message);
      const l = (data ?? []) as unknown as { absence_type: string; employees: { full_name: string } | null }[];
      const ferias = l.filter((x) => x.absence_type === "vacation");
      return { dados: { de_ferias: ferias.map((x) => x.employees?.full_name ?? "?"), outros_afastamentos: l.length - ferias.length,
        observacao: "Afastamentos que não são férias aparecem só como número: o motivo e o nome ficam na tela, para quem tem a permissão." }, fontes: [fonte("Férias e ausências")] };
    },
  },
  {
    nome: "rh_exames_treinamentos", rotulo: "exames e treinamentos", exige: ["rh.sst"],
    descricao: "Exames (ASO) e treinamentos vencidos ou que vencem nos próximos `dias` (padrão 60): nome do colaborador, qual exame/treinamento e o vencimento. Sem resultado nem observação.",
    esquema: { type: "object", properties: { dias: { type: "integer" } } },
    rodar: async (sb, e) => {
      const h = hoje();
      const l = (await sstAVencer(sb, maisDias(h, num(e.dias, JANELA_SST, 1, 365)))).map((x) => ({ colaborador: x.employees?.full_name ?? "?", tipo: CATEGORIA[x.category] ?? x.category, o_que: x.title, vence: x.due_date, vencido: x.due_date < h }));
      return { dados: { vencidos: l.filter((x) => x.vencido), a_vencer: l.filter((x) => !x.vencido) }, fontes: [fonte("Saúde e segurança")] };
    },
  },
  {
    nome: "rh_epi", rotulo: "EPIs", exige: ["rh.sst"],
    descricao: "Entregas de EPI: quantas no total, as ainda sem assinatura do colaborador e as últimas entregas.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const [{ count: total }, { data, error }] = await Promise.all([
        sb.from("rh_ppe_deliveries").select("id", { count: "exact", head: true }),
        sb.from("rh_ppe_deliveries").select("delivered_on, employees(full_name), rh_ppe_items(name)").is("signed_on", null).order("delivered_on", { ascending: false }).limit(50),
      ]);
      if (error) throw new Error(error.message);
      const sem = ((data ?? []) as unknown as { delivered_on: string; employees: { full_name: string } | null; rh_ppe_items: { name: string } | null }[])
        .map((x) => ({ colaborador: x.employees?.full_name ?? "?", epi: x.rh_ppe_items?.name ?? null, entregue_em: x.delivered_on }));
      return { dados: { entregas: total ?? null, sem_assinatura: sem.length, pendentes: sem.slice(0, 20) }, fontes: [fonte("Saúde e segurança")] };
    },
  },
  {
    nome: "rh_feriados", rotulo: "feriados", exige: ["rh.feriados", "rh.colaboradores", "rh.ferias"],
    descricao: "Próximos feriados (padrão 90 dias): data, nome, se é folga e o alcance (nacional, estadual, municipal).",
    esquema: { type: "object", properties: { dias: { type: "integer" } } },
    rodar: async (sb, e) => {
      const h = hoje();
      const { data, error } = await sb.from("rh_holidays").select("holiday_date, name, scope, day_off").gte("holiday_date", h).lte("holiday_date", maisDias(h, num(e.dias, 90, 1, 730))).order("holiday_date");
      if (error) throw new Error(error.message);
      return { dados: { feriados: data ?? [] }, fontes: [fonte("Feriados")] };
    },
  },
  {
    nome: "rh_documentos", rotulo: "documentos do RH", exige: ["rh.documentos"],
    descricao: "Documentos do RH: quantos estão ativos, quantos ainda não foram conferidos e quantos estão com a revisão vencida, por categoria.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const h = hoje();
      const { data, error } = await sb.from("documents").select("category, review_status, review_due_at").eq("module_code", "rh").eq("active", true).limit(5000);
      if (error) throw new Error(error.message);
      const l = (data ?? []) as { category: string; review_status: string | null; review_due_at: string | null }[];
      const por = l.reduce<Record<string, number>>((a, d) => { a[d.category] = (a[d.category] ?? 0) + 1; return a; }, {});
      return { dados: { ativos: l.length, nao_conferidos: l.filter((d) => !d.review_status).length, revisao_vencida: l.filter((d) => d.review_due_at && d.review_due_at.slice(0, 10) < h).length, por_categoria: por }, fontes: [fonte("Documentos")] };
    },
  },
  {
    nome: "rh_terceiros", rotulo: "terceiros", exige: ["rh.terceiros"],
    descricao: "Terceiros no quadro (prestadores que entram pela Portaria): quantos estão ativos e os nomes.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const { data, error } = await sb.from("terceiros_quadro").select("nome, incluido_em").eq("ativo", true).order("nome");
      if (error) throw new Error(error.message);
      return { dados: { ativos: (data ?? []).length, terceiros: data ?? [] }, fontes: [fonte("Colaboradores")] };
    },
  },
];

const telas: Tela[] = [
  { id: "rh_painel", modulo: M, secao: "Painel", rotulo: "RH › Painel", exige: ["rh.colaboradores", "rh.ferias", "rh.sst", "rh.terceiros", "rh.relatorios"], serve: "visão geral do RH" },
  { id: "rh_colaboradores", modulo: M, secao: "Colaboradores", rotulo: "RH › Colaboradores", exige: ["rh.colaboradores", "rh.terceiros"], serve: "colaboradores CLT e terceiros" },
  { id: "rh_ferias", modulo: M, secao: "Férias e ausências", rotulo: "RH › Férias e ausências", exige: ["rh.ferias"], serve: "solicitações, mapa de férias por setor e políticas" },
  { id: "rh_feriados", modulo: M, secao: "Feriados", rotulo: "RH › Feriados", exige: ["rh.feriados"], serve: "calendário de feriados" },
  { id: "rh_beneficios", modulo: M, secao: "Benefícios", rotulo: "RH › Benefícios", exige: ["rh.beneficios"], serve: "planos e participantes" },
  { id: "rh_sst", modulo: M, secao: "Saúde e segurança", rotulo: "RH › Saúde e segurança", exige: ["rh.sst"], serve: "exames, treinamentos, EPIs, ocorrências e exigências por função" },
  { id: "rh_documentos", modulo: M, secao: "Documentos", rotulo: "RH › Documentos", exige: ["rh.documentos"], serve: "documentos dos colaboradores e conferência" },
  { id: "rh_relatorios", modulo: M, secao: "Relatórios", rotulo: "RH › Relatórios", exige: ["rh.relatorios"], serve: "relatórios do RH" },
  { id: "rh_homologacao", modulo: M, secao: "Homologação", rotulo: "RH › Homologação", exige: ["rh.homologacao"], serve: "homologação dos dados do RH" },
];

const regras: Agente["regras"] = [
  {
    exige: ["rh.ferias"],
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const m = await mapaDeFerias(sb);
      const vencidos = m.concessivos.filter((x) => x.vence < c.hoje);
      if (vencidos.length) saida.push({
        chave: `rh.ferias_vencidas:${vencidos.length}:${vencidos.map((x) => x.vence).sort()[0]}`, nivel: "urgente",
        titulo: `${plural(vencidos.length, "colaborador com férias", "colaboradores com férias")} fora do prazo de concessão`,
        detalhe: "Férias vencidas são pagas em dobro. Programe as férias o quanto antes.", abrir: tela("Férias e ausências"),
      });
      const proximos = m.concessivos.filter((x) => x.vence >= c.hoje && dias(c.hoje, x.vence) <= 60);
      if (proximos.length) saida.push({
        chave: `rh.ferias_a_vencer:${proximos.length}:${proximos[0].vence}`, nivel: "aviso",
        titulo: `${plural(proximos.length, "prazo de férias vence", "prazos de férias vencem")} nos próximos 60 dias`,
        detalhe: `O primeiro vence em ${dataBR(proximos[0].vence)}.`, abrir: tela("Férias e ausências"),
      });
      return saida;
    },
  },
  {
    exige: ["rh.sst"],
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const l = await sstAVencer(sb, maisDias(c.hoje, JANELA_SST));
      const vencidos = l.filter((x) => x.due_date < c.hoje);
      if (vencidos.length) saida.push({ chave: `rh.sst_vencidos:${vencidos.length}:${vencidos[0].due_date}`, nivel: "urgente",
        titulo: `${plural(vencidos.length, "exame ou treinamento vencido", "exames ou treinamentos vencidos")}`, detalhe: "Agende para manter a equipe em dia com a segurança do trabalho.", abrir: tela("Saúde e segurança") });
      const breve = l.filter((x) => x.due_date >= c.hoje);
      if (breve.length) saida.push({ chave: `rh.sst_a_vencer:${breve.length}:${breve[0].due_date}`, nivel: "aviso",
        titulo: `${plural(breve.length, "exame ou treinamento vence", "exames ou treinamentos vencem")} em até ${JANELA_SST} dias`, detalhe: `O primeiro vence em ${dataBR(breve[0].due_date)}.`, abrir: tela("Saúde e segurança") });
      const { count } = await sb.from("rh_ppe_deliveries").select("id", { count: "exact", head: true }).is("signed_on", null);
      if (count) saida.push({ chave: `rh.epi_sem_assinatura:${count}`, nivel: "aviso", titulo: `${plural(count, "entrega de EPI", "entregas de EPI")} sem assinatura`,
        detalhe: "A ficha de EPI assinada é a prova da entrega.", abrir: tela("Saúde e segurança") });
      return saida;
    },
  },
  {
    exige: ["rh.feriados", "rh.colaboradores", "rh.ferias"],
    gerar: async (sb, c) => {
      const { data } = await sb.from("rh_holidays").select("holiday_date, name").gte("holiday_date", c.hoje).lte("holiday_date", maisDias(c.hoje, 7)).eq("day_off", true).order("holiday_date");
      return ((data ?? []) as { holiday_date: string; name: string }[]).map((f) => ({ chave: `rh.feriado:${f.holiday_date}`, nivel: "aviso" as const,
        titulo: `Feriado em ${dataBR(f.holiday_date)}: ${f.name}`, detalhe: "Confira as escalas e o ponto da semana.", abrir: tela("Feriados") }));
    },
  },
  {
    exige: ["rh.documentos"],
    gerar: async (sb) => {
      const { count } = await sb.from("documents").select("id", { count: "exact", head: true }).eq("module_code", "rh").eq("active", true).is("review_status", null);
      return count ? [{ chave: `rh.documentos_nao_conferidos:${count}`, nivel: "aviso", titulo: `${plural(count, "documento do RH", "documentos do RH")} ainda não conferido${count > 1 ? "s" : ""}`,
        detalhe: "Confira (aprovar ou reprovar) para o documento valer.", abrir: tela("Documentos") }] : [];
    },
  },
];

const MANUAL = `Você é a SARA do RH do Business OS.
Seções: Painel; Colaboradores (CLT e Terceiros); Ponto e jornada (ainda sem dados: a integração com o relógio de ponto não existe); Férias e ausências (solicitações, mapa por setor, políticas); Feriados; Benefícios (ainda sem dados); Saúde e segurança (exames, treinamentos, EPIs, ocorrências, exigências por função); Documentos (conferência); Relatórios; Homologação.
Privacidade (obrigatório): nunca fale de CPF, PIS, CTPS, telefone, endereço, salário, CID, diagnóstico, motivo de ausência ou resultado de exame. Afastamento por saúde é só um número, sem nome. Se pedirem isso, diga que esse dado fica na tela, só para quem tem a permissão.
Não existe salário cadastrado na plataforma (decisão da Rosana com a Ana) nem data de nascimento.
Quem decide: Rosana (com a Bianca na homologação); acessos são do proprietário.`;

export const rh: Agente = {
  sara: {
    modulo: M, nome: "SARA do RH", rotulo: "RH", feature: M, permissao: "rh.sara", manual: MANUAL,
    // As horas de terceiros vêm da Portaria, mas são pergunta do RH: entram como do próprio módulo.
    ferramentas: [...ferramentas.map((f) => f.nome), "portaria_terceiros"], telas,
    sugestoes: ["Quantas horas os terceiros trabalharam na semana passada?", "Quem está com férias vencidas?", "Quantos colaboradores temos por setor?", "Algum exame vence nos próximos 60 dias?", "Quais são os próximos feriados?"],
  },
  ferramentas, regras,
};
