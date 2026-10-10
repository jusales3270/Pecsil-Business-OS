import { NextResponse } from "next/server";
import { exigirDocumentos, LIMITE_DOCUMENTO } from "../../../lib/documentos/acesso";
import { guardarOriginal } from "../../../lib/documentos/guardar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLUNAS = "id, module_code, feature_code, title, category, original_name, mime_type, size_bytes, version, previous_id, source, entity_type, entity_id, uploaded_by_name, created_at";

/**
 * Documentos dos setores (Fundação › Documentos). O banco (RLS) só entrega os documentos
 * dos setores que a pessoa vê. Por padrão, só a versão mais recente e não arquivada;
 * `historico=<id>` traz as versões anteriores daquele documento.
 */
export async function GET(request: Request) {
  const guard = await exigirDocumentos();
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  const setor = url.searchParams.get("setor") ?? "";
  const busca = (url.searchParams.get("busca") ?? "").trim();
  const historico = url.searchParams.get("historico");

  if (historico) {
    const versoes: Record<string, unknown>[] = [];
    let atual: string | null = historico;
    for (let i = 0; atual && i < 50; i++) {
      const resposta = await guard.supabase.from("company_documents").select(COLUNAS).eq("id", atual).maybeSingle();
      const linha = resposta.data as (Record<string, unknown> & { previous_id: string | null }) | null;
      if (!linha) break;
      versoes.push(linha);
      atual = linha.previous_id;
    }
    return NextResponse.json({ versoes });
  }

  let consulta = guard.supabase.from("company_documents").select(COLUNAS)
    .is("superseded_by", null).is("archived_at", null).order("created_at", { ascending: false }).limit(500);
  if (setor) consulta = consulta.eq("module_code", setor);
  if (busca) {
    const termo = busca.replace(/[%,()]/g, " ").slice(0, 80);
    consulta = consulta.or(`title.ilike.%${termo}%,original_name.ilike.%${termo}%,category.ilike.%${termo}%`);
  }
  const { data, error } = await consulta;
  if (error) {
    console.error("Falha ao listar documentos", error);
    return NextResponse.json({ error: "DOCUMENTOS_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    documentos: data ?? [],
    setores: guard.visiveis.map((s) => ({ modulo: s.modulo, rotulo: s.rotulo })),
    envio: guard.envio.map((s) => ({ modulo: s.modulo, rotulo: s.rotulo })),
    isOwner: guard.access.isOwner,
  });
}

/** Enviar um documento para um setor (multipart: arquivo, setor, titulo?, categoria?, entidadeTipo?, entidadeId?, origem?). */
export async function POST(request: Request) {
  const guard = await exigirDocumentos();
  if ("error" in guard) return guard.error;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const modulo = String(form?.get("setor") ?? "");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Escolha o arquivo." }, { status: 400 });
  if (arquivo.size > LIMITE_DOCUMENTO) return NextResponse.json({ error: "O arquivo passa de 9,5 MB." }, { status: 413 });
  const setor = guard.envio.find((s) => s.modulo === modulo);
  if (!setor) return NextResponse.json({ error: "Você não pode enviar documentos para este setor." }, { status: 403 });
  const origem = String(form?.get("origem") ?? "envio");
  const entidadeTipo = String(form?.get("entidadeTipo") ?? "").trim();
  const entidadeId = String(form?.get("entidadeId") ?? "").trim();
  try {
    const r = await guardarOriginal(guard.supabase, {
      modulo: setor.modulo,
      feature: setor.feature,
      arquivo: { nome: arquivo.name, tipo: arquivo.type, dados: new Uint8Array(await arquivo.arrayBuffer()) },
      origem: origem === "recebimento" || origem === "nota" ? origem : "envio",
      titulo: String(form?.get("titulo") ?? "").trim() || null,
      categoria: String(form?.get("categoria") ?? "").trim() || null,
      entidade: entidadeTipo && entidadeId ? { tipo: entidadeTipo.slice(0, 40), id: entidadeId.slice(0, 80) } : null,
    });
    return NextResponse.json({ ...r, mensagem: r.existente ? "Este arquivo já estava guardado neste setor." : "Documento guardado." }, { status: r.existente ? 200 : 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "42501") return NextResponse.json({ error: "Sem permissão para guardar documentos deste setor." }, { status: 403 });
    console.error("Falha ao guardar documento", e);
    return NextResponse.json({ error: err.code === "P0001" ? err.message : "Não foi possível guardar o documento." }, { status: 400 });
  }
}
