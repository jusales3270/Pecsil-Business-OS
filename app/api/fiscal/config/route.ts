import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { erroDoBanco } from "../../../../lib/fiscal/rotas";
import { transmissorConfigurado } from "../../../../lib/fiscal/transmissor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Campos que a tela pode alterar (o banco confere de novo, numa lista fechada). */
const CAMPOS = [
  "razao_social", "nome_fantasia", "cnpj", "ie", "im", "cnae", "crt", "logradouro", "numero", "complemento", "bairro",
  "codigo_municipio", "municipio", "uf", "cep", "telefone", "email", "ambiente", "serie_padrao", "proximo_numero",
  "dfe_ativo", "ciencia_automatica",
] as const;

/**
 * Fiscal › Configuração: dados do emitente, ambiente, série e numeração, busca das notas na SEFAZ
 * e o certificado (só os dados públicos dele; o arquivo e a senha ficam no cofre).
 */
export async function GET() {
  const guard = await requireAnyFeature(["fiscal.config", "fiscal.nfe", "fiscal.icms", "fiscal.certificado"]);
  if ("error" in guard) return guard.error;
  const [{ data: config, error }, { data: series }] = await Promise.all([
    guard.supabase.from("fiscal_config").select("*").maybeSingle(),
    guard.supabase.from("fiscal_series").select("serie, proximo_numero").order("serie"),
  ]);
  if (error) return NextResponse.json({ error: erroDoBanco(error) }, { status: 400 });
  return NextResponse.json({
    config,
    series: series ?? [],
    podeEditar: guard.access.can("fiscal.config", "operar"),
    ehDono: guard.access.isOwner,
    podeCertificado: guard.access.isOwner || guard.access.can("fiscal.certificado", "operar"),
    transmissor: transmissorConfigurado(),
  });
}

export async function PATCH(request: Request) {
  const guard = await requireFeature("fiscal.config", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });
  const p: Record<string, unknown> = {};
  for (const campo of CAMPOS) if (campo in corpo) p[campo] = corpo[campo] === null ? "" : corpo[campo];
  if (!Object.keys(p).length) return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });
  const { error } = await guard.supabase.rpc("fiscal_config_salvar", { p });
  if (error) return NextResponse.json({ error: erroDoBanco(error) }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
