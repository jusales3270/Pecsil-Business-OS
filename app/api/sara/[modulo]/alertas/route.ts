import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../lib/auth/session-access";
import { NOVIDADES, novidadesPara } from "../../../../../lib/novidades";
import { acoesDaSara } from "../../../../../lib/sara/acoes";
import { alertasDo, type Alerta } from "../../../../../lib/sara/alertas";
import { SARAS } from "../../../../../lib/sara/modulos";
import { agoraSP } from "../../../../../lib/sara/tempo";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Avisos da SARA de um módulo (proprietário, 18/10/2026). GET: os avisos de agora para a pessoa
 * (calculados dos dados, com a sessão dela), cada um dizendo se ela já viu. POST: marca como vistos
 * os que ela acabou de ver na janela da SARA. Mesma regra de acesso da SARA (módulo + `<modulo>.sara`).
 */
async function acesso(modulo: string) {
  const sara = SARAS[modulo];
  if (!sara) return { erro: NextResponse.json({ error: "Este módulo ainda não tem SARA." }, { status: 404 }) } as const;
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  if (!access.canModule(sara.feature) || !access.can(sara.permissao, "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { sb: session.supabase, access } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const a = await acesso(modulo);
  if ("erro" in a) return a.erro;
  const novidades = novidadesPara(NOVIDADES, { isOwner: a.access.isOwner, grants: a.access.grants })
    .filter((n) => n.modulos?.includes(modulo)).map((n) => ({ id: n.id, data: n.data, titulo: n.titulo }));
  const [alertas, { data: vistos }] = await Promise.all([
    alertasDo(modulo, a.sb, { pode: (f) => a.access.can(f, "ver"), hoje: agoraSP().dia, novidades }),
    a.sb.from("sara_alertas_vistos").select("chave").like("chave", `${modulo}.%`).limit(1000),
  ]);
  const visto = new Set(((vistos ?? []) as { chave: string }[]).map((v) => v.chave));
  // Degrau 3: a ação pronta só vai para quem tem o nível dela; a entrada fica no servidor (o toque refaz o cálculo).
  const podeFazer = new Set(acoesDaSara(modulo, (f, nivel) => a.access.can(f, nivel)).map((f) => f.nome));
  return NextResponse.json({ alertas: alertas.map(({ propor, ...x }: Alerta) => ({ ...x, visto: visto.has(x.chave),
    ...(propor && podeFazer.has(propor.ferramenta) ? { propor: { rotulo: propor.rotulo } } : {}) })) });
}

export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const a = await acesso(modulo);
  if ("erro" in a) return a.erro;
  const corpo = (await request.json().catch(() => null)) as { alertas?: { chave?: string; nivel?: string }[] } | null;
  const lista = (corpo?.alertas ?? []).filter((x) => typeof x?.chave === "string" && x.chave.startsWith(`${modulo}.`) && (x.nivel === "urgente" || x.nivel === "aviso")).slice(0, 100);
  if (!lista.length) return NextResponse.json({ ok: true, marcados: 0 });
  const { data, error } = await a.sb.rpc("sara_alertas_marcar", { p_alertas: lista });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, marcados: data ?? 0 });
}
