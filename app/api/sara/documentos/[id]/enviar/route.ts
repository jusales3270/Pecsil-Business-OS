import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../../lib/auth/session-access";
import { pessoasAtivas } from "../../../../../../lib/sara/central/documentos";
import { requireUserSession } from "../../../../../../lib/supabase/session";
import { destinosDaTela, enviarDaTela } from "../../../../../../lib/whatsapp/enviar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Enviar um documento da SARA central pela tela (War Room › Conselho). O clique de quem envia é a confirmação.
 * GET: para quem dá para mandar (pessoas da empresa pela plataforma; contatos das listas pelo WhatsApp).
 * POST { canal: "plataforma", para: <perfil> } ou { canal: "whatsapp", para: <contato> }.
 * Só quem usa a SARA central, e só o documento que ela mesma criou (como na SARA).
 */
async function abrir(id: string) {
  if (!UUID.test(id)) return { erro: NextResponse.json({ error: "Documento não encontrado." }, { status: 404 }) } as const;
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const sb = session.supabase;
  const access = await readSessionAccess(sb).catch(() => null);
  if (!access?.canModule("warroom") || !access.can("warroom.sara", "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  const eu = (await sb.rpc("current_profile_id")).data as string | null;
  const { data: doc } = await sb.from("sara_documentos").select("id, numero, tipo, caminho, criado_por").eq("id", id).maybeSingle<{ id: string; numero: string; tipo: string; caminho: string | null; criado_por: string | null }>();
  if (!doc) return { erro: NextResponse.json({ error: "Documento não encontrado." }, { status: 404 }) } as const;
  if (!doc.caminho) return { erro: NextResponse.json({ error: "O PDF deste documento não foi gerado." }, { status: 409 }) } as const;
  if (!eu || doc.criado_por !== eu) return { erro: NextResponse.json({ error: "Só quem criou o documento envia. Gere o seu PDF (ou peça à SARA central)." }, { status: 403 }) } as const;
  return { sb, doc } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const a = await abrir((await context.params).id);
  if ("erro" in a) return a.erro;
  const [pessoas, whatsapp] = await Promise.all([pessoasAtivas(a.sb), destinosDaTela(a.sb).catch(() => [])]);
  return NextResponse.json({ pessoas: pessoas.map((p) => ({ id: p.id, nome: p.nome })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")), whatsapp });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const a = await abrir((await context.params).id);
  if ("erro" in a) return a.erro;
  const corpo = (await request.json().catch(() => null)) as { canal?: string; para?: string } | null;
  const para = String(corpo?.para ?? "");
  if (!UUID.test(para)) return NextResponse.json({ error: "Escolha para quem enviar." }, { status: 400 });
  if (corpo?.canal === "plataforma") {
    const { data, error } = await a.sb.rpc("sara_documento_enviar", { p_documento: a.doc.id, p_para: para });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const r = data as { ja_enviado?: boolean; para: string };
    return NextResponse.json({ feito: r.ja_enviado ? `${r.para} já tinha recebido este documento pela plataforma.` : `Documento ${a.doc.numero} enviado para ${r.para} pela plataforma (aviso no sino).` });
  }
  if (corpo?.canal === "whatsapp") {
    try {
      const r = await enviarDaTela(a.sb, para, [a.doc.id]);
      return "erro" in r ? NextResponse.json({ error: r.erro }, { status: 400 }) : NextResponse.json(r);
    } catch (e) {
      return NextResponse.json({ error: `Não saiu pelo WhatsApp: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}` }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "Escolha o canal: plataforma ou WhatsApp." }, { status: 400 });
}
