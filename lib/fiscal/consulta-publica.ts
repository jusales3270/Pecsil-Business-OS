/**
 * Consulta pública de CNPJ (BrasilAPI) e CEP (ViaCEP) para preencher o destinatário da NF-e e o
 * cadastro do cliente (decisão do proprietário, 13/10/2026). Serviços gratuitos e sem chave; só sai
 * o CNPJ (dado público de empresa) ou o CEP — nunca CPF. A IE não vem: continua digitada até a
 * consulta da SEFAZ (com o certificado A1). Os leitores são puros e testáveis.
 */

export type DadosCnpj = {
  razaoSocial: string; fantasia: string; situacao: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string;
  municipio: string; codigoMunicipio: string; uf: string; telefone: string; email: string;
};
export type DadosCep = { cep: string; logradouro: string; complemento: string; bairro: string; municipio: string; codigoMunicipio: string; uf: string };

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const txt = (v: unknown, max = 60) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Resposta de https://brasilapi.com.br/api/cnpj/v1/{cnpj}. */
export function lerBrasilApiCnpj(j: Record<string, unknown>): DadosCnpj {
  const tipo = txt(j.descricao_tipo_de_logradouro);
  const rua = txt(j.logradouro, 200);
  // O tipo (RUA, AVENIDA…) vem separado; junta quando o logradouro não começa por ele.
  const logradouro = tipo && !rua.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${rua}` : rua;
  const fone = so(j.ddd_telefone_1);
  return {
    razaoSocial: txt(j.razao_social), fantasia: txt(j.nome_fantasia), situacao: txt(j.descricao_situacao_cadastral, 30),
    cep: so(j.cep).slice(0, 8), logradouro: logradouro.slice(0, 60), numero: txt(j.numero) || "SN", complemento: txt(j.complemento),
    bairro: txt(j.bairro), municipio: txt(j.municipio), codigoMunicipio: so(j.codigo_municipio_ibge).slice(0, 7), uf: txt(j.uf, 2).toUpperCase(),
    telefone: fone.length >= 10 ? fone.slice(0, 14) : "", email: txt(j.email).toLowerCase(),
  };
}

/** Resposta de https://viacep.com.br/ws/{cep}/json/ — `null` quando o CEP não existe. */
export function lerViaCep(j: Record<string, unknown>): DadosCep | null {
  if (j.erro === true || j.erro === "true" || !j.ibge) return null;
  return {
    cep: so(j.cep).slice(0, 8), logradouro: txt(j.logradouro), complemento: txt(j.complemento), bairro: txt(j.bairro),
    municipio: txt(j.localidade), codigoMunicipio: so(j.ibge).slice(0, 7), uf: txt(j.uf, 2).toUpperCase(),
  };
}

export class ConsultaIndisponivel extends Error {}

async function buscarJson(url: string, buscar: typeof fetch): Promise<{ status: number; json: Record<string, unknown> | null }> {
  try {
    // Sem user-agent, a BrasilAPI responde 403 (o fetch do Node não manda um).
    const r = await buscar(url, { headers: { accept: "application/json", "user-agent": "BusinessOS/1.0 (consulta de CNPJ/CEP para NF-e)" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: r.status, json };
  } catch {
    throw new ConsultaIndisponivel("O serviço de consulta não respondeu. Tente de novo ou preencha à mão.");
  }
}

/** `null` = CNPJ não encontrado. Só aceita CNPJ (14 dígitos): CPF nunca sai da plataforma. */
export async function consultarCnpj(cnpj: string, buscar: typeof fetch = fetch): Promise<DadosCnpj | null> {
  const d = so(cnpj);
  if (d.length !== 14) throw new Error("Só CNPJ (14 dígitos) é consultado.");
  const r = await buscarJson(`https://brasilapi.com.br/api/cnpj/v1/${d}`, buscar);
  if (r.status === 404) return null;
  if (r.status !== 200 || !r.json) throw new ConsultaIndisponivel("A consulta de CNPJ está fora do ar agora. Tente de novo ou preencha à mão.");
  return lerBrasilApiCnpj(r.json);
}

export async function consultarCep(cep: string, buscar: typeof fetch = fetch): Promise<DadosCep | null> {
  const d = so(cep);
  if (d.length !== 8) throw new Error("O CEP tem 8 dígitos.");
  const r = await buscarJson(`https://viacep.com.br/ws/${d}/json/`, buscar);
  if (r.status === 400) return null;
  if (r.status !== 200 || !r.json) throw new ConsultaIndisponivel("A consulta de CEP está fora do ar agora. Tente de novo ou preencha à mão.");
  return lerViaCep(r.json);
}
