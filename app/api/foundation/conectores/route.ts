import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { DEGRAU, hashDoSegredo, novoSegredo, situacaoDaFonte, TIPOS, validarFonte, validarObjetos } from "../../../../lib/conector/regras";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fundação › Conectores (docs/PLANO-CONECTOR.md): as fontes de dados de fora (ERP, banco antigo, pasta). Só o
 * proprietário. GET: as fontes com a situação, a descoberta, os objetos, as últimas remessas, o que já chegou por
 * objeto e a fila do de-para; GET ?fonte=&objeto=: amostra dos registros. POST: criar (o segredo aparece UMA vez),
 * trocar o segredo, salvar objetos, pedir descoberta, ativar/desativar, remover, sugerir e decidir de-para.
 * Tudo na auditoria; o segredo nunca é gravado (só o hash).
 */
const UUID = /^[0-9a-f-]{36}$/i;

async function dono() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.isOwner) return { erro: NextResponse.json({ error: "Os conectores são do proprietário." }, { status: 403 }) } as const;
  return { sb: session.supabase as SupabaseClient } as const;
}

async function auditar(sb: SupabaseClient, evento: string, metadata: Record<string, unknown>) {
  try {
    const { data: perfil } = await sb.rpc("current_profile_id");
    const { data: p } = perfil ? await sb.from("profiles").select("id, organization_id, user_id").eq("id", perfil).maybeSingle() : { data: null };
    if (!p) return;
    const { error } = await createSupabaseAdminClient().from("audit_logs").insert({ organization_id: p.organization_id, actor_user_id: p.user_id, actor_profile_id: p.id,
      module_code: "core.conector", event_type: evento, entity_type: "conector_fonte", entity_id: typeof metadata.fonte === "string" && UUID.test(metadata.fonte) ? metadata.fonte : null, risk_level: "monitored", metadata });
    if (error) console.error("[conector] auditoria", error.message);
  } catch (e) { console.error("[conector] auditoria", e instanceof Error ? e.message : e); }
}

type Linha = { id: string; nome: string; sistema: string | null; tipo: string; degrau: number; ativo: boolean; objetos: unknown[]; intervalo_min: number; descobrir: boolean;
  descoberta: { banco: unknown; tabelas: { nome: string; linhas: number | null; colunas: unknown[] }[]; em: string } | null; descoberta_em: string | null;
  ultimo_contato: string | null; versao_conector: string | null; ultimo_erro: string | null; created_at: string };

export async function GET(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const q = new URL(request.url).searchParams;
  const fonteId = q.get("fonte") ?? "";
  if (UUID.test(fonteId) && q.get("objeto")) {
    // Amostra do que chegou de um objeto (as 20 últimas alterações).
    const { data } = await d.sb.from("conector_registros").select("chave, dados, versao, primeira_vez, alterado_em").eq("fonte_id", fonteId).eq("objeto", q.get("objeto")).order("alterado_em", { ascending: false }).limit(20);
    return NextResponse.json({ registros: data ?? [] }, { headers: { "cache-control": "no-store" } });
  }
  const { data, error } = await d.sb.from("conector_fontes").select("id, nome, sistema, tipo, degrau, ativo, objetos, intervalo_min, descobrir, descoberta, descoberta_em, ultimo_contato, versao_conector, ultimo_erro, created_at").order("created_at");
  if (error) return NextResponse.json({ error: /conector_fontes/.test(error.message) && /does not exist|não existe/.test(error.message) ? "As tabelas do conector ainda não foram criadas (migração 202610250004)." : error.message }, { status: 500 });
  const fontes = (data ?? []) as Linha[];
  const ids = fontes.map((f) => f.id);
  const [{ data: lotes }, { data: depara }] = await Promise.all([
    ids.length ? d.sb.from("conector_lotes").select("fonte_id, tipo, objeto, recebidos, novos, alterados, iguais, erro, created_at").in("fonte_id", ids).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    ids.length ? d.sb.from("conector_depara").select("id, fonte_id, objeto, chave, entidade, destino_id, situacao, origem, motivo, decidido_por_nome").in("fonte_id", ids).eq("situacao", "sugerida").order("created_at").limit(200) : Promise.resolve({ data: [] }),
  ]);
  // O que já chegou por objeto (a contagem vem da função do banco seria melhor; aqui, por objeto configurado).
  const contagens = await Promise.all(fontes.flatMap((f) => (f.objetos as { nome: string }[]).map(async (o) => {
    const { count } = await d.sb.from("conector_registros").select("id", { count: "exact", head: true }).eq("fonte_id", f.id).eq("objeto", o.nome);
    return [`${f.id}:${o.nome}`, count ?? 0] as const;
  })));
  const porObjeto = new Map(contagens);
  // O nome do cadastro sugerido em cada de-para (para quem decide ver o que está ligando).
  type Dep = { fonte_id: string; entidade: string; destino_id: string };
  const deps = (depara ?? []) as Dep[];
  const TABELA: Record<string, [string, string]> = { fornecedor: ["suppliers", "name"], cliente: ["customers", "name"], material: ["materials", "descricao"], produto: ["products", "descricao"] };
  const nomes = new Map<string, string>();
  await Promise.all(Object.entries(TABELA).map(async ([ent, [tabela, campo]]) => {
    const alvo = [...new Set(deps.filter((x) => x.entidade === ent).map((x) => x.destino_id))];
    if (!alvo.length) return;
    const { data: linhas } = await d.sb.from(tabela).select(`id, ${campo}`).in("id", alvo.slice(0, 200));
    for (const l of (linhas ?? []) as unknown as Record<string, string>[]) nomes.set(l.id, l[campo]);
  }));
  return NextResponse.json({
    tipos: TIPOS, degraus: DEGRAU,
    fontes: fontes.map((f) => ({
      ...f, situacao: situacaoDaFonte(f),
      descoberta: f.descoberta ? { ...f.descoberta, tabelas: [...f.descoberta.tabelas].sort((a, b) => (b.linhas ?? -1) - (a.linhas ?? -1)) } : null,
      objetos: (f.objetos as { nome: string; consulta: string; chave: string[] }[]).map((o) => ({ ...o, registros: porObjeto.get(`${f.id}:${o.nome}`) ?? 0 })),
      lotes: ((lotes ?? []) as { fonte_id: string }[]).filter((l) => l.fonte_id === f.id).slice(0, 8),
      depara: deps.filter((x) => x.fonte_id === f.id).map((x) => ({ ...x, destino_nome: nomes.get(x.destino_id) ?? null })),
    })),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const e = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const acao = String(e.acao ?? "");
  const id = String(e.fonte ?? "");
  const admin = createSupabaseAdminClient();

  if (acao === "criar") {
    const v = validarFonte(e);
    if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
    const segredo = novoSegredo();
    const [{ data: org }, { data: eu }] = await Promise.all([d.sb.from("organizations").select("id").limit(1).single(), d.sb.rpc("current_profile_id")]);
    // O proprietário só lê as tabelas do conector (ninguém grava pela sessão): quem grava é o servidor.
    const { data, error } = await admin.from("conector_fontes").insert({ ...v, organization_id: org?.id, segredo_hash: hashDoSegredo(segredo), criado_por: eu }).select("id").single();
    if (error) return NextResponse.json({ error: /conector_fontes_nome_unico/.test(error.message) ? "Já existe uma fonte com esse nome." : error.message }, { status: 400 });
    await auditar(d.sb, "conector.fonte_criada", { fonte: data.id, nome: v.nome, tipo: v.tipo });
    return NextResponse.json({ ok: true, id: data.id, segredo });
  }

  if (!UUID.test(id)) return NextResponse.json({ error: "Fonte não encontrada." }, { status: 404 });
  const { data: f } = await d.sb.from("conector_fontes").select("id, nome, ativo").eq("id", id).maybeSingle();
  if (!f) return NextResponse.json({ error: "Fonte não encontrada." }, { status: 404 });
  const atualizar = async (campos: Record<string, unknown>, evento: string, meta: Record<string, unknown> = {}) => {
    const { error } = await admin.from("conector_fontes").update(campos).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, evento, { fonte: id, nome: f.nome, ...meta });
    return null;
  };

  if (acao === "novo_segredo") {
    const segredo = novoSegredo();
    const r = await atualizar({ segredo_hash: hashDoSegredo(segredo) }, "conector.segredo_trocado");
    return r ?? NextResponse.json({ ok: true, segredo });
  }
  if (acao === "salvar_objetos") {
    const v = validarObjetos(e.objetos);
    if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
    const intervalo = Math.round(Number(e.intervalo_min ?? 60));
    if (!Number.isFinite(intervalo) || intervalo < 5 || intervalo > 1440) return NextResponse.json({ error: "O intervalo vai de 5 a 1.440 minutos." }, { status: 400 });
    const r = await atualizar({ objetos: v.objetos, intervalo_min: intervalo }, "conector.objetos_salvos", { objetos: v.objetos.map((o) => o.nome), intervalo_min: intervalo });
    return r ?? NextResponse.json({ ok: true });
  }
  if (acao === "descobrir") return (await atualizar({ descobrir: true }, "conector.descoberta_pedida")) ?? NextResponse.json({ ok: true });
  if (acao === "ativar" || acao === "desativar") return (await atualizar({ ativo: acao === "ativar" }, `conector.fonte_${acao === "ativar" ? "ativada" : "desativada"}`)) ?? NextResponse.json({ ok: true });
  if (acao === "remover") {
    // Apaga a fonte e tudo o que chegou dela (registros, remessas e de-para), depois de confirmar na tela.
    const { error } = await admin.from("conector_fontes").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, "conector.fonte_removida", { fonte: id, nome: f.nome });
    return NextResponse.json({ ok: true });
  }
  if (acao === "sugerir") {
    const { data, error } = await d.sb.rpc("conector_depara_sugerir", { p_fonte: id, p_objeto: String(e.objeto ?? ""), p_campo: String(e.campo ?? ""), p_entidade: String(e.entidade ?? "") });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    await auditar(d.sb, "conector.depara_sugerido", { fonte: id, objeto: e.objeto, campo: e.campo, entidade: e.entidade, novas: data });
    return NextResponse.json({ ok: true, novas: data });
  }
  if (acao === "decidir") {
    const dep = String(e.depara ?? "");
    if (!UUID.test(dep)) return NextResponse.json({ error: "De-para não encontrado." }, { status: 404 });
    const { error } = await d.sb.rpc("conector_depara_decidir", { p_id: dep, p_aprovar: e.aprovar === true, p_destino: null, p_motivo: e.motivo ? String(e.motivo).slice(0, 300) : null });
    return error ? NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 }) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
