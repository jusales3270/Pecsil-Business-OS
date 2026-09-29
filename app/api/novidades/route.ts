import { NextResponse } from "next/server";
import { NOVIDADES } from "../../../lib/novidades";

export const dynamic = "force-dynamic";

/**
 * Novidades da versão que está no ar. Pública e sem dados: o app aberto (de uma
 * versão anterior) busca aqui para mostrar o que a atualização traz.
 */
export function GET() {
  const response = NextResponse.json({ novidades: NOVIDADES });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
