import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { conferirArquivo, lerEnvioAcervo } from "../../../../../lib/fundicao/biblioteca-regras";
import { apagarArquivos, guardarAcervo, sha256 } from "../../../../../lib/fundicao/biblioteca-servidor";

export const dynamic = "force-dynamic";

/** As funções da Biblioteca já falam com a pessoa ("Só quem escreveu…"): a mensagem vai à tela, também no 42501. */
const erroDoBanco = (error: { code?: string; message: string }) =>
  error.code === "42501" ? NextResponse.json({ error: error.message }, { status: 403 }) : dbError(error);

/**
 * Desenho antigo da pasta física (escaneado) para a Biblioteca. O mesmo arquivo não entra duas
 * vezes: se já está na Biblioteca, a resposta diz em qual peça.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "operar");
  if ("error" in guard) return guard.error;
  const { supabase } = guard;
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envio inválido." }, { status: 400 });
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Escolha o arquivo do desenho." }, { status: 400 });
  const conferido = conferirArquivo(arquivo);
  if (!conferido.ok) return NextResponse.json({ error: conferido.erro }, { status: 400 });
  const lido = lerEnvioAcervo(form);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });

  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const hash = sha256(dados);
  const { data: igual } = await supabase.from("fundicao_desenho_arquivos").select("desenho_id, fundicao_desenhos(artigo_codigo)").eq("sha256", hash).limit(1).maybeSingle();
  if (igual) {
    const peca = (igual as { fundicao_desenhos?: { artigo_codigo?: string } | null }).fundicao_desenhos?.artigo_codigo;
    return NextResponse.json({ existente: true, id: igual.desenho_id, artigo: peca ?? null }, { status: 409 });
  }
  const { data: org, error: eOrg } = await supabase.rpc("current_organization_id");
  if (eOrg || !org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 403 });

  let caminho: string;
  try {
    caminho = await guardarAcervo(String(org), hash, conferido.ext, dados, conferido.mime);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Não foi possível guardar o arquivo." }, { status: 503 });
  }
  const { data, error } = await supabase.rpc("fundicao_acervo_registrar", {
    p: { ...lido.dados, sha256: hash, storage_path: caminho, mime: conferido.mime, tamanho: dados.byteLength, nome: arquivo.name || `desenho.${conferido.ext}` },
  });
  if (error) {
    await apagarArquivos([caminho]);
    return erroDoBanco(error);
  }
  const r = data as { existente: boolean; id: string; artigo_codigo: string };
  if (r.existente) return NextResponse.json({ existente: true, id: r.id, artigo: r.artigo_codigo }, { status: 409 });
  return NextResponse.json({ existente: false, id: r.id, artigo: r.artigo_codigo });
}

/** Apaga um desenho antigo enviado por engano (o próprio envio, ou o proprietário). */
export async function DELETE(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "operar");
  if ("error" in guard) return guard.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Desenho não informado." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("fundicao_acervo_apagar", { p_id: id });
  if (error) return erroDoBanco(error);
  await apagarArquivos((data as string[] | null) ?? []);
  return NextResponse.json({ ok: true });
}
