import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { lerCadastroSefaz } from "../../../../../lib/fiscal/cadastro";
import { organizacaoDaSessao, respostaDoErro } from "../../../../../lib/fiscal/rotas";
import { credenciaisDaOrganizacao } from "../../../../../lib/fiscal/servidor";
import { UFS, obterTransmissor } from "../../../../../lib/fiscal/transmissor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Conversas avulsas com a SEFAZ, a partir da Configuração fiscal (quem opera a configuração):
 *   { acao: "status" }                 → o serviço da SEFAZ está no ar? (testa certificado e transmissor)
 *   { acao: "cadastro", cnpj, uf }     → dados do contribuinte (IE, endereço) para preencher o emitente.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.config", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => ({}))) as { acao?: string; cnpj?: string; uf?: string };
  const org = await organizacaoDaSessao(guard.supabase);
  if (!org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  try {
    const admin = createSupabaseAdminClient();
    const cred = await credenciaisDaOrganizacao(admin, org);
    const transmissor = obterTransmissor();
    if (corpo.acao === "status") {
      const r = await transmissor.status(cred);
      return NextResponse.json({ cStat: r.cStat, motivo: r.motivo, ambiente: cred.ambiente });
    }
    if (corpo.acao === "cadastro") {
      const cnpj = String(corpo.cnpj ?? "").replace(/\D/g, "");
      const uf = String(corpo.uf ?? "").toUpperCase();
      if (cnpj.length !== 14 || !UFS.includes(uf)) return NextResponse.json({ error: "Informe o CNPJ e a UF." }, { status: 400 });
      const r = await transmissor.cadastro(cred, { cnpj, uf });
      const cadastro = lerCadastroSefaz(r.bruto);
      if (!cadastro) return NextResponse.json({ error: `SEFAZ: ${r.motivo ?? "contribuinte não encontrado"}.` }, { status: 404 });
      return NextResponse.json({ cadastro });
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return respostaDoErro(e, "Falha na consulta à SEFAZ");
  }
}
