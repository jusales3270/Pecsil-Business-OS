/**
 * Consulta de cadastro de contribuinte na SEFAZ (retConsCad/infCons/infCad) → campos do emitente
 * ou do destinatário. O retorno vem como JSON da biblioteca do transmissor, com formato que pode
 * mudar entre versões: a leitura procura cada campo pelo nome, em qualquer profundidade.
 */

export type CadastroSefaz = {
  razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; ie: string | null; uf: string | null;
  situacao: "habilitado" | "nao_habilitado" | null; regime: string | null; cnae: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null;
  codigo_municipio: string | null; municipio: string | null; cep: string | null;
};

function achar(obj: unknown, chave: string, profundidade = 0): unknown {
  if (!obj || typeof obj !== "object" || profundidade > 10) return undefined;
  const o = obj as Record<string, unknown>;
  if (chave in o) return Array.isArray(o[chave]) ? (o[chave] as unknown[])[0] : o[chave];
  for (const v of Object.values(o)) {
    const achado = achar(v, chave, profundidade + 1);
    if (achado !== undefined) return achado;
  }
  return undefined;
}

const texto = (obj: unknown, chave: string) => {
  const v = achar(obj, chave);
  const s = v === undefined || v === null || typeof v === "object" ? "" : String(v).trim();
  return s || null;
};

export function lerCadastroSefaz(bruto: unknown): CadastroSefaz | null {
  const inf = achar(bruto, "infCad");
  if (!inf) return null;
  const ender = achar(inf, "ender") ?? inf;
  const sit = texto(inf, "cSit");
  return {
    razao_social: texto(inf, "xNome"),
    nome_fantasia: texto(inf, "xFant"),
    cnpj: texto(inf, "CNPJ"),
    ie: texto(inf, "IE"),
    uf: texto(inf, "UF"),
    // cSit: 0 = não habilitado; 1 = habilitado
    situacao: sit === "1" ? "habilitado" : sit === "0" ? "nao_habilitado" : null,
    regime: texto(inf, "xRegApur"),
    cnae: texto(inf, "CNAE"),
    logradouro: texto(ender, "xLgr"),
    numero: texto(ender, "nro"),
    complemento: texto(ender, "xCpl"),
    bairro: texto(ender, "xBairro"),
    codigo_municipio: texto(ender, "cMun"),
    municipio: texto(ender, "xMun"),
    cep: texto(ender, "CEP"),
  };
}
