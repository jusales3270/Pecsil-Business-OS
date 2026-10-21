import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { sincronizarOrdens } from "../../../../lib/forja/sync-orders";
import { processarEnviosForja, type ResultadoEnvios } from "../../../../lib/forja/envio-os";
import { sincronizarDesenhos, type RelatorioDesenhos } from "../../../../lib/forja/sync-desenhos";

export const dynamic = "force-dynamic";

/**
 * Sincronização das OS do Forja (espelho) e do cliente único.
 *
 * POST — quem chama é a tarefa agendada do Coolify, de dentro do contêiner, a
 * cada 10 minutos: `curl -X POST -H "x-sync-secret: …" http://localhost:3000/api/producao/sync-os`.
 * Sem sessão de usuário, grava com a chave de serviço; por isso exige segredo
 * próprio (`FORJA_SYNC_SECRET`, 16+ caracteres), comparado sem vazar tempo.
 * `?simular=1` lê tudo e devolve o relatório sem gravar. A resposta traz só
 * contagens e nomes de cliente, nunca valores.
 *
 * GET — situação para a tela (Produção › Conexão Forja), com login e a
 * funcionalidade `producao.conexao`.
 */

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FORJA_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.FORJA_SYNC_SECRET?.trim()) {
    return NextResponse.json({ error: "FORJA_SYNC_SECRET não configurado." }, { status: 503 });
  }
  if (!segredoConfere(request.headers.get("x-sync-secret"))) {
    return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  }
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 });
  }
  const simular = new URL(request.url).searchParams.get("simular") === "1";
  // Antes do espelho: orçamentos ganhos viram OS em rascunho na Forja, reabertos cancelam, e o
  // catálogo de materiais vai junto. Falha aqui não impede o espelho.
  let envios: ResultadoEnvios | { erro: string } | null = null;
  if (!simular) {
    try { envios = await processarEnviosForja(admin); } catch (e) { envios = { erro: e instanceof Error ? e.message : String(e) }; }
  }
  const relatorio = await sincronizarOrdens(admin, { simular });
  // Depois do espelho: desenhos da Forja para a Biblioteca da Fundição. Falha aqui vira aviso.
  let desenhos: RelatorioDesenhos | { erro: string } | null = null;
  try {
    const { data: orgs, error } = await admin.from("organizations").select("id").limit(2);
    if (error) throw new Error(error.message);
    if (orgs?.length !== 1) throw new Error("A Biblioteca espera uma organização só.");
    desenhos = await sincronizarDesenhos(admin, String(orgs[0].id), { simular });
  } catch (e) {
    desenhos = { erro: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ ...relatorio, envios, desenhos }, { status: relatorio.erro ? 502 : 200 });
}

export async function GET() {
  const guard = await requireFeature("producao.conexao");
  if ("error" in guard) return guard.error;
  const { supabase } = guard;

  const [runs, total, semCliente, removidas] = await Promise.all([
    supabase.from("integration_sync_runs").select("mode, started_at, finished_at, ok, counts, error").eq("source", "forja").order("started_at", { ascending: false }).limit(10),
    supabase.from("production_orders").select("id", { count: "exact", head: true }).is("removed_from_source_at", null),
    supabase.from("production_orders").select("id", { count: "exact", head: true }).is("removed_from_source_at", null).is("customer_id", null),
    supabase.from("production_orders").select("id", { count: "exact", head: true }).not("removed_from_source_at", "is", null),
  ]);
  const falha = [runs, total, semCliente, removidas].find((r) => r.error);
  if (falha?.error) return dbError(falha.error);

  const rodadas = runs.data ?? [];
  const ultimaAplicada = rodadas.find((r) => r.mode === "apply" && r.ok);
  const response = NextResponse.json({
    ultimaSincronizacao: ultimaAplicada?.finished_at ?? null,
    ultimaRodada: rodadas[0] ?? null,
    ordens: total.count ?? 0,
    semCliente: semCliente.count ?? 0,
    removidasNoForja: removidas.count ?? 0,
    rodadas,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
