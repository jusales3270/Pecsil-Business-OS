import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { ambienteLiberado, auditar, autorDaSessao, protocoloDeTreino } from "../../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FAIXA_MAX = 1000;

/**
 * Inutilizar uma faixa de números que não vai ser usada (pulo na numeração). Quem aprova.
 * Número de nota autorizada ou cancelada não pode ser inutilizado.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "aprovar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { ambiente?: string; serie?: unknown; inicio?: unknown; fim?: unknown; texto?: string } | null;
  const ambiente = corpo?.ambiente ?? "treino";
  if (!ambienteLiberado(ambiente)) return NextResponse.json({ error: "Ambiente ainda não liberado." }, { status: 400 });
  const serie = Number(corpo?.serie);
  const inicio = Number(corpo?.inicio);
  const fim = Number(corpo?.fim ?? corpo?.inicio);
  const texto = String(corpo?.texto ?? "").trim();
  if (!Number.isInteger(serie) || serie < 0 || serie > 999) return NextResponse.json({ error: "Série entre 0 e 999." }, { status: 400 });
  if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < 1 || fim < inicio || fim > 999_999_999) return NextResponse.json({ error: "Faixa de números inválida." }, { status: 400 });
  if (fim - inicio + 1 > FAIXA_MAX) return NextResponse.json({ error: `No máximo ${FAIXA_MAX} números por vez.` }, { status: 400 });
  if (texto.length < 15) return NextResponse.json({ error: "A justificativa precisa ter ao menos 15 caracteres (regra da SEFAZ)." }, { status: 400 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: usadas } = await admin.from("fiscal_nfe").select("numero").eq("organization_id", autor.org).eq("ambiente", ambiente).eq("serie", serie)
    .gte("numero", inicio).lte("numero", fim).in("situacao", ["autorizada", "cancelada"]).limit(5);
  if (usadas?.length) {
    return NextResponse.json({ error: `O número ${usadas.map((u) => u.numero).join(", ")} já tem nota autorizada: não pode ser inutilizado.` }, { status: 409 });
  }
  const { data: jaFeitas } = await admin.from("fiscal_nfe_eventos").select("numero_inicio, numero_fim").eq("organization_id", autor.org).eq("ambiente", ambiente)
    .eq("tipo", "inutilizacao").eq("serie", serie).lte("numero_inicio", fim).gte("numero_fim", inicio).limit(1);
  if (jaFeitas?.length) return NextResponse.json({ error: `Parte da faixa já foi inutilizada (${jaFeitas[0].numero_inicio} a ${jaFeitas[0].numero_fim}).` }, { status: 409 });
  const protocolo = protocoloDeTreino();
  const { error } = await admin.from("fiscal_nfe_eventos").insert({
    organization_id: autor.org, ambiente, tipo: "inutilizacao", texto: texto.slice(0, 255), serie, numero_inicio: inicio, numero_fim: fim, protocolo,
    created_by: autor.profileId, created_by_name: autor.nome,
  });
  if (error) return NextResponse.json({ error: "Não foi possível registrar a inutilização." }, { status: 400 });
  // Rascunhos que estavam com esses números perdem o número (ganham outro na próxima validação).
  await admin.from("fiscal_nfe").update({ numero: null, chave: null, codigo_numerico: null, xml: null, situacao: "rascunho", validacao: null })
    .eq("organization_id", autor.org).eq("ambiente", ambiente).eq("serie", serie).gte("numero", inicio).lte("numero", fim)
    .in("situacao", ["rascunho", "validada", "aguardando_aprovacao", "rejeitada"]);
  await auditar(admin, { ...autor, evento: "inutilizacao", nfeId: null, dados: { ambiente, serie, inicio, fim, protocolo } });
  return NextResponse.json({ ok: true, protocolo });
}
