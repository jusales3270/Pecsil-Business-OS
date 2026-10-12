import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { rodadaDistribuicao, type ResultadoRodada } from "../../../../../lib/fiscal/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Rodada agendada das Notas recebidas: para cada organização com a busca ligada, consulta a
 * distribuição de documentos da SEFAZ (respeitando a hora de espera de cada uma).
 *
 * Quem chama é a tarefa agendada do Coolify, de dentro do contêiner, a cada 15 minutos:
 * `node scripts/fiscal-dfe-cron.mjs`. Sem sessão de usuário, usa a chave de serviço; por isso
 * exige segredo próprio (`FISCAL_DFE_SECRET`, 16+ caracteres), comparado sem vazar tempo.
 * A resposta traz só contagens.
 */
function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FISCAL_DFE_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.FISCAL_DFE_SECRET?.trim()) {
    return NextResponse.json({ error: "FISCAL_DFE_SECRET não configurado." }, { status: 503 });
  }
  if (!segredoConfere(request.headers.get("x-fiscal-secret"))) {
    return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const { data: orgs, error } = await admin.from("fiscal_config").select("organization_id").eq("dfe_ativo", true);
  if (error) return NextResponse.json({ error: "Falha ao ler a configuração fiscal." }, { status: 500 });
  const rodadas: (ResultadoRodada | { organizacao: string; erro: string })[] = [];
  for (const { organization_id: org } of orgs ?? []) {
    try {
      rodadas.push(await rodadaDistribuicao(admin, org, { prazoMs: 40_000 }));
    } catch (e) {
      // A rodada já gravou o erro (e a hora de espera) na configuração da organização.
      rodadas.push({ organizacao: org, erro: e instanceof Error ? e.message.slice(0, 200) : "falha" });
    }
  }
  return NextResponse.json({ organizacoes: rodadas.length, rodadas });
}
