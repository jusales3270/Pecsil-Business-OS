import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { lerFoto } from "../../../../../lib/qualidade/fotos-servidor";

export const dynamic = "force-dynamic";

/** Abre (na tela) ou baixa (?baixar=1) a foto. A função do banco confere a permissão com a sessão. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("qualidade.nao_conformidades", "ver");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  const { data, error } = await guard.supabase.rpc("qualidade_foto_abrir", { p_foto: id });
  if (error) return error.message.includes("não encontrada") ? NextResponse.json({ error: "Foto não encontrada." }, { status: 404 }) : dbError(error);
  const f = data as { storage_path: string; mime: string; numero: number | null };
  const baixar = new URL(request.url).searchParams.get("baixar") === "1";
  try {
    const arquivo = await lerFoto(f.storage_path);
    const nome = `${f.numero ? `NC-${f.numero}` : "evidencia"}-${id.slice(0, 8)}.${f.storage_path.split(".").pop()}`;
    return new Response(arquivo.stream(), {
      headers: {
        "Content-Type": f.mime,
        "Content-Length": String(arquivo.size),
        "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename="${nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao ler foto da Qualidade", e);
    return NextResponse.json({ error: "Não foi possível abrir a foto agora." }, { status: 503 });
  }
}
