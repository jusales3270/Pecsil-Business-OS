import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { normalizarNota } from "../../../../lib/fiscal/emissao/normalizar";
import { problemasDoEmitente } from "../../../../lib/fiscal/emissao/regras";
import { AMBIENTES_LIBERADOS, COLUNAS_CLIENTE, COLUNAS_LISTA, ambienteLiberado, auditar, autorDaSessao, clienteDaOrganizacao, emitenteDaOrganizacao, gravarNoCadastroDoCliente, resumoDaNota } from "../../../../lib/fiscal/emissao/servidor";
import { transmissorConfigurado } from "../../../../lib/fiscal/transmissor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Notas emitidas. Por ora só o ambiente TREINO: a nota é montada, validada (regras +
 * esquema oficial) e "autorizada" dentro da plataforma, sem nada ir à SEFAZ e sem valor fiscal.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "ver");
  if ("error" in guard) return guard.error;
  const ambiente = new URL(request.url).searchParams.get("ambiente") ?? "treino";
  if (!ambienteLiberado(ambiente)) return NextResponse.json({ error: "Ambiente ainda não liberado." }, { status: 400 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const [{ data: notas, error }, { data: usados }, { data: clientes }, emitente, { data: inutilizacoes }] = await Promise.all([
    guard.supabase.from("fiscal_nfe").select(COLUNAS_LISTA).eq("ambiente", ambiente).order("created_at", { ascending: false }).limit(300),
    // Destinatários já usados: a próxima nota para o mesmo cliente já vem com o endereço.
    guard.supabase.from("fiscal_nfe").select("destinatario:nota->destinatario, updated_at").order("updated_at", { ascending: false }).limit(200),
    admin.from("customers").select(COLUNAS_CLIENTE).eq("organization_id", autor.org).eq("active", true).is("merged_into", null).order("name").limit(1000),
    emitenteDaOrganizacao(admin, autor.org),
    guard.supabase.from("fiscal_nfe_eventos").select("id, serie, numero_inicio, numero_fim, texto, created_by_name, created_at").eq("ambiente", ambiente).eq("tipo", "inutilizacao").order("created_at", { ascending: false }).limit(50),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const destinatarios = new Map<string, unknown>();
  for (const u of usados ?? []) {
    const d = u.destinatario as { documento?: string; nome?: string } | null;
    if (d?.documento && d.nome && !destinatarios.has(d.documento)) destinatarios.set(d.documento, d);
  }
  return NextResponse.json({
    notas: notas ?? [],
    ambiente,
    ambientes: AMBIENTES_LIBERADOS,
    emitente: emitente ? { razaoSocial: emitente.razaoSocial, cnpj: emitente.cnpj, uf: emitente.uf, crt: emitente.crt } : null,
    problemasEmitente: problemasDoEmitente(emitente),
    destinatarios: [...destinatarios.values()],
    clientes: clientes ?? [],
    inutilizacoes: inutilizacoes ?? [],
    podeOperar: guard.access.can("fiscal.nfe", "operar"),
    podeAprovar: guard.access.can("fiscal.nfe", "aprovar"),
    transmissor: transmissorConfigurado(),
  });
}

/** Novo rascunho (quem opera). */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { ambiente?: string; nota?: unknown; customer_id?: string | null } | null;
  const ambiente = corpo?.ambiente ?? "treino";
  if (!ambienteLiberado(ambiente)) return NextResponse.json({ error: "Por enquanto só o ambiente de treino está liberado." }, { status: 400 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const nota = normalizarNota(corpo?.nota);
  const admin = createSupabaseAdminClient();
  const customer = await gravarNoCadastroDoCliente(admin, autor, await clienteDaOrganizacao(admin, autor.org, corpo?.customer_id), nota.destinatario);
  const { data, error } = await admin.from("fiscal_nfe").insert({
    organization_id: autor.org, ambiente, situacao: "rascunho", nota, ...resumoDaNota(nota), customer_id: customer,
    montada_por: autor.profileId, montada_por_nome: autor.nome,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Não foi possível criar a nota." }, { status: 400 });
  await auditar(admin, { ...autor, evento: "criada", nfeId: data.id, dados: { ambiente } });
  return NextResponse.json({ id: data.id, customer_id: customer });
}

/** Limpar o treino: apaga as notas, os eventos e a numeração do treino (quem aprova). */
export async function DELETE(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "aprovar");
  if ("error" in guard) return guard.error;
  if (new URL(request.url).searchParams.get("ambiente") !== "treino") {
    return NextResponse.json({ error: "Só as notas de treino podem ser apagadas." }, { status: 400 });
  }
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { count } = await admin.from("fiscal_nfe").select("id", { count: "exact", head: true }).eq("organization_id", autor.org).eq("ambiente", "treino");
  await admin.from("fiscal_nfe_eventos").delete().eq("organization_id", autor.org).eq("ambiente", "treino");
  await admin.from("fiscal_nfe").delete().eq("organization_id", autor.org).eq("ambiente", "treino");
  await admin.from("fiscal_nfe_numeracao").delete().eq("organization_id", autor.org).eq("ambiente", "treino");
  await auditar(admin, { ...autor, evento: "treino_limpo", nfeId: null, dados: { notas: count ?? 0 } });
  return NextResponse.json({ ok: true, apagadas: count ?? 0 });
}
