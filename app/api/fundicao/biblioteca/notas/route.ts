import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** As funções da Biblioteca já falam com a pessoa ("Só quem escreveu…"): a mensagem vai à tela, também no 42501. */
const erroDoBanco = (error: { code?: string; message: string }) =>
  error.code === "42501" ? NextResponse.json({ error: error.message }, { status: 403 }) : dbError(error);

type Corpo = { id?: string; artigo?: string; texto?: string };

/** Anotação da Fundição numa peça (vale para todas as revisões). Editar e apagar: só a própria. */
export async function POST(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as Corpo;
  const { data, error } = await guard.supabase.rpc("fundicao_nota_gravar", { p_id: null, p_artigo_codigo: b.artigo ?? "", p_texto: b.texto ?? "" });
  if (error) return erroDoBanco(error);
  return NextResponse.json({ nota: data });
}

export async function PATCH(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as Corpo;
  if (!b.id) return NextResponse.json({ error: "Anotação não informada." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("fundicao_nota_gravar", { p_id: b.id, p_artigo_codigo: null, p_texto: b.texto ?? "" });
  if (error) return erroDoBanco(error);
  return NextResponse.json({ nota: data });
}

export async function DELETE(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "operar");
  if ("error" in guard) return guard.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Anotação não informada." }, { status: 400 });
  const { error } = await guard.supabase.rpc("fundicao_nota_apagar", { p_id: id });
  if (error) return erroDoBanco(error);
  return NextResponse.json({ ok: true });
}
