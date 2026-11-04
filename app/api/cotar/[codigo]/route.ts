import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { criarLimitesCotar, ipDoFornecedor } from "../../../../lib/security/cotar-limites";
import { EnvioInvalido, lerFormularioLimitado } from "../../../../lib/security/upload";
import { sha256 } from "../../../../lib/documentos/guardar";
import { caminhoDocumento } from "../../../../lib/documentos/setores";
import { lerEGravar } from "../../../../lib/leitura/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CODIGO = /^[A-Za-z0-9_-]{20,64}$/;
const LIMITE = 15_000_000;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const limitarEnvios = criarLimitesCotar();
const CAMPOS = new Set(["itens", "prazoEntrega", "condicao", "freteTipo", "freteValor", "observacao", "arquivo"]);
const textoCampo = (form: FormData, nome: string, max: number, padrao = "") => {
  const valor = form.get(nome) ?? padrao;
  if (typeof valor !== "string" || valor.length > max) throw new EnvioInvalido("Campo inválido.");
  return valor;
};

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
  const hash = createHash("sha256").update(codigo).digest("hex");
  const ip = ipDoFornecedor(request.headers);
  const limite = limitarEnvios(ip, hash);
  if (!limite.ok) return NextResponse.json({ error: "Aguarde antes de tentar novamente." }, { status: 429, headers: { "retry-after": String(limite.aguardar) } });
  let caminho: string | null = null;
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let registrado = false;
  try {
    admin = createSupabaseAdminClient();
    // Autoriza pelo hash ANTES de ler qualquer byte, mesmo quando não há anexo. A RPC repete
    // a verificação sob bloqueio da linha: este pré-filtro não substitui a resposta única atômica.
    const { data: conv, error: erroConvite } = await admin.from("compras_convites").select("organization_id, situacao, expira_em").eq("token_hash", hash).maybeSingle();
    if (erroConvite) return NextResponse.json({ error: "Não foi possível conferir o link agora." }, { status: 503 });
    const validade = conv ? Date.parse(conv.expira_em) : NaN;
    if (!conv || conv.situacao !== "aberto" || !Number.isFinite(validade) || validade <= Date.now()) return NextResponse.json({ error: "Este link não está mais aberto." }, { status: 400 });

    const form = await lerFormularioLimitado(request);
    const vistos = new Set<string>();
    for (const [nome] of form) {
      if (!CAMPOS.has(nome) || vistos.has(nome)) throw new EnvioInvalido("Campos inválidos ou repetidos.");
      vistos.add(nome);
    }
    let itens: unknown;
    try { itens = JSON.parse(textoCampo(form, "itens", 150_000, "[]")); } catch { throw new EnvioInvalido("Itens inválidos."); }
    if (!Array.isArray(itens) || !itens.length || itens.length > 200) throw new EnvioInvalido("Itens inválidos.");
    const ids = new Set<string>();
    for (const item of itens) {
      if (!item || typeof item !== "object" || Array.isArray(item) || !UUID.test(item.id) || ids.has(item.id)
        || typeof item.valor_unit !== "number" || !Number.isFinite(item.valor_unit) || item.valor_unit <= 0 || item.valor_unit > 1e12
        || typeof item.quantidade !== "number" || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || item.quantidade > 1e9
        || typeof item.ipi !== "number" || !Number.isFinite(item.ipi) || item.ipi < 0 || item.ipi > 100
        || typeof item.obs !== "string" || item.obs.length > 300) throw new EnvioInvalido("Itens inválidos.");
      ids.add(item.id);
    }
    const prazo = textoCampo(form, "prazoEntrega", 10);
    if (prazo && (!DIA.test(prazo) || !Number.isFinite(Date.parse(`${prazo}T00:00:00Z`)) || new Date(`${prazo}T00:00:00Z`).toISOString().slice(0, 10) !== prazo)) throw new EnvioInvalido("Prazo inválido.");
    const condicao = textoCampo(form, "condicao", 120).trim();
    const freteTipo = textoCampo(form, "freteTipo", 3, "CIF");
    const freteTexto = textoCampo(form, "freteValor", 32, "0").replace(",", ".");
    const freteValor = Number(freteTexto);
    const observacao = textoCampo(form, "observacao", 600);
    if (!condicao || !["CIF", "FOB"].includes(freteTipo) || !Number.isFinite(freteValor) || freteValor < 0 || freteValor > 1e12) throw new EnvioInvalido("Condições inválidas.");
    const arquivo = form.get("arquivo");
    if (arquivo !== null && !(arquivo instanceof File)) throw new EnvioInvalido("Anexo inválido.");
    let dados: Uint8Array | null = null;
    if (arquivo instanceof File && arquivo.size) {
      if (arquivo.size > LIMITE) throw new EnvioInvalido("Arquivo acima de 15 MB.", 413);
      if (!/\.pdf$/i.test(arquivo.name) || arquivo.name.length > 255 || /[\x00-\x1f\x7f]/.test(arquivo.name) || !["", "application/pdf"].includes(arquivo.type)) throw new EnvioInvalido("Anexe a proposta em PDF.");
      dados = new Uint8Array(await arquivo.arrayBuffer());
      if (!(dados[0] === 0x25 && dados[1] === 0x50 && dados[2] === 0x44 && dados[3] === 0x46 && dados[4] === 0x2d)) throw new EnvioInvalido("O arquivo não é um PDF.");
      caminho = caminhoDocumento(String(conv.organization_id), "compras", randomUUID(), arquivo.name);
      const { error: eUp } = await admin.storage.from("empresa-documentos").upload(caminho, dados, { contentType: "application/pdf", upsert: false });
      if (eUp) throw new EnvioInvalido("Não foi possível guardar o arquivo.", 503);
    }
    const { data, error } = await admin.rpc("compras_convite_responder", {
      p_codigo: codigo, p_itens: itens, p_prazo_entrega: prazo || null, p_condicao: condicao,
      p_frete_tipo: freteTipo, p_frete_valor: freteValor, p_observacao: observacao,
      p_ip: ip, p_navegador: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      p_arquivo_nome: arquivo instanceof File && caminho ? arquivo.name : null, p_arquivo_mime: caminho ? "application/pdf" : null,
      p_arquivo_tamanho: dados?.byteLength ?? null, p_arquivo_sha256: dados ? sha256(dados) : null, p_arquivo_caminho: caminho,
    });
    if (error) throw new EnvioInvalido("Não foi possível enviar. Confira se o link ainda está aberto e se os dados estão corretos.");
    registrado = true;
    const r = data as { cotacao: number; itens: number; documento: string | null; organizacao: string };
    if (r.documento && dados) await lerEGravar(admin, { id: r.documento, organization_id: r.organizacao }, dados).catch(() => undefined);
    return NextResponse.json({ ok: true, itens: r.itens });
  } catch (e) {
    // Nunca remove um anexo cujo registro já foi confirmado, mesmo se a leitura posterior falhar.
    if (caminho && admin && !registrado) await admin.storage.from("empresa-documentos").remove([caminho]).catch(() => undefined);
    return NextResponse.json({ error: e instanceof EnvioInvalido ? e.message : "Não foi possível enviar agora." }, { status: e instanceof EnvioInvalido ? e.status : 503 });
  } finally { limite.liberar(); }
}
