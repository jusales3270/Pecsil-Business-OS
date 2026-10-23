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
  const dados = consultarDados(pode, modulo);
  // Ações (E1): só preparam; quem executa é a pessoa, no cartão "Permitir".
  const acoes = acoesDaSara(modulo, (f, nivel) => access.can(f, nivel));
  // Guias (E3): a pessoa pode pedir uma rotina; os acontecimentos são os dos módulos que ela acessa.
  const eventos = EVENT_CATALOG.filter((e) => e.module !== "sara" && access.canModule(e.module)).map((e) => ({ tipo: e.type, rotulo: e.label }));
  const ferramentas = [...ferramentasDaSara(pode, sara.ferramentas), ...(dados ? [dados] : []), CALCULAR, PERIODO, ...(documentos ? [documentos] : []), ...(navegar ? [navegar] : []), ...acoes, LACUNA, PROPOR_HABILIDADE, ferramentaCriarGuia(eventos), MOSTRAR];
  // Habilidades aprovadas pelo proprietário: só as que a pessoa consegue rodar com as consultas dela.
  const { data: hab } = await session.supabase.rpc("sara_habilidades_ativas", { p_modulo: modulo });
  const habilidades = habilidadesQuePode((hab ?? []) as HabilidadeAtiva[], ferramentas.map((f) => f.nome));
  return { sara, sb: session.supabase, access, cfg, ferramentas, habilidades, eventos } as const;
}

