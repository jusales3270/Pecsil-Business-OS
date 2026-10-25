import { NextResponse } from "next/server";
import { lerDescoberta, segredoConfere } from "../../../../../lib/conector/regras";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Rota do serviço conector (docs/PLANO-CONECTOR.md). O conector se identifica pela fonte (`x-conector-fonte`) e pelo
 * segredo dela (`Authorization: Bearer …`); o banco guarda só o hash. Fonte ou segredo errado: 404, como se a rota
 * não existisse. GET tarefa: o que fazer agora. POST descoberta: o esquema da origem. POST lote: registros de um
 * objeto (até 1.000), gravados pela função do banco (uma vez só por sha256). POST erro: o que falhou do lado dele.
 */
const UUID = /^[0-9a-f-]{36}$/i;
const nada = () => new NextResponse(null, { status: 404 });
type Fonte = { id: string; organization_id: string; nome: string; tipo: string; ativo: boolean; segredo_hash: string; objetos: unknown[]; intervalo_min: number; descobrir: boolean };

async function fonte(request: Request): Promise<Fonte | null> {
  const id = request.headers.get("x-conector-fonte") ?? "";
  const segredo = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!UUID.test(id) || !segredo) return null;
  const { data } = await createSupabaseAdminClient().from("conector_fontes").select("id, organization_id, nome, tipo, ativo, segredo_hash, objetos, intervalo_min, descobrir").eq("id", id).maybeSingle<Fonte>();
  return data && segredoConfere(segredo, data.segredo_hash) ? data : null;
}
const versao = (r: Request) => (r.headers.get("x-conector-versao") ?? "").replace(/[^\w.+-]/g, "").slice(0, 40) || null;

export async function GET(request: Request, context: { params: Promise<{ acao: string }> }) {
  const { acao } = await context.params;
  const f = await fonte(request);
  if (!f || acao !== "tarefa") return nada();
  await createSupabaseAdminClient().from("conector_fontes").update({ ultimo_contato: new Date().toISOString(), versao_conector: versao(request) }).eq("id", f.id);
  // Fonte desativada: o conector fica parado (sem extrair nada) até ser ativada de novo.
  return NextResponse.json({ fonte: { nome: f.nome, tipo: f.tipo }, ativo: f.ativo, descobrir: f.ativo && f.descobrir, objetos: f.ativo ? f.objetos : [], intervalo_min: f.intervalo_min }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ acao: string }> }) {
  const { acao } = await context.params;
  const f = await fonte(request);
  if (!f || !["descoberta", "lote", "erro"].includes(acao)) return nada();
  if (!f.ativo) return NextResponse.json({ error: "Fonte desativada." }, { status: 409 });
  const tamanho = Number(request.headers.get("content-length") ?? 0);
  if (tamanho > 8_000_000) return NextResponse.json({ error: "Lote grande demais (até 8 MB)." }, { status: 413 });
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const admin = createSupabaseAdminClient();

  if (acao === "descoberta") {
    const d = lerDescoberta(corpo.descoberta);
    if ("erro" in d) return NextResponse.json({ error: d.erro }, { status: 400 });
    await admin.from("conector_fontes").update({ descoberta: d, descoberta_em: d.em, descobrir: false, ultimo_contato: d.em, ultimo_erro: null, versao_conector: versao(request) }).eq("id", f.id);
    await admin.from("conector_lotes").insert({ organization_id: f.organization_id, fonte_id: f.id, tipo: "descoberta", recebidos: d.tabelas.length });
    return NextResponse.json({ ok: true, tabelas: d.tabelas.length });
  }
  if (acao === "erro") {
    const erro = String(corpo.erro ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || "Erro sem descrição.";
    await admin.from("conector_fontes").update({ ultimo_erro: erro, ultimo_contato: new Date().toISOString() }).eq("id", f.id);
    return NextResponse.json({ ok: true });
  }
  // Lote: o objeto tem de estar entre os configurados, com a mesma chave (o conector não inventa objeto).
  const objeto = String(corpo.objeto ?? "");
  const conf = (f.objetos as { nome: string; chave: string[] }[]).find((o) => o.nome === objeto);
  if (!conf) return NextResponse.json({ error: "Objeto não configurado nesta fonte." }, { status: 400 });
  if (!Array.isArray(corpo.registros) || corpo.registros.length > 1000) return NextResponse.json({ error: "Mande de 0 a 1.000 registros por lote." }, { status: 400 });
  const { data, error } = await admin.rpc("conector_receber", { p_fonte: f.id, p_objeto: objeto, p_chave: conf.chave, p_registros: corpo.registros });
  if (error) return NextResponse.json({ error: error.message.slice(0, 300) }, { status: 400 });
  return NextResponse.json(data);
}
