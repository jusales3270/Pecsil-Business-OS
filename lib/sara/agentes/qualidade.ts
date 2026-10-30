import type { SupabaseClient } from "@supabase/supabase-js";
import { dias, hoje, link, plural, termo, type Agente, type Ferramenta, type Tela } from "../base.ts";

/**
 * SARA da Qualidade. Cresce junto com o módulo: cada seção é um bloco abaixo (texto, consultas e telas),
 * e seção nova é só mais um bloco em SECOES. O que é da Pecsil vem de fora do código: procedimentos em
 * Documentos do setor, lições aprovadas pela área e os tipos em qualidade_regras (docs/PLANO-QUALIDADE.md).
 */

const M = "qualidade";
const NC = ["qualidade.nao_conformidades"];
const SITUACAO: Record<string, string> = { aberta: "aberta", encerrada: "encerrada", cancelada: "cancelada" };
const fonteNc = { rotulo: "Qualidade › Não conformidades", link: link(M, "Não conformidades") };

/** Tipos, setores e gravidade valem da configuração da área e da lista real de departamentos. */
export async function opcoesDaNc(sb: SupabaseClient) {
  const [r, s] = await Promise.all([
    sb.from("qualidade_regras").select("tipos, usar_gravidade, gravidades, revisado_em").maybeSingle(),
    sb.from("departments").select("name").eq("active", true).order("name"),
  ]);
  if (r.error) throw new Error(r.error.message);
  if (s.error) throw new Error(s.error.message);
  if (!r.data) throw new Error("As regras de não conformidade ainda não foram configuradas.");
  return { tipos: r.data.tipos as string[], setores: (s.data ?? []).map((d) => String(d.name)), usa_gravidade: Boolean(r.data.usar_gravidade), gravidades: r.data.usar_gravidade ? (r.data.gravidades as string[]) : [], lista_provisoria: !r.data.revisado_em };
}

type LinhaNc = { numero: number; tipo: string; setor: string; local: string | null; maquina: string | null; os_codigo: string | null; gravidade: string | null; situacao: string; descricao: string; autor_nome: string; created_at: string };

const conta = (l: LinhaNc[], campo: "tipo" | "setor") => Object.entries(l.reduce<Record<string, number>>((x, n) => { x[n[campo]] = (x[n[campo]] ?? 0) + 1; return x; }, {})).sort((a, b) => b[1] - a[1]);

const ferramentasNc: Ferramenta[] = [
  {
    nome: "qualidade_opcoes_nc", rotulo: "tipos e setores", exige: NC,
    descricao: "Tipos de não conformidade definidos pela área, setores da empresa e se a gravidade está em uso. Consulte antes de classificar uma não conformidade.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => ({ dados: await opcoesDaNc(sb), fontes: [fonteNc] }),
  },
  {
    nome: "qualidade_nao_conformidades", rotulo: "não conformidades", exige: NC,
    descricao: "Não conformidades registradas (padrão: últimos 90 dias): número, data, tipo, setor, local, máquina, OS, situação, descrição e quem registrou. Traz totais por situação, tipo e setor, para ver o que se repete. Filtra por situação, tipo, setor ou palavra.",
    esquema: { type: "object", properties: {
      situacao: { type: "string", enum: Object.keys(SITUACAO) }, tipo: { type: "string" }, setor: { type: "string" }, palavra: { type: "string", description: "Procura na descrição, no local e na máquina." },
      dias: { type: "integer", description: "Quantos dias para trás (padrão 90)." },
    } },
    rodar: async (sb, e) => {
      const janela = Math.min(Math.max(Number(e.dias) || 90, 1), 1100);
      const desde = new Date(Date.now() - janela * 86_400_000).toISOString();
      let q = sb.from("qualidade_nao_conformidades").select("numero, tipo, setor, local, maquina, os_codigo, gravidade, situacao, descricao, autor_nome, created_at").gte("created_at", desde).order("created_at", { ascending: false }).limit(500);
      if (e.situacao && SITUACAO[String(e.situacao)]) q = q.eq("situacao", String(e.situacao));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const t = termo(e.tipo).toLowerCase(), s = termo(e.setor).toLowerCase(), p = termo(e.palavra).toLowerCase();
      const l = ((data ?? []) as LinhaNc[]).filter((n) => (!t || n.tipo.toLowerCase().includes(t)) && (!s || n.setor.toLowerCase().includes(s))
        && (!p || `${n.descricao} ${n.local ?? ""} ${n.maquina ?? ""}`.toLowerCase().includes(p)));
      const h = hoje();
      return {
        dados: { periodo_dias: janela, total: l.length, abertas: l.filter((n) => n.situacao === "aberta").length, por_tipo: conta(l, "tipo"), por_setor: conta(l, "setor"),
          lista: l.slice(0, 40).map((n) => ({ numero: `NC-${n.numero}`, data: n.created_at.slice(0, 10), dias_atras: dias(n.created_at.slice(0, 10), h), tipo: n.tipo, setor: n.setor, local: n.local, maquina: n.maquina, os: n.os_codigo, gravidade: n.gravidade, situacao: SITUACAO[n.situacao], descricao: n.descricao.slice(0, 300), registrou: n.autor_nome })) },
        fontes: [fonteNc],
      };
    },
  },
];

const telasNc: Tela[] = [
  { id: "qualidade_nc", modulo: M, secao: "Não conformidades", rotulo: "Qualidade › Não conformidades", exige: NC, serve: "ver, filtrar, corrigir, encerrar e cancelar as não conformidades, com as fotos" },
  { id: "qualidade_regras", modulo: M, secao: "Regras", rotulo: "Qualidade › Regras", exige: NC, serve: "tipos de não conformidade e uso da gravidade (quem aprova)" },
];

const TEXTO_NC = `Não conformidades: é o principal trabalho de hoje. A pessoa manda uma foto (ou anexa) e explica por voz ou texto. Ela pode falar de uma vez, mandar a foto sem dizer nada ou mandar só o texto.
Ao receber a foto, siga nesta ordem:
1. Diga em uma frase o que você vê. Só o que aparece na imagem; se não dá para ver bem, diga isso e peça outra foto.
2. Se a pessoa ainda não disse, pergunte se é para registrar como não conformidade.
3. Use tudo o que ela já contou e pergunte só o que falta, UMA pergunta por vez, curta (quem está no chão de fábrica responde falando): o que aconteceu, em que setor, onde exatamente, se envolve máquina ou peça, a OS se souber.
4. Consulte qualidade_opcoes_nc e escolha o tipo pela descrição da pessoa; a foto só apoia. Se a descrição e a foto não baterem, pergunte antes de seguir. Se a gravidade não estiver em uso, não fale dela.
5. Com tipo, setor, local e descrição, prepare registrar_nao_conformidade. A descrição é o que a pessoa disse, organizado, sem acrescentar. O que você leu na foto vai separado em analise_sara, com a sua confiança, mesmo que a foto tenha vindo em mensagem anterior: use o que você disse ao vê-la.
Sem foto: peça uma vez. Se a pessoa seguir sem foto, registre assim mesmo; o cartão avisa.
Nunca invente setor, local, máquina, OS, causa ou responsável. Não dê causa como certa: quem conclui é a Qualidade.
A foto já fica guardada quando a pessoa manda, e entra sozinha na não conformidade. Se ela mandar outra foto da mesma ocorrência, entra junto.
Corrigir, encerrar ou cancelar é na tela Não conformidades: abra a tela. Registro não se apaga.`;

const regrasNc: Agente["regras"] = [
  {
    exige: NC,
    gerar: async (sb) => {
      const { count, error } = await sb.from("qualidade_nao_conformidades").select("id", { count: "exact", head: true }).eq("situacao", "aberta");
      if (error) throw new Error(error.message);
      if (!count) return [];
      return [{ chave: `qualidade.abertas:${count}`, nivel: "aviso", titulo: plural(count, "não conformidade aberta", "não conformidades abertas"), detalhe: "Abra a tela para ver as fotos e o que falta encerrar.",
        abrir: { modulo: M, secao: "Não conformidades", rotulo: "Qualidade › Não conformidades" } }];
    },
  },
];

const SECOES = [{ nome: "Não conformidades", texto: TEXTO_NC, ferramentas: ferramentasNc, telas: telasNc, regras: regrasNc }];

const MANUAL = `Você é a SARA da Qualidade do Business OS. Você conhece gestão da qualidade na indústria (ISO 9001, inspeção, metrologia, defeitos de fundição e usinagem, 5 porquês, Ishikawa, 8D) e vai aprendendo como a Pecsil trabalha: procure os procedimentos nos documentos do setor antes de responder como é feito aqui.
O módulo cresce por seções. Hoje existe: ${SECOES.map((s) => s.nome).join(", ")}, e Regras (tipos de não conformidade e gravidade, de quem aprova). As inspeções da Forja ficam em Produção › Qualidade. Plano de ação e tratamento ainda não estão na plataforma: se perguntarem, diga que virão.
${SECOES.map((s) => `\n${s.texto}`).join("\n")}

Quem decide: a área de Qualidade (tipos, gravidade, como tratar). Se a lista de tipos estiver como provisória, use-a normalmente.`;

export const qualidade: Agente = {
  sara: {
    modulo: M, nome: "SARA da Qualidade", rotulo: "Qualidade", feature: M, permissao: "qualidade.sara", manual: MANUAL,
    ferramentas: SECOES.flatMap((s) => s.ferramentas.map((f) => f.nome)), telas: SECOES.flatMap((s) => s.telas),
    sugestoes: ["Quero registrar uma não conformidade", "Quais não conformidades estão abertas?", "O que mais se repete nos últimos 90 dias?", "O que é um 8D?"],
    // Julgar foto e descrição pede o modelo mais capaz; o volume é baixo (plano de 30/10/2026).
    modelo: "claude-sonnet-5-5", maxTokens: 2000,
    guardaFotos: "qualidade.nao_conformidades",
    fotoSemTexto: "Mandei esta foto. Diga o que você vê e me pergunte o que precisa para registrar.",
  },
  ferramentas: SECOES.flatMap((s) => s.ferramentas), regras: SECOES.flatMap((s) => s.regras),
};
