import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { EVENT_CATALOG } from "../../modules/event-catalog";
import { readSessionAccess } from "../auth/session-access";
import { requireUserSession } from "../supabase/session";
import { acoesDaSara } from "./acoes";
import { CALCULAR } from "./calcular";
import { consultarDados } from "./consulta-dados";
import { ferramentaDeDocumentos } from "./documentos";
import { LACUNA, ferramentaDeTelas, ferramentasDaSara } from "./ferramentas";
import { PROPOR_HABILIDADE, habilidadesQuePode, type HabilidadeAtiva } from "./habilidades";
import { ferramentaCriarGuia } from "./guias";
import { SARAS } from "./modulos";
import { MOSTRAR } from "./visual";
import { PERIODO } from "./periodo";
import { conversar } from "./claude";
import { regrasDeEscopo } from "./escopo";
import { regrasDaSara } from "./modulos";
import { instrucoesDeHabilidades } from "./habilidades";
import { contextoDeTempo, primeiroNome, situacaoDaConversa } from "./tempo";
import { FORA_DA_SUBAGENTE, REGRA_SUBAGENTE, ferramentaPerguntarASara, type Rodar, type UsoSubagente } from "./central/subagente";
import type { Ferramenta } from "./base";

/**
 * Sessão da SARA de um módulo: a pessoa precisa ter o módulo e a SARA liberada (`<modulo>.sara`).
 * Monta as ferramentas que ela pode usar (consultas no nível "ver"; ações no nível que cada uma exige)
 * e as habilidades aprovadas. Usada pela conversa e pela decisão das ações.
 */
export async function preparar(modulo: string) {
  if (!SARAS[modulo]) return { erro: NextResponse.json({ error: "Este módulo ainda não tem SARA." }, { status: 404 }) } as const;
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  return prepararCom(session.supabase, modulo);
}

/**
 * O mesmo, com uma sessão já aberta: a guia (E3) roda com a sessão de quem a criou, aberta pelo servidor
 * (lib/sara/guias-executar.ts). As permissões são as dela, conferidas aqui e em cada consulta.
 */
export async function prepararCom(sb: SupabaseClient, modulo: string) {
  const sara = SARAS[modulo];
  if (!sara) return { erro: NextResponse.json({ error: "Este módulo ainda não tem SARA." }, { status: 404 }) } as const;
  const session = { supabase: sb };
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  // Sem acesso ao módulo, ou sem a SARA liberada para a pessoa (Pessoas e Acessos), sem a SARA.
  if (!access.canModule(sara.feature) || !access.can(sara.permissao, "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  // Modelo e teto mensal: só no servidor (proteção de custo), sem aparecer na tela.
  const { data: linha } = await session.supabase.from("sara_modulos").select("modelo, teto_tokens_mes").eq("modulo", modulo).maybeSingle();
  const cfg = { modelo: linha?.modelo ?? sara.modelo ?? "claude-haiku-5-5", teto_tokens_mes: linha?.teto_tokens_mes ?? 2_000_000 };
  const telas = sara.telas.filter((t) => t.exige.some((f) => access.can(f, "ver")));
  const navegar = ferramentaDeTelas(telas);
  // Leitura do Segundo Cérebro: os documentos do setor, se a pessoa pode vê-los.
  const documentos = ferramentaDeDocumentos(modulo, (f) => access.can(f, "ver"));
  // Consultas do módulo, as de outros módulos que a pessoa pode ver e a consulta direta às tabelas.
  const pode = (f: string) => access.can(f, "ver");
  // SARA central (E7): não consulta direto; pergunta às SARAs dos módulos que a pessoa pode usar.
  if (sara.central) {
    const areas = Object.values(SARAS).filter((x) => !x.central && access.canModule(x.feature) && access.can(x.permissao, "ver"));
    const subagentes: UsoSubagente[] = [];
    const ferramentas: Ferramenta[] = [ferramentaPerguntarASara(areas, rodarSubagente, subagentes), CALCULAR, PERIODO];
    return { sara, sb: session.supabase, access, cfg, ferramentas, habilidades: [] as HabilidadeAtiva[], eventos: [] as { tipo: string; rotulo: string }[], subagentes } as const;
  }
  const dados = consultarDados(pode, modulo);
  // Ações (E1): só preparam; quem executa é a pessoa, no cartão "Permitir".
  const acoes = acoesDaSara(modulo, (f, nivel) => access.can(f, nivel));
  // Guias (E3): a pessoa pode pedir uma rotina; os acontecimentos são os dos módulos que ela acessa.
  const eventos = EVENT_CATALOG.filter((e) => e.module !== "sara" && access.canModule(e.module)).map((e) => ({ tipo: e.type, rotulo: e.label }));
  const ferramentas = [...ferramentasDaSara(pode, sara.ferramentas), ...(dados ? [dados] : []), CALCULAR, PERIODO, ...(documentos ? [documentos] : []), ...(navegar ? [navegar] : []), ...acoes, LACUNA, PROPOR_HABILIDADE, ferramentaCriarGuia(eventos), MOSTRAR];
  // Habilidades aprovadas pelo proprietário: só as que a pessoa consegue rodar com as consultas dela.
  const { data: hab } = await session.supabase.rpc("sara_habilidades_ativas", { p_modulo: modulo });
  const habilidades = habilidadesQuePode((hab ?? []) as HabilidadeAtiva[], ferramentas.map((f) => f.nome));
  return { sara, sb: session.supabase, access, cfg, ferramentas, habilidades, eventos, subagentes: [] as UsoSubagente[] } as const;
}

/**
 * A SARA de um módulo respondendo à SARA central (subagente), com a MESMA sessão de quem perguntou: o
 * manual, as regras e o escopo do módulo, sem agir, navegar nem propor (isso é da central e da pessoa).
 */
async function rodarSubagente(sb: SupabaseClient, modulo: string, pergunta: string): ReturnType<Rodar> {
  const p = await prepararCom(sb, modulo);
  if ("erro" in p) throw new Error("sem permissão para a SARA desta área");
  const [{ data: eu }, { data: org }] = await Promise.all([
    sb.rpc("current_profile_id").then(async (r) => (r.data ? sb.from("profiles").select("full_name").eq("id", r.data).maybeSingle() : { data: null })),
    sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
  ]);
  const empresa = org?.display_name || org?.legal_name || "empresa";
  const sistema = {
    fixo: `${p.sara.manual}\n\n${regrasDaSara(p.sara)}\n\n${regrasDeEscopo(empresa, p.sara.rotulo, null)}${p.habilidades.length ? `\n\n${instrucoesDeHabilidades(p.habilidades)}` : ""}`,
    variavel: `${contextoDeTempo({ nome: primeiroNome(eu?.full_name), situacao: situacaoDaConversa(null) })}\n${REGRA_SUBAGENTE}\nResponda sempre em português do Brasil.`,
  };
  const ferramentas = p.ferramentas.filter((f: Ferramenta) => !f.acao && !FORA_DA_SUBAGENTE.has(f.nome));
  const r = await conversar(p.sb, { modelo: p.cfg.modelo, sistema, historico: [], pergunta, ferramentas, maxTokens: p.sara.maxTokens });
  return {
    texto: r.texto, fontes: r.fontes, consultas: r.ferramentas.filter((f) => f.ok).map((f) => ferramentas.find((x) => x.nome === f.nome)?.rotulo ?? f.nome),
    uso: { modulo, modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida, cacheLido: r.cacheLido, cacheGravado: r.cacheGravado, ok: true },
  };
}

