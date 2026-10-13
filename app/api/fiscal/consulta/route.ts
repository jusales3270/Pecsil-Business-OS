import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { ConsultaIndisponivel, consultarCep, consultarCnpj } from "../../../../lib/fiscal/consulta-publica";
import { cnpjValido } from "../../../../lib/fiscal/emissao/regras";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Preencher o destinatário: `?cnpj=` (BrasilAPI) ou `?cep=` (ViaCEP). Quem monta notas (fiscal.nfe
 * operar). Só CNPJ válido sai da plataforma; CPF nunca.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const p = new URL(request.url).searchParams;
  const cnpj = (p.get("cnpj") ?? "").replace(/\D/g, "");
  const cep = (p.get("cep") ?? "").replace(/\D/g, "");
  try {
    if (cnpj) {
      if (!cnpjValido(cnpj)) return NextResponse.json({ error: "CNPJ inválido (confira os dígitos)." }, { status: 400 });
      const dados = await consultarCnpj(cnpj);
      if (!dados) return NextResponse.json({ error: "CNPJ não encontrado na Receita." }, { status: 404 });
      return NextResponse.json({ dados });
    }
    if (cep.length === 8) {
      const dados = await consultarCep(cep);
      if (!dados) return NextResponse.json({ error: "CEP não encontrado." }, { status: 404 });
      return NextResponse.json({ dados });
    }
    return NextResponse.json({ error: "Informe um CNPJ ou um CEP." }, { status: 400 });
  } catch (e) {
    if (e instanceof ConsultaIndisponivel) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("Falha na consulta pública", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Não foi possível consultar agora." }, { status: 500 });
  }
}
