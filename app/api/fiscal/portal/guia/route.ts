import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { linhasDoPdf, PdfInvalido, textoDoPdf } from "../../../../../lib/arquivos/pdf-texto";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { sha256 } from "../../../../../lib/documentos/guardar";
import { caminhoDocumento } from "../../../../../lib/documentos/setores";
import { lerGuia, TIPOS_GUIA, valorDigitado, type TipoGuia } from "../../../../../lib/fiscal/guia-parser";
import { lerEGravar } from "../../../../../lib/leitura/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 15_000_000;
const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

async function textoDaGuia(dados: Uint8Array): Promise<string> {
  const paginas = await textoDoPdf(dados, 10);
  return paginas.flatMap((p) => linhasDoPdf(p).map((l) => l.map((i) => i.s).join(" "))).join("\n");
}

/**
 * Guia de imposto pelo portal do escritório (F-09). Os dois lados usam:
 *   acao=ler     — lê o PDF por regra (tipo, valor, vencimento, competência, linha digitável) e devolve
 *                  para quem envia conferir; nada é gravado;
 *   acao=enviar  — guarda o PDF e registra a guia, que vira conta a pagar EM APROVAÇÃO no Financeiro.
 * O arquivo sobe com a chave de serviço (o bucket não tem política para usuários) e o registro é feito
 * com a SESSÃO, que confere o lado e o aceite do termo; se o registro falhar, o arquivo é apagado.
 */
export async function POST(request: Request) {
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const acao = String(form?.get("acao") ?? "");
  if (!(arquivo instanceof File) || !arquivo.size) return NextResponse.json({ error: "Escolha o PDF da guia." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo acima de 15 MB." }, { status: 413 });
  const dados = new Uint8Array(await arquivo.arrayBuffer());

  if (acao === "ler") {
    try {
      return NextResponse.json({ ok: true, guia: lerGuia(await textoDaGuia(dados)) });
    } catch (e) {
      if (e instanceof PdfInvalido) return NextResponse.json({ ok: true, guia: { ...lerGuia(""), avisos: [`${e.message} Preencha os campos à mão.`] } });
      throw e;
    }
  }
  if (acao !== "enviar") return NextResponse.json({ error: "Ação não informada." }, { status: 400 });

  const competencia = String(form?.get("competencia") ?? "");
  const tipo = String(form?.get("tipo") ?? "") as TipoGuia;
  const valor = valorDigitado(String(form?.get("valor") ?? ""));
  const vencimento = String(form?.get("vencimento") ?? "");
  const linha = String(form?.get("linha") ?? "").replace(/\D/g, "");
  const observacao = String(form?.get("observacao") ?? "").trim().slice(0, 500);
  if (!UUID.test(competencia)) return NextResponse.json({ error: "Abra a competência antes de enviar a guia." }, { status: 400 });
  if (!TIPOS_GUIA.includes(tipo)) return NextResponse.json({ error: "Escolha o tipo da guia." }, { status: 400 });
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: "Informe o valor da guia." }, { status: 400 });
  if (!DIA.test(vencimento)) return NextResponse.json({ error: "Informe o vencimento da guia." }, { status: 400 });
  if (linha && linha.length !== 44 && linha.length !== 48) return NextResponse.json({ error: "A linha digitável tem 48 dígitos (ou o código de barras, 44)." }, { status: 400 });
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  if (!org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });

  const caminho = caminhoDocumento(String(org), "fiscal", randomUUID(), arquivo.name);
  const admin = createSupabaseAdminClient();
  const { error: eUp } = await admin.storage.from("empresa-documentos").upload(caminho, dados, { contentType: arquivo.type || "application/pdf", upsert: false });
  if (eUp) return NextResponse.json({ error: "Não foi possível guardar o arquivo." }, { status: 503 });
  const { data, error } = await guard.supabase.rpc("fiscal_portal_guia_enviar", {
    p_competencia: competencia, p_tipo: tipo, p_valor: Math.round(valor * 100) / 100, p_vencimento: vencimento, p_linha: linha || null,
    p_observacao: observacao || null, p_original_name: arquivo.name, p_mime: arquivo.type || null, p_size: dados.byteLength,
    p_sha256: sha256(dados), p_storage_path: caminho,
  });
  if (error) {
    await admin.storage.from("empresa-documentos").remove([caminho]);
    return NextResponse.json({ error: error.message || "Não foi possível enviar a guia." }, { status: error.code === "42501" ? 403 : 400 });
  }
  const r = data as { guia: string; titulo: string; documento: string };
  await lerEGravar(admin, { id: r.documento, organization_id: String(org) }, dados); // leitura e ligações, sem derrubar o envio
  return NextResponse.json({ ok: true, guia: r.guia });
}
