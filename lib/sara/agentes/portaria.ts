import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBR, dias, hoje, link, maisDias, num, plural, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";

/**
 * SARA da Portaria: visitas, terceiros (horas da Portaria), frota e recebidos. Quem limita é a credencial
 * (decisão do proprietário, 20/10/2026): documento e contato do visitante vêm para quem vê as visitas.
 * A foto e a biometria não entram: são arquivo/vetor, não informação para responder.
 */

const M = "portaria";
const tela = (secao: string, rotulo: string): Abrir => ({ modulo: M, secao, rotulo: `Portaria › ${rotulo}` });
const fonte = (secao: string, rotulo: string) => ({ rotulo: `Portaria › ${rotulo}`, link: link(M, secao) });
const horaSP = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
const semSaida = (v: string | null) => !v || !v.trim();

async function frotaFora(sb: SupabaseClient) {
  const { data, error } = await sb.from("frota").select("data, responsavel, veiculo, horario_saida, destino, data_retorno, horario_retorno").order("data", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { data: string; responsavel: string; veiculo: string; horario_saida: string | null; destino: string | null; data_retorno: string | null; horario_retorno: string | null }[])
    .filter((x) => semSaida(x.data_retorno) && semSaida(x.horario_retorno));
}
async function visitasAbertas(sb: SupabaseClient) {
  const { data, error } = await sb.from("visitas").select("data, empresa, visitante, documento, contato, horario_entrada, horario_saida, responsavel, descricao").gte("data", maisDias(hoje(), -60)).order("data", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { data: string; empresa: string | null; visitante: string | null; documento: string | null; contato: string | null; horario_entrada: string | null; horario_saida: string | null; responsavel: string | null; descricao: string | null }[])
    .filter((v) => semSaida(v.horario_saida));
}

const ferramentas: Ferramenta[] = [
  {
    nome: "portaria_visitas", rotulo: "visitas", exige: ["portaria.visitas"],
    descricao: "Visitas de um período (padrão: hoje): quantas, por tipo (entrega, visita técnica, coleta…), por empresa, e as que ainda estão sem saída registrada. Mostra visitante, documento, contato, empresa, entrada e responsável. Com `visitante`, busca as visitas dessa pessoa.",
    esquema: { type: "object", properties: { dias: { type: "integer", description: "Últimos N dias (padrão 1 = hoje)." }, empresa: { type: "string" }, visitante: { type: "string" } } },
    rodar: async (sb, e) => {
      const n = num(e.dias, 1, 1, 365), de = maisDias(hoje(), -(n - 1));
      let q = sb.from("visitas").select("data, empresa, visitante, documento, contato, horario_entrada, horario_saida, responsavel, descricao").gte("data", de).order("data", { ascending: false }).limit(1000);
      if (termo(e.empresa)) q = q.ilike("empresa", `%${termo(e.empresa)}%`);
      if (termo(e.visitante)) q = q.ilike("visitante", `%${termo(e.visitante)}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const l = (data ?? []) as { descricao: string | null; empresa: string | null; horario_saida: string | null }[];
      const conta = (k: "descricao" | "empresa") => Object.entries(l.reduce<Record<string, number>>((a, v) => { const x = v[k] || "—"; a[x] = (a[x] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nome, quantidade]) => ({ nome, quantidade }));
      return { dados: { desde: de, visitas: l.length, por_tipo: conta("descricao"), por_empresa: conta("empresa"), sem_saida: l.filter((v) => semSaida(v.horario_saida)).slice(0, 15),
        ...(termo(e.visitante) ? { do_visitante: l.slice(0, 20) } : {}) }, fontes: [fonte("visitas", "Visitas")] };
    },
  },
  {
    nome: "portaria_terceiros", rotulo: "horas de terceiros", exige: ["portaria.terceiros", "rh.terceiros"],
    descricao: "Terceiros (prestadores) pela Portaria: quem está dentro agora e as HORAS TRABALHADAS de um período — panorama (total de horas, pessoas, dias, média por pessoa), comparativo por terceiro (horas, dias, média por dia) e o dia a dia. Período em de/ate (AAAA-MM-DD); padrão: mês atual. Ex.: semana passada = segunda a domingo anteriores.",
    esquema: { type: "object", properties: { de: { type: "string", description: "AAAA-MM-DD" }, ate: { type: "string", description: "AAAA-MM-DD" }, nome: { type: "string" } } },
    rodar: async (sb, e) => {
      const h = hoje();
      const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      const de = iso(e.de) ?? `${h.slice(0, 7)}-01`, ate = iso(e.ate) ?? h;
      type Reg = { nome: string; data: string; hora_entrada: string | null; hora_saida: string | null; minutos_trabalhados: number | null };
      const l: Reg[] = [];
      for (let ini = 0; ini < 20000; ini += 1000) {
        let q = sb.from("terceiros").select("nome, data, hora_entrada, hora_saida, minutos_trabalhados").gte("data", de).lte("data", ate).order("data").range(ini, ini + 999);
        if (termo(e.nome)) q = q.ilike("nome", `%${termo(e.nome)}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        l.push(...((data ?? []) as Reg[]));
        if ((data ?? []).length < 1000) break;
      }
      const horas = (min: number) => Math.round(min / 6) / 10;
      const pessoas = new Map<string, { min: number; dias: Set<string>; registros: number; abertos: number }>();
      const dias = new Map<string, { min: number; pessoas: Set<string> }>();
      for (const t of l) {
        const min = Number(t.minutos_trabalhados ?? 0);
        const p = pessoas.get(t.nome) ?? { min: 0, dias: new Set(), registros: 0, abertos: 0 };
        p.min += min; p.dias.add(t.data); p.registros += 1; if (semSaida(t.hora_saida)) p.abertos += 1; pessoas.set(t.nome, p);
        const d = dias.get(t.data) ?? { min: 0, pessoas: new Set() };
        d.min += min; d.pessoas.add(t.nome); dias.set(t.data, d);
      }
      const total = [...pessoas.values()].reduce((s, p) => s + p.min, 0);
      const porTerceiro = [...pessoas.entries()].sort((a, b) => b[1].min - a[1].min)
        .map(([nome, p]) => ({ nome, horas: horas(p.min), dias: p.dias.size, media_horas_por_dia: p.dias.size ? horas(p.min / p.dias.size) : 0, registros: p.registros, ...(p.abertos ? { sem_saida: p.abertos } : {}) }));
      return {
        dados: {
          periodo: { de, ate },
          panorama: { horas_total: horas(total), terceiros: pessoas.size, dias_com_registro: dias.size, registros: l.length,
            media_horas_por_terceiro: pessoas.size ? horas(total / pessoas.size) : 0,
            registros_sem_saida: l.filter((t) => semSaida(t.hora_saida)).length, registros_acima_de_12h: l.filter((t) => Number(t.minutos_trabalhados ?? 0) > 720).length },
          por_terceiro: porTerceiro.slice(0, 40),
          por_dia: [...dias.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, d]) => ({ data, horas: horas(d.min), terceiros: d.pessoas.size })),
          dentro_agora: l.filter((t) => t.data === h && semSaida(t.hora_saida)).map((t) => ({ nome: t.nome, entrou: t.hora_entrada })),
          observacao: "Registro sem saída conta 0 minutos até o terceiro sair.",
        },
        fontes: [fonte("terceiros", "Terceiros")],
      };
    },
  },
  {
    nome: "portaria_frota", rotulo: "frota", exige: ["portaria.veiculos"],
    descricao: "Frota: veículos que saíram e ainda não têm retorno registrado (veículo, motorista, destino, saída) e as saídas de hoje.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const h = hoje();
      const fora = await frotaFora(sb);
      return { dados: { sem_retorno: fora.map((x) => ({ veiculo: x.veiculo, motorista: x.responsavel, destino: x.destino, saiu_em: x.data, hora: x.horario_saida, ha_dias: dias(x.data, h) })) }, fontes: [fonte("veiculos", "Frota")] };
    },
  },
  {
    nome: "portaria_recebidos", rotulo: "recebidos", exige: ["portaria.recebidos"],
    descricao: "Encomendas recebidas na Portaria num período (padrão 7 dias): remetente, destinatário, descrição e data.",
    esquema: { type: "object", properties: { dias: { type: "integer" } } },
    rodar: async (sb, e) => {
      const { data, error } = await sb.from("encomendas").select("data, hora_registro, remetente, destinatario, descricao").gte("data", maisDias(hoje(), -num(e.dias, 7, 1, 365))).order("data", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return { dados: { recebidos: data ?? [] }, fontes: [fonte("recebidos", "Recebidos")] };
    },
  },
];

const telas: Tela[] = [
  { id: "portaria_dashboard", modulo: M, secao: "dashboard", rotulo: "Portaria › Dashboard", exige: ["portaria.visitas", "portaria.terceiros", "portaria.recebidos", "portaria.veiculos"], serve: "visão do dia" },
  { id: "portaria_visitas", modulo: M, secao: "visitas", rotulo: "Portaria › Visitas", exige: ["portaria.visitas"], serve: "registrar entrada e saída de visitas" },
  { id: "portaria_terceiros", modulo: M, secao: "terceiros", rotulo: "Portaria › Terceiros", exige: ["portaria.terceiros"], serve: "entrada e saída de prestadores" },
  { id: "portaria_recebidos", modulo: M, secao: "recebidos", rotulo: "Portaria › Recebidos", exige: ["portaria.recebidos"], serve: "encomendas recebidas" },
  { id: "portaria_frota", modulo: M, secao: "veiculos", rotulo: "Portaria › Frota", exige: ["portaria.veiculos"], serve: "saída e retorno dos veículos" },
];

const regras: Agente["regras"] = [
  {
    exige: ["portaria.veiculos"],
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const fora = await frotaFora(sb);
      const hojeFora = fora.filter((x) => x.data === c.hoje);
      if (hojeFora.length && horaSP() >= 19) saida.push({ chave: `portaria.frota_hoje:${c.hoje}:${hojeFora.length}`, nivel: "urgente",
        titulo: `${plural(hojeFora.length, "veículo ainda não voltou", "veículos ainda não voltaram")} hoje`, detalhe: hojeFora.slice(0, 3).map((x) => `${x.veiculo} (${x.responsavel})`).join(" · "), abrir: tela("veiculos", "Frota") });
      const antigos = fora.filter((x) => x.data < c.hoje);
      if (antigos.length) saida.push({ chave: `portaria.frota_antiga:${antigos.length}`, nivel: "aviso",
        titulo: `${plural(antigos.length, "saída de veículo", "saídas de veículo")} de dias anteriores sem retorno registrado`, detalhe: `A mais antiga é de ${dataBR(antigos[antigos.length - 1].data)}. Registre o retorno para o km ficar certo.`, abrir: tela("veiculos", "Frota") });
      return saida;
    },
  },
  {
    exige: ["portaria.visitas"],
    gerar: async (sb, c) => {
      const antigas = (await visitasAbertas(sb)).filter((v) => v.data < c.hoje);
      return antigas.length ? [{ chave: `portaria.visitas_abertas:${antigas.length}`, nivel: "aviso", titulo: `${plural(antigas.length, "visita", "visitas")} de dias anteriores sem saída registrada`,
        detalhe: antigas.slice(0, 3).map((v) => `${v.visitante ?? "?"} (${v.empresa ?? "—"}, ${dataBR(v.data)})`).join(" · "), abrir: tela("visitas", "Visitas") }] : [];
    },
  },
  {
    exige: ["portaria.terceiros"],
    gerar: async (sb, c) => {
      if (horaSP() < 20) return [];
      const { data } = await sb.from("terceiros").select("nome, hora_saida").eq("data", c.hoje).limit(500);
      const dentro = ((data ?? []) as { nome: string; hora_saida: string | null }[]).filter((t) => semSaida(t.hora_saida));
      return dentro.length ? [{ chave: `portaria.terceiros_dentro:${c.hoje}:${dentro.length}`, nivel: "urgente", titulo: `${plural(dentro.length, "terceiro ainda consta", "terceiros ainda constam")} dentro da fábrica`,
        detalhe: `${dentro.slice(0, 3).map((t) => t.nome).join(" · ")}. Registre a saída (as horas viram a base do pagamento).`, abrir: tela("terceiros", "Terceiros") }] : [];
    },
  },
];

const MANUAL = `Você é a SARA da Portaria do Business OS.
Seções: Dashboard (o dia); Visitas (entrada e saída de visitantes, entregas, coletas, visitas técnicas — com reconhecimento facial no cadastro); Terceiros (entrada e saída dos prestadores; os minutos viram as horas pagas aos terceiros); Recebidos (encomendas); Frota (saída e retorno dos veículos, km e destino).
Documento e contato do visitante vêm das consultas de visitas: responda completo; quem limita é a credencial da pessoa.
Quem decide: o quadro de terceiros é do RH (Rosana); acessos são do proprietário.`;

export const portaria: Agente = {
  sara: {
    modulo: M, nome: "SARA da Portaria", rotulo: "Portaria", feature: M, permissao: "portaria.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["Quantas visitas tivemos hoje?", "Tem terceiro dentro da fábrica agora?", "Algum veículo saiu e não voltou?", "Quantas horas cada terceiro fez este mês?"],
  },
  ferramentas, regras,
};
