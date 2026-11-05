import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { TIPOS_PECA } from "../../../../lib/comercial/peso-3d";

export const dynamic = "force-dynamic";

const PECAS = TIPOS_PECA.filter((t) => t !== "garrafa" && t !== "ferragem");
const UUID = /^[0-9a-f-]{36}$/i;

/** Ligas (densidade) e a regra do sobremetal por tipo de peça, usadas no peso do desenho 3D (ROADMAP C-19). */
export async function GET() {
  const guard = await requireAnyFeature(["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  const [{ data: ligas, error }, { data: regras }] = await Promise.all([
    guard.supabase.from("comercial_ligas").select("id, nome, densidade_g_cm3, padrao, ativo, updated_by_name, updated_at").order("nome"),
    guard.supabase.from("comercial_sobremetal").select("id, tipo_peca, liga_id, mm_diametro, mm_comprimento, updated_by_name, updated_at"),
  ]);
  if (error) return dbError(error);
  return NextResponse.json({ ligas: ligas ?? [], regras: regras ?? [], podeOperar: guard.access.can("comercial.orcamentos", "operar") });
}

type LigaEntrada = { id?: unknown; nome?: unknown; densidade_g_cm3?: unknown; padrao?: unknown; ativo?: unknown };
type RegraEntrada = { tipo_peca?: unknown; liga_id?: unknown; mm_diametro?: unknown; mm_comprimento?: unknown };

/**
 * Grava as ligas e a regra inteira de uma vez. As regras enviadas substituem as atuais (o que sair da
 * lista deixa de valer). Uma liga só pode ser a padrão.
 */
export async function PUT(request: Request) {
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as { ligas?: LigaEntrada[]; regras?: RegraEntrada[] };
  const erros: string[] = [];
  const num = (v: unknown) => Number(String(v ?? "").replace(",", "."));

  const ligas = (Array.isArray(b.ligas) ? b.ligas : []).slice(0, 30).map((l, k) => {
    const nome = String(l.nome ?? "").trim().slice(0, 60);
    const dens = num(l.densidade_g_cm3);
    if (!nome) erros.push(`Liga ${k + 1}: falta o nome.`);
    if (!(dens > 0 && dens <= 30)) erros.push(`${nome || `Liga ${k + 1}`}: densidade entre 0 e 30 g/cm³.`);
    return { id: typeof l.id === "string" && UUID.test(l.id) ? l.id : null, nome, densidade_g_cm3: dens, padrao: l.padrao === true, ativo: l.ativo !== false };
  });
  if (!ligas.length) erros.push("Cadastre ao menos uma liga.");
  if (ligas.filter((l) => l.padrao).length > 1) erros.push("Só uma liga pode ser a padrão.");
  const regras = (Array.isArray(b.regras) ? b.regras : []).slice(0, 60).map((r) => ({
    tipo_peca: String(r.tipo_peca ?? ""), liga: r.liga_id === null || r.liga_id === "" ? null : String(r.liga_id ?? ""),
    mm_diametro: num(r.mm_diametro), mm_comprimento: num(r.mm_comprimento),
  }));
  for (const r of regras) {
    if (!(PECAS as readonly string[]).includes(r.tipo_peca)) erros.push(`Tipo de peça desconhecido: ${r.tipo_peca}.`);
    if (!(r.mm_diametro >= 0 && r.mm_diametro <= 100 && r.mm_comprimento >= 0 && r.mm_comprimento <= 100)) erros.push("Sobremetal entre 0 e 100 mm.");
  }
  if (erros.length) return NextResponse.json({ error: erros[0], erros }, { status: 400 });

  const { data: org } = await guard.supabase.rpc("current_organization_id");
  const { data: perfil } = await guard.supabase.rpc("current_profile_id");
  const { data: autor } = await guard.supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
  const quem = autor?.full_name || autor?.email || null;
  const agora = new Date().toISOString();

  // Ligas: primeiro tira a marca de padrão (o índice único não deixa duas), depois grava.
  const { error: e0 } = await guard.supabase.from("comercial_ligas").update({ padrao: false }).eq("padrao", true);
  if (e0) return dbError(e0);
  const ids = new Map<string, string>();
  for (const l of ligas) {
    const linha = { organization_id: org, nome: l.nome, densidade_g_cm3: l.densidade_g_cm3, padrao: l.padrao, ativo: l.ativo, updated_by_name: quem, updated_at: agora };
    const { data, error } = l.id
      ? await guard.supabase.from("comercial_ligas").update(linha).eq("id", l.id).select("id, nome").single()
      : await guard.supabase.from("comercial_ligas").upsert(linha, { onConflict: "organization_id,nome" }).select("id, nome").single();
    if (error) return dbError(error);
    ids.set(data.nome, data.id);
  }
  const validas = new Set(ids.values());
  for (const r of regras) if (r.liga && !validas.has(r.liga)) return NextResponse.json({ error: "Regra aponta para uma liga que não está na lista." }, { status: 400 });

  const { error: e1 } = await guard.supabase.from("comercial_sobremetal").delete().eq("organization_id", org);
  if (e1) return dbError(e1);
  if (regras.length) {
    const { error: e2 } = await guard.supabase.from("comercial_sobremetal").insert(regras.map((r) => ({
      organization_id: org, tipo_peca: r.tipo_peca, liga_id: r.liga, mm_diametro: r.mm_diametro, mm_comprimento: r.mm_comprimento, updated_by_name: quem, updated_at: agora,
    })));
    if (e2) return dbError(e2);
  }
  return NextResponse.json({ ok: true });
}
