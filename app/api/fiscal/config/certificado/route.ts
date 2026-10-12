import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../lib/auth/session-access";
import { erroDoBanco, respostaDoErro } from "../../../../../lib/fiscal/rotas";
import { obterTransmissor } from "../../../../../lib/fiscal/transmissor";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 100_000; // um .pfx A1 tem poucos KB

/** O proprietário, ou quem recebeu "Certificado digital" (ex.: o fiscal ou o escritório de contabilidade). */
async function exigirCertificado() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { error: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.isOwner && !access?.can("fiscal.certificado", "operar")) {
    return { error: NextResponse.json({ error: "Sem permissão para cuidar do certificado digital." }, { status: 403 }) } as const;
  }
  return { supabase: session.supabase } as const;
}

/**
 * Certificado digital A1 (.pfx + senha). O proprietário ou quem tem "Certificado digital".
 * O transmissor abre o arquivo com a senha (confere a senha) e devolve titular, CNPJ e validade;
 * o banco guarda o arquivo e a senha no cofre (Vault) e os dados públicos na configuração.
 * Nada disso vai para log nem volta na resposta. A troca e a remoção vão para a auditoria
 * (audit_logs, risco alto) e avisam o proprietário — no banco, junto com a gravação.
 */
export async function POST(request: Request) {
  const guard = await exigirCertificado();
  if ("error" in guard) return guard.error;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const senha = String(form?.get("senha") ?? "");
  if (!(arquivo instanceof File) || !senha) return NextResponse.json({ error: "Envie o arquivo .pfx e a senha." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo grande demais para um certificado A1." }, { status: 413 });
  const pfx = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
  try {
    const dados = await obterTransmissor().certificado({ pfx, senha });
    if (!dados.cnpj) return NextResponse.json({ error: "O certificado não traz CNPJ: é preciso um e-CNPJ A1 da empresa." }, { status: 400 });
    const { error } = await guard.supabase.rpc("fiscal_certificado_salvar", {
      p_pfx: pfx, p_senha: senha, p_titular: dados.titular, p_cnpj: dados.cnpj, p_validade: dados.validade,
    });
    if (error) return NextResponse.json({ error: erroDoBanco(error) }, { status: error.code === "42501" ? 403 : 400 });
    return NextResponse.json({ titular: dados.titular, cnpj: dados.cnpj, validade: dados.validade, emissor: dados.emissor });
  } catch (e) {
    return respostaDoErro(e, "Falha ao enviar o certificado");
  }
}

export async function DELETE() {
  const guard = await exigirCertificado();
  if ("error" in guard) return guard.error;
  const { error } = await guard.supabase.rpc("fiscal_certificado_remover");
  if (error) return NextResponse.json({ error: erroDoBanco(error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
