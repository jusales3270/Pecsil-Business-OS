import "server-only";

import { NextResponse } from "next/server";
import { tipoDoArquivo } from "../arquivos/detectar";
import { obterTransmissor } from "../fiscal/transmissor";
import { createSupabaseAdminClient } from "../supabase/admin";

const BUCKET = "empresa-documentos";
const TIPOS: Record<string, string> = { pdf: "application/pdf", xml: "text/plain; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8" };

const nomeNoCabecalho = (nome: string) => `filename*=UTF-8''${encodeURIComponent(nome)}`;

/**
 * Entrega um arquivo guardado PELA PRÓPRIA PLATAFORMA, só depois que a rota conferiu que a pessoa pode vê-lo. O
 * Supabase não é publicado para fora: link assinado do servidor aponta para o endereço interno e não abre no
 * navegador, por isso nada aqui redireciona.
 *   baixar → download do arquivo;
 *   ver    → conteúdo para a janela de visualização (PDF, XML, imagem). XML vai como texto puro e nada do arquivo executa;
 *   danfe  → XML de NF-e: o DANFE em PDF, gerado pelo transmissor (o mesmo das notas emitidas).
 */
export async function entregarArquivo(caminho: string, nome: string, modo: "baixar" | "ver" | "danfe"): Promise<NextResponse> {
  const { data: blob, error } = await createSupabaseAdminClient().storage.from(BUCKET).download(caminho);
  if (error || !blob) throw error ?? new Error("sem arquivo");

  if (modo === "danfe") {
    const dados = new Uint8Array(await blob.arrayBuffer());
    if (tipoDoArquivo(dados) !== "nfe-xml") return NextResponse.json({ error: "Este arquivo não é o XML de uma NF-e: não há DANFE." }, { status: 422 });
    try {
      const pdf = await obterTransmissor().danfe(new TextDecoder("utf-8").decode(dados));
      return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; ${nomeNoCabecalho(nome.replace(/\.xml$/i, "") + "-DANFE.pdf")}`, "cache-control": "private, no-store" } });
    } catch (e) {
      console.error("DANFE do arquivo guardado", e);
      return NextResponse.json({ error: "O DANFE não pôde ser gerado agora. O resumo e o XML continuam à vista." }, { status: 503 });
    }
  }

  const extensao = nome.split(".").pop()?.toLowerCase() ?? "";
  const ver = modo === "ver";
  return new NextResponse(blob, {
    headers: {
      "content-type": ver ? TIPOS[extensao] ?? "application/octet-stream" : "application/octet-stream",
      "content-disposition": `${ver ? "inline" : "attachment"}; ${nomeNoCabecalho(nome)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // O arquivo é de quem enviou: fora o PDF (o leitor do navegador não roda em caixa fechada), nada dele executa aqui.
      ...(ver && extensao === "pdf" ? {} : { "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:" }),
    },
  });
}
