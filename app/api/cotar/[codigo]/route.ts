import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ipDaRequest } from "../../../../lib/auth/ip-login";
import { sha256 } from "../../../../lib/documentos/guardar";
import { caminhoDocumento } from "../../../../lib/documentos/setores";
import { lerEGravar } from "../../../../lib/leitura/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CODIGO = /^[A-Za-z0-9_-]{20,64}$/;
const LIMITE = 15_000_000;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Portal do fornecedor por link (A-09). Público: quem tem o link vê só os itens daquele pedido e
 * responde uma vez. Tudo passa pela chave do servidor e pelas funções do banco, que conferem o link
 * (pelo hash), a validade e a situação; o navegador nunca fala direto com o banco.
 */
export async function GET(_request: Request, context: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await context.params;
  if (!CODIGO.test(codigo)) return NextResponse.json({ situacao: "inexistente" });
  const { data, error } = await createSupabaseAdminClient().rpc("compras_convite_ler", { p_codigo: codigo });
  if (error) return NextResponse.json({ error: "Não foi possível abrir a cotação agora." }, { status: 503 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function POST(request: Request, context: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await context.params;
  if (!CODIGO.test(codigo)) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envio inválido." }, { status: 400 });
  let itens: unknown;
  try { itens = JSON.parse(String(form.get("itens") ?? "[]")); } catch { return NextResponse.json({ error: "Itens inválidos." }, { status: 400 }); }
  if (!Array.isArray(itens) || itens.length > 200) return NextResponse.json({ error: "Itens inválidos." }, { status: 400 });
  const prazo = String(form.get("prazoEntrega") ?? "");
  const arquivo = form.get("arquivo");
  const admin = createSupabaseAdminClient();

  // O arquivo sobe antes (com a chave do servidor) e é apagado se o registro falhar.
  let caminho: string | null = null, dados: Uint8Array | null = null;
  if (arquivo instanceof File && arquivo.size) {
    if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo acima de 15 MB." }, { status: 413 });
    if (!/pdf$/i.test(arquivo.type) && !/\.pdf$/i.test(arquivo.name)) return NextResponse.json({ error: "Anexe a proposta em PDF." }, { status: 400 });
    const hash = createHash("sha256").update(codigo).digest("hex");
    const { data: conv } = await admin.from("compras_convites").select("organization_id, situacao, expira_em").eq("token_hash", hash).maybeSingle();
    if (!conv || conv.situacao !== "aberto" || new Date(conv.expira_em) < new Date()) return NextResponse.json({ error: "Este link não está mais aberto." }, { status: 400 });
    dados = new Uint8Array(await arquivo.arrayBuffer());
    if (!(dados[0] === 0x25 && dados[1] === 0x50 && dados[2] === 0x44 && dados[3] === 0x46)) return NextResponse.json({ error: "O arquivo não é um PDF." }, { status: 400 });
    caminho = caminhoDocumento(String(conv.organization_id), "compras", randomUUID(), arquivo.name);
    const { error: eUp } = await admin.storage.from("empresa-documentos").upload(caminho, dados, { contentType: "application/pdf", upsert: false });
    if (eUp) return NextResponse.json({ error: "Não foi possível guardar o arquivo." }, { status: 503 });
  }
  const { data, error } = await admin.rpc("compras_convite_responder", {
    p_codigo: codigo, p_itens: itens, p_prazo_entrega: DIA.test(prazo) ? prazo : null, p_condicao: String(form.get("condicao") ?? "").slice(0, 120),
    p_frete_tipo: String(form.get("freteTipo") ?? "CIF"), p_frete_valor: Number(String(form.get("freteValor") ?? "0").replace(",", ".")) || 0,
    p_observacao: String(form.get("observacao") ?? "").slice(0, 600), p_ip: ipDaRequest(request.headers), p_navegador: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    p_arquivo_nome: arquivo instanceof File && caminho ? arquivo.name : null, p_arquivo_mime: caminho ? "application/pdf" : null,
    p_arquivo_tamanho: dados?.byteLength ?? null, p_arquivo_sha256: dados ? sha256(dados) : null, p_arquivo_caminho: caminho,
  });
  if (error) {
    if (caminho) await admin.storage.from("empresa-documentos").remove([caminho]);
    return NextResponse.json({ error: error.message || "Não foi possível enviar." }, { status: 400 });
  }
  const r = data as { cotacao: number; itens: number; documento: string | null; organizacao: string };
  if (r.documento && dados) await lerEGravar(admin, { id: r.documento, organization_id: r.organizacao }, dados); // leitura do PDF, sem derrubar o envio
  return NextResponse.json({ ok: true, itens: r.itens });
}
