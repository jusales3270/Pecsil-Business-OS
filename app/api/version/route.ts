import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Versão da build que está no ar. Pública e sem dados: o app aberto compara
 * com a versão com que foi carregado para saber se há atualização.
 */
export function GET() {
  const response = NextResponse.json({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? null });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
