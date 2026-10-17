/**
 * Complemento do cadastro de clientes pela exportação do GRV (CLIENTE.xlsx) — C-01. Só regra, sem
 * banco: casa cada cliente da plataforma com UMA linha do GRV e diz quais campos VAZIOS ela completa,
 * já no formato do cadastro (o mesmo do destinatário da NF-e). Nunca sobrescreve.
 *
 * Entra agora só pessoa jurídica no Brasil, casada pelo nome sem ambiguidade. Fica de fora, para a
 * decisão do Comercial (relatório): fábricas do mesmo cliente com CNPJs diferentes (ambíguo), dois
 * clientes da plataforma no mesmo registro do GRV (duplicados: unificar antes), exterior (fica com o
 * Fiscal), pessoa física e quem só existe no GRV.
 */

export type LinhaCliente = Record<string, string | number | null>;
export type ClientePlataforma = {
  id: string; name: string; tax_id: string | null; ie: string | null; ind_ie: number | null; cep: string | null; logradouro: string | null;
  numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; codigo_municipio: string | null; uf: string | null;
  telefone: string | null; email_nfe: string | null; merged_into: string | null;
};
export type CamposCliente = Partial<Pick<ClientePlataforma, "tax_id" | "ie" | "ind_ie" | "cep" | "logradouro" | "bairro" | "municipio" | "uf" | "telefone">>;
export type PlanoClientes = {
  completar: { id: string; nome: string; razaoGrv: string; campos: CamposCliente }[];
  jaCompletos: number;
  fabricas: { id: string; nome: string; opcoes: string[] }[];
  duplicados: { razaoGrv: string; nomes: string[] }[];
  exterior: { id: string; nome: string; pais: string }[];
  pessoaFisica: { id: string; nome: string }[];
  semPar: { id: string; nome: string }[];
  novos: { nome: string; razao: string; pessoa: "PJ" | "PF"; cidade: string; uf: string; pais: string }[];
};

const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const txt = (v: unknown, max = 60) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
export function normCliente(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\bS\s*[./]?\s*A\b\.?/g, " ")
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|S\.A\.|SA|CIA|COMERCIO|COM|IND(USTRIA)?|E|DE|DO|DA|DOS|DAS)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}
const pessoaFisica = (l: LinhaCliente) => /^f/i.test(String(l["Pessoa"] ?? ""));
const exterior = (l: LinhaCliente) => String(l["Pais"] ?? "BRASIL").trim().toUpperCase() !== "BRASIL" || String(l["U.F."] ?? "").toUpperCase() === "EX";

/** Campos que a linha do GRV traz, já validados como o cadastro do destinatário exige. */
export function camposDoCliente(l: LinhaCliente): CamposCliente {
  const c: CamposCliente = {};
  const cnpj = dig(l["CNPJ / CPF"]);
  if (cnpj.length === 14) c.tax_id = cnpj;
  const ie = String(l["I.E. / RG"] ?? "").trim().toUpperCase();
  if (/^ISENT/.test(ie)) c.ie = "ISENTO"; else if (dig(ie).length >= 2 && dig(ie).length <= 14) c.ie = dig(ie);
  const ind = String(l["Indicador do IE do Destinatário"] ?? "").trim().slice(0, 1);
  if (["1", "2", "9"].includes(ind)) c.ind_ie = Number(ind);
  const cep = dig(l["CEP"]);
  if (cep.length === 8) c.cep = cep;
  const rua = txt(l["Endereço"]); if (rua) c.logradouro = rua;
  const bairro = txt(l["Bairro"]); if (bairro) c.bairro = bairro;
  const cidade = txt(l["Cidade"]); if (cidade) c.municipio = cidade;
  const uf = String(l["U.F."] ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(uf) && uf !== "EX") c.uf = uf;
  // Telefone só com dígitos, com o DDD quando o GRV guarda o DDD à parte.
  let fone = dig(l["Telefone (1)"]);
  const ddd = dig(l["DDD do Telefone do Cliente"]);
  if (fone.length >= 8 && fone.length <= 9 && ddd.length === 2) fone = ddd + fone;
  if (fone.length >= 6 && fone.length <= 14) c.telefone = fone;
  return c;
}

export function planejarClientes(planilha: LinhaCliente[], clientes: ClientePlataforma[]): PlanoClientes {
  const linhas = planilha.filter((l) => txt(l["R. Social"]) || txt(l["*Nome"]));
  const porNome = new Map<string, LinhaCliente[]>();
  for (const l of linhas) for (const k of ["R. Social", "*Nome"]) {
    const n = normCliente(l[k]);
    if (n.length >= 3) { const atual = porNome.get(n) ?? []; if (!atual.includes(l)) porNome.set(n, [...atual, l]); }
  }
  const plano: PlanoClientes = { completar: [], jaCompletos: 0, fabricas: [], duplicados: [], exterior: [], pessoaFisica: [], semPar: [], novos: [] };
  const ativos = clientes.filter((c) => !c.merged_into);
  const casamento = new Map<string, LinhaCliente>();
  const usadas = new Set<LinhaCliente>();
  for (const c of ativos) {
    const cand = porNome.get(normCliente(c.name)) ?? [];
    if (!cand.length) { plano.semPar.push({ id: c.id, nome: c.name }); continue; }
    cand.forEach((l) => usadas.add(l));
    const docs = new Set(cand.map((l) => dig(l["CNPJ / CPF"])));
    if (docs.size > 1) {
      plano.fabricas.push({ id: c.id, nome: c.name, opcoes: cand.map((l) => `${l["*Nome"]} · ${l["CNPJ / CPF"]} · ${l["Cidade"]}/${l["U.F."]}`) });
      continue;
    }
    casamento.set(c.id, cand[0]);
  }
  // Dois clientes da plataforma no mesmo registro do GRV: unificar antes (o CNPJ não vai para os dois).
  const porLinha = new Map<LinhaCliente, ClientePlataforma[]>();
  for (const c of ativos) { const l = casamento.get(c.id); if (l) porLinha.set(l, [...(porLinha.get(l) ?? []), c]); }
  for (const [l, cs] of porLinha) {
    if (cs.length > 1) { plano.duplicados.push({ razaoGrv: String(l["R. Social"] ?? l["*Nome"]), nomes: cs.map((c) => c.name) }); continue; }
    const c = cs[0];
    if (exterior(l)) { plano.exterior.push({ id: c.id, nome: c.name, pais: String(l["Pais"] ?? "") }); continue; }
    if (pessoaFisica(l)) { plano.pessoaFisica.push({ id: c.id, nome: c.name }); continue; }
    const novos = camposDoCliente(l);
    const campos: CamposCliente = {};
    for (const [k, v] of Object.entries(novos) as [keyof CamposCliente, string | number][]) {
      const atual = c[k];
      if (atual === null || atual === undefined || String(atual).trim() === "") (campos as Record<string, string | number>)[k] = v;
    }
    if (Object.keys(campos).length) plano.completar.push({ id: c.id, nome: c.name, razaoGrv: String(l["R. Social"] ?? ""), campos });
    else plano.jaCompletos++;
  }
  for (const l of linhas) {
    if (usadas.has(l)) continue;
    plano.novos.push({ nome: String(l["*Nome"] ?? ""), razao: String(l["R. Social"] ?? ""), pessoa: pessoaFisica(l) ? "PF" : "PJ",
      cidade: txt(l["Cidade"]) ?? "", uf: String(l["U.F."] ?? ""), pais: String(l["Pais"] ?? "") });
  }
  return plano;
}
