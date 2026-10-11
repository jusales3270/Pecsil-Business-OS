import { NextResponse } from "next/server";
import { exigirColeta } from "../../../../lib/coleta/acesso";

export const dynamic = "force-dynamic";

/** Meus aceites de acesso a pastas neste setor e as coletas feitas com eles (o proprietário vê todos). */
export async function GET(request: Request) {
  const guard = await exigirColeta(new URL(request.url).searchParams.get("modulo"));
  if ("error" in guard) return guard.error;
  const [{ data: aceites }, { data: coletas }] = await Promise.all([
    guard.supabase.from("file_collection_consents").select("id, profile_name, module_code, device_id, device_name, folder_name, accepted_at, revoked_at")
      .eq("module_code", guard.setor).order("accepted_at", { ascending: false }).limit(100),
    guard.supabase.from("file_collection_runs").select("id, consent_id, started_at, finished_at, scanned, ignored, duplicates, personal, rh, too_big, proposed, uploaded")
      .eq("module_code", guard.setor).order("started_at", { ascending: false }).limit(100),
  ]);
  return NextResponse.json({ aceites: aceites ?? [], coletas: coletas ?? [] });
}

/** Registra o aceite: quem, setor, computador (nome + identificador), pasta, quando. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { modulo?: string; deviceId?: string; deviceName?: string; folderName?: string };
  const guard = await exigirColeta(body.modulo);
  if ("error" in guard) return guard.error;
  if (!body.deviceId || !/^[0-9a-f-]{36}$/i.test(body.deviceId)) return NextResponse.json({ error: "Identificador do computador inválido." }, { status: 400 });
  if (!body.deviceName || body.deviceName.trim().length < 2) return NextResponse.json({ error: "Dê um nome a este computador." }, { status: 400 });
  if (!body.folderName?.trim()) return NextResponse.json({ error: "Pasta não informada." }, { status: 400 });
  const agente = (request.headers.get("user-agent") ?? "").replace(/\s+/g, " ").slice(0, 200);
  const { data, error } = await guard.supabase.rpc("file_collection_accept", {
    p_module: guard.setor, p_device_id: body.deviceId, p_device_name: body.deviceName.trim().slice(0, 80), p_folder_name: body.folderName.trim(), p_user_agent: agente,
  });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar o aceite." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ id: data }, { status: 201 });
}
