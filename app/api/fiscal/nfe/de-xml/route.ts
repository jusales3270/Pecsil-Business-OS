import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { notaDoXml } from "../../../../../lib/fiscal/emissao/espelho";
import { normalizarNota } from "../../../../../lib/fiscal/emissao/normalizar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 2 * 1024 * 1024;

/**
 * Começar uma nota a partir de outra (XML de NF-e, por exemplo uma do GRV da mesma operação): devolve a nota no
 * formato da plataforma, para o Jefferson conferir e ajustar. Nada é gravado aqui; a nota nova só existe quando ele
 * salvar. Quem opera as notas (fiscal.nfe operar).
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const xml = await request.text().catch(() => "");
  if (!xml.trim()) return NextResponse.json({ error: "Envie o XML da nota." }, { status: 400 });
  if (xml.length > LIMITE) return NextResponse.json({ error: "XML grande demais (até 2 MB)." }, { status: 413 });
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return NextResponse.json({ error: "XML com declaração não aceita." }, { status: 400 });
  try {
    const lida = notaDoXml(xml);
    const nota = normalizarNota(lida.nota);
    return NextResponse.json({
      nota,
      origem: { numero: lida.numero, serie: lida.serie, chave: lida.chave, emitente: lida.emitente.razaoSocial, emissao: lida.emissao.toISOString() },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `Não foi possível ler a nota: ${e.message}` : "Não foi possível ler a nota." }, { status: 400 });
  }
}
