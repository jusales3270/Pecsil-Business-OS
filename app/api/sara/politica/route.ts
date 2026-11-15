import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { cotacao, emReais } from "../../../../lib/sara/custo";
import { CATALOGO } from "../../../../lib/sara/modelos";
import { NIVEIS, ROTULO_NIVEL } from "../../../../lib/sara/nivel";
import { ROTULO_TRABALHO, TRABALHOS, lerPolitica, linhaDaPolitica, validarPolitica } from "../../../../lib/sara/politica";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fundação › O que a SARA aprendeu › Modelos e esforço (I-32, 14/11/2026). A política de modelos é da EMPRESA: que
 * modelo e que esforço cada nível usa, o modo do roteador, quem pode a análise profunda, o teto do mês em reais e o
 * nível de cada trabalho fixo. GET: o proprietário e a Auditoria leem (com o catálogo, para a tela só oferecer o que
 * a API aceita). PUT: só o proprietário grava (pelo servidor, com auditoria do antes e do depois).
 */
async function sessao() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  if (!access.isOwner && !access.can("fundacao.auditoria", "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { sb: session.supabase, access } as const;
}

export async function GET() {
  const s = await sessao();
  if ("erro" in s) return s.erro;
  const politica = await lerPolitica(s.sb);
  const { data: custo } = await s.sb.rpc("sara_custo_mes");
  const cot = cotacao(process.env.SARA_COTACAO_USD);
  return NextResponse.json({
    politica, pode_gravar: s.access.isOwner,
    custo_mes_reais: custo == null ? null : emReais(Number(custo), cot),
    catalogo: CATALOGO.map((m) => ({ id: m.id, rotulo: m.rotulo, esforcos: m.esforcos, esforco_padrao: m.esforcoPadrao, preco: m.preco, exige_retencao: m.exigeRetencao })),
    niveis: NIVEIS.map((n) => ({ id: n, rotulo: ROTULO_NIVEL[n] })),
    // A Sentinela ainda não lê a política (o agendamento dela fica para um passo seguinte): não aparece para escolher.
    trabalhos: TRABALHOS.filter((t) => t !== "sentinela").map((t) => ({ id: t, rotulo: ROTULO_TRABALHO[t] })),
  });
}

export async function PUT(request: Request) {
  const s = await sessao();
  if ("erro" in s) return s.erro;
  if (!s.access.isOwner) return NextResponse.json({ error: "Só o proprietário muda a política de modelos." }, { status: 403 });
  const v = validarPolitica(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  const antes = await lerPolitica(s.sb);
  const { data: perfil } = await s.sb.rpc("current_profile_id");
  const { data: p } = perfil ? await s.sb.from("profiles").select("id, organization_id, user_id, full_name").eq("id", perfil).maybeSingle() : { data: null };
  if (!p) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("sara_politica_modelos").upsert({ organization_id: p.organization_id, ...linhaDaPolitica(v.politica), updated_at: new Date().toISOString(), updated_by_name: p.full_name ?? null });
  if (error) return NextResponse.json({ error: /does not exist|não existe/.test(error.message) ? "A tabela da política ainda não foi criada no banco (migração 202611140001)." : error.message }, { status: 500 });
  const { error: eAud } = await admin.from("audit_logs").insert({ organization_id: p.organization_id, actor_user_id: p.user_id, actor_profile_id: p.id, module_code: "core.sara",
    event_type: "sara.politica_modelos.alterada", entity_type: "sara_politica_modelos", entity_id: null, risk_level: "monitored", metadata: { antes, depois: v.politica } });
  if (eAud) console.error("[sara] auditoria da política", eAud.message);
  return NextResponse.json({ politica: v.politica });
}
