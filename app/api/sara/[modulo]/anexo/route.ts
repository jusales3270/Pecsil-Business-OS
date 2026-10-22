import { NextResponse } from "next/server";
import { extratoresServidor } from "../../../../../lib/leitura/servidor";
import { lerTexto } from "../../../../../lib/leitura/texto";
import { preparar } from "../../../../../lib/sara/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 10 * 1024 * 1024;
const TEXTO_MAX = 40_000;

/**
 * Documento anexado à conversa da SARA (E5): Excel, Word, PDF, CSV ou texto. É lido aqui com o mesmo
 * leitor do Segundo Cérebro e o TEXTO volta para a tela, que o manda junto da pergunta. O arquivo não é
 * guardado (para guardar, o caminho é Documentos ou a coleta do setor). Mesma regra de acesso da SARA.
 */
export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Escolha o arquivo." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ error: "O arquivo passa de 10 MB." }, { status: 400 });
  const leitura = await lerTexto(new Uint8Array(await arquivo.arrayBuffer()), extratoresServidor).catch(() => null);
  if (!leitura) return NextResponse.json({ error: "Não consegui ler este arquivo." }, { status: 400 });
  if (leitura.status !== "lido") {
    return NextResponse.json({ error: leitura.ocr ? "Este PDF é escaneado (imagem). Tire uma foto ou um print da página e envie pela Foto." : `Não consegui ler: ${leitura.motivo}.` }, { status: 400 });
  }
  return NextResponse.json({ nome: arquivo.name.slice(0, 120), texto: leitura.texto.slice(0, TEXTO_MAX), cortado: leitura.texto.length > TEXTO_MAX, paginas: leitura.paginas });
}
