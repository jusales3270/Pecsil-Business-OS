import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { TERMO_VERSAO, termoDoPortal } from "../../../../lib/fiscal/portal-termo";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MES = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Portal do escritório de contabilidade (Fiscal). Os dois lados usam esta rota:
 *   empresa    — o dono ou quem tem "Escritório contábil";
 *   escritorio — quem tem "Portal do contador" (conta de terceiro do escritório).
 * Quem decide o lado e o que cada um pode fazer é o banco (fiscal_portal_lado / fiscal_portal_exigir);
 * o escritório só vê o portal e os TOTAIS do mês, nunca as linhas dos módulos.
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const sb = guard.supabase;
  const mesParam = new URL(request.url).searchParams.get("mes") ?? "";
  const mes = MES.test(mesParam) ? mesParam : new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const dia = `${mes}-01`;

  const { data: lado } = await sb.rpc("fiscal_portal_lado");
  if (!lado) return NextResponse.json({ error: "Sem acesso ao portal do escritório." }, { status: 403 });

  if (lado === "escritorio") {
    const { data: aceite } = await sb.from("fiscal_portal_aceites").select("aceito_em").eq("versao", TERMO_VERSAO).maybeSingle();
    if (!aceite) {
      // Nome da empresa: a razão social da Configuração fiscal; sem ela, o cadastro da organização.
      const { data: org } = await sb.rpc("current_organization_id");
      const admin = createSupabaseAdminClient();
      const [{ data: fiscal }, { data: empresa }] = await Promise.all([
        admin.from("fiscal_config").select("razao_social").eq("organization_id", org).maybeSingle(),
        admin.from("organizations").select("legal_name, display_name").eq("id", org).maybeSingle(),
      ]);
      const nome = fiscal?.razao_social || empresa?.legal_name || empresa?.display_name || "a empresa";
      return NextResponse.json({ lado, precisaAceite: true, termo: { versao: TERMO_VERSAO, itens: termoDoPortal(nome) } });
    }
    await sb.rpc("fiscal_portal_registrar_acesso", { p_mes: dia });
  }

  const [{ data: competencias }, { data: competencia }, { data: indicadores, error: eInd }] = await Promise.all([
    sb.from("fiscal_competencias").select("id, competencia, situacao").order("competencia", { ascending: false }).limit(24),
    sb.from("fiscal_competencias").select("*").eq("competencia", dia).maybeSingle(),
    sb.rpc("fiscal_portal_indicadores", { p_mes: dia }),
  ]);
  if (eInd) return NextResponse.json({ error: eInd.message }, { status: 400 });

  const compId = competencia?.id ?? null;
  const [{ data: itens }, { data: malotes }, { data: pendencias }] = await Promise.all([
    compId ? sb.from("fiscal_competencia_itens").select("*").eq("competencia_id", compId).order("ordem") : Promise.resolve({ data: [] }),
    compId ? sb.from("fiscal_malotes").select("*").eq("competencia_id", compId).order("numero") : Promise.resolve({ data: [] }),
    // Pendências: todas as abertas, mais as resolvidas desta competência.
    compId
      ? sb.from("fiscal_pendencias").select("*").or(`situacao.neq.resolvida,competencia_id.eq.${compId}`).order("updated_at", { ascending: false }).limit(100)
      : sb.from("fiscal_pendencias").select("*").neq("situacao", "resolvida").order("updated_at", { ascending: false }).limit(100),
  ]);
  const idsPend = (pendencias ?? []).map((p) => p.id);
  const [{ data: mensagens }, { data: anexos }] = await Promise.all([
    idsPend.length ? sb.from("fiscal_pendencia_mensagens").select("id, pendencia_id, lado, autor_nome, texto, created_at").in("pendencia_id", idsPend).order("created_at") : Promise.resolve({ data: [] }),
    compId || idsPend.length
      ? sb.from("fiscal_portal_anexos").select("id, document_id, competencia_id, pendencia_id, lado, nome, tamanho, enviado_por_nome, created_at")
        .or([compId ? `competencia_id.eq.${compId}` : "", idsPend.length ? `pendencia_id.in.(${idsPend.join(",")})` : ""].filter(Boolean).join(","))
        .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  return NextResponse.json({
    lado, precisaAceite: false, mes,
    podeOperar: lado === "escritorio" || guard.access.isOwner || guard.access.can("fiscal.escritorio", "operar"),
    competencias: competencias ?? [], competencia: competencia ?? null, itens: itens ?? [], indicadores,
    malotes: malotes ?? [], pendencias: pendencias ?? [], mensagens: mensagens ?? [], anexos: anexos ?? [],
  });
}

type Acao =
  | { acao: "aceitar"; versao: string }
  | { acao: "abrir"; mes: string }
  | { acao: "situacao"; competencia: string; situacao: string }
  | { acao: "item"; item: string; situacao: string; observacao?: string }
  | { acao: "malote"; competencia: string; enviadoEm?: string; conteudo: string; observacao?: string }
  | { acao: "receber"; malote: string; observacao?: string }
  | { acao: "pendencia"; competencia?: string | null; assunto: string; texto: string }
  | { acao: "responder"; pendencia: string; texto: string }
  | { acao: "resolver"; pendencia: string };

export async function POST(request: Request) {
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const a = (await request.json().catch(() => null)) as Acao | null;
  if (!a?.acao) return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  let chamada: { fn: string; args: Record<string, unknown> } | null = null;
  switch (a.acao) {
    case "aceitar": chamada = { fn: "fiscal_portal_aceitar", args: { p_versao: a.versao } }; break;
    case "abrir": if (MES.test(a.mes)) chamada = { fn: "fiscal_portal_competencia_abrir", args: { p_mes: `${a.mes}-01` } }; break;
    case "situacao": chamada = { fn: "fiscal_portal_situacao", args: { p_competencia: id(a.competencia), p_situacao: a.situacao } }; break;
    case "item": if (["pendente", "pronto", "nao_se_aplica"].includes(a.situacao)) chamada = { fn: "fiscal_portal_item", args: { p_item: id(a.item), p_situacao: a.situacao, p_observacao: texto(a.observacao, 300) || null } }; break;
    case "malote": if (texto(a.conteudo, 2000).length >= 2) chamada = { fn: "fiscal_portal_malote_registrar", args: { p_competencia: id(a.competencia), p_enviado_em: /^\d{4}-\d{2}-\d{2}$/.test(a.enviadoEm ?? "") ? a.enviadoEm : null, p_conteudo: texto(a.conteudo, 2000), p_observacao: texto(a.observacao, 500) || null } }; break;
    case "receber": chamada = { fn: "fiscal_portal_malote_receber", args: { p_malote: id(a.malote), p_observacao: texto(a.observacao, 500) || null } }; break;
    case "pendencia": if (texto(a.assunto, 160).length >= 3 && texto(a.texto, 4000)) chamada = { fn: "fiscal_portal_pendencia_abrir", args: { p_competencia: id(a.competencia), p_assunto: texto(a.assunto, 160), p_texto: texto(a.texto, 4000) } }; break;
    case "responder": if (texto(a.texto, 4000)) chamada = { fn: "fiscal_portal_pendencia_responder", args: { p_pendencia: id(a.pendencia), p_texto: texto(a.texto, 4000) } }; break;
    case "resolver": chamada = { fn: "fiscal_portal_pendencia_resolver", args: { p_pendencia: id(a.pendencia) } }; break;
  }
  if (!chamada) return NextResponse.json({ error: "Preencha os campos da ação." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc(chamada.fn, chamada.args);
  if (error) return NextResponse.json({ error: error.message || "Não foi possível concluir." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true, id: data ?? null });
}
