/**
 * Complemento do cadastro de fornecedores pela exportação do GRV (FORNECEDORES.xlsx). Só regra, sem
 * banco: casa cada fornecedor da plataforma com uma linha da planilha e diz quais campos VAZIOS ela
 * completa. Nunca sobrescreve o que já está na plataforma.
 *
 * Casamento: 1) mesmo CNPJ; 2) mesmo nome normalizado (razão social, nome ou fantasia) quando a
 * planilha só tem UM CNPJ para aquele nome. Mais de um CNPJ possível = ambíguo (vai para conferência).
 * Pessoa física (CPF) não recebe nenhum dado: endereço, telefone e e-mail de pessoa são dado pessoal
 * e esperam a decisão da área. A própria empresa e CNPJ repetido na planilha ficam de fora.
 */

export type LinhaGrv = Record<string, string | number | null>;
export type FornecedorPlataforma = {
  id: string; name: string; legal_name: string | null; trade_name: string | null; tax_id: string | null; state_registration: string | null;
  contact_name: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; postal_code: string | null;
  merged_into: string | null;
};
export type Campos = Partial<Pick<FornecedorPlataforma, "tax_id" | "state_registration" | "contact_name" | "phone" | "email" | "address" | "city" | "state" | "postal_code" | "legal_name">>;
export type Plano = {
  completar: { id: string; nome: string; razaoGrv: string; como: "cnpj" | "nome"; campos: Campos }[];
  jaCompletos: number;
  ambiguos: { id: string; nome: string; opcoes: string[] }[];
  pessoaFisica: { id: string; nome: string }[];
  semPar: { id: string; nome: string }[];
  novos: { razao: string; tipo: string; pessoa: "PJ" | "PF"; cidade: string; uf: string; inativo: boolean }[];
  repetidosNaPlanilha: { cnpj: string; razoes: string[] }[];
};

const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const txt = (v: unknown) => { const s = String(v ?? "").trim(); return s && s !== "**********" ? s : null; };
export function normNome(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|S\.A\.|SA|CIA|COMERCIO|IND(USTRIA)?|E|DE|DO|DA|DOS|DAS)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}
const pessoaFisica = (l: LinhaGrv) => /^f/i.test(String(l["Tipo de Pessoa"] ?? ""));
export const cnpjFormatado = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

/** Campos que a linha do GRV traz, já validados e no formato da plataforma (só pessoa jurídica). */
export function camposDaLinha(l: LinhaGrv): Campos {
  const c: Campos = {};
  const cnpj = dig(l["*C.N.P.J/CPF"]);
  // Como a plataforma guarda: CNPJ e CEP só com os dígitos.
  if (cnpj.length === 14) c.tax_id = cnpj;
  const ie = txt(l["I.E./RG"]);
  if (ie && /^(ISENTO|[\d.\-/]{2,20})$/i.test(ie)) c.state_registration = ie.toUpperCase();
  const email = txt(l["E-mail"])?.split(/[;,\s]+/).find((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (email) c.email = email.toLowerCase();
  const fone = txt(l["Telefone (1)"]);
  if (fone && dig(fone).length >= 8) c.phone = fone.slice(0, 40);
  const end = [txt(l["Endereço"]), txt(l["Bairro"])].filter(Boolean).join(", ");
  if (end) c.address = end.slice(0, 200);
  const cidade = txt(l["Cidade"]);
  if (cidade) c.city = cidade.slice(0, 80);
  const uf = txt(l["*Estado"])?.toUpperCase();
  if (uf && /^[A-Z]{2}$/.test(uf) && uf !== "EX") c.state = uf;
  const cep = dig(l["CEP"]);
  if (cep.length === 8) c.postal_code = cep;
  const razao = txt(l["*Razão Social"]);
  if (razao) c.legal_name = razao.slice(0, 200);
  const contato = txt(l["Contato"]);
  if (contato && !/@/.test(contato)) c.contact_name = contato.slice(0, 120);
  return c;
}

export function planejarCarga(planilha: LinhaGrv[], fornecedores: FornecedorPlataforma[], cnpjProprio: string): Plano {
  const proprio = dig(cnpjProprio);
  const linhas = planilha.filter((l) => dig(l["*C.N.P.J/CPF"]) !== proprio && txt(l["*Razão Social"]));
  const porCnpj = new Map<string, LinhaGrv[]>();
  for (const l of linhas) { const c = dig(l["*C.N.P.J/CPF"]); if (c.length === 14) porCnpj.set(c, [...(porCnpj.get(c) ?? []), l]); }
  const repetidosNaPlanilha = [...porCnpj.entries()].filter(([, ls]) => ls.length > 1).map(([cnpj, ls]) => ({ cnpj, razoes: ls.map((l) => String(l["*Razão Social"])) }));
  const repetido = new Set(repetidosNaPlanilha.map((r) => r.cnpj));
  const porNome = new Map<string, LinhaGrv[]>();
  for (const l of linhas) for (const k of ["*Razão Social", "*Nome"]) {
    const n = normNome(l[k]);
    if (n.length >= 4) { const atual = porNome.get(n) ?? []; if (!atual.includes(l)) porNome.set(n, [...atual, l]); }
  }
  const plano: Plano = { completar: [], jaCompletos: 0, ambiguos: [], pessoaFisica: [], semPar: [], novos: [], repetidosNaPlanilha };
  const usadas = new Set<LinhaGrv>();
  for (const f of fornecedores.filter((x) => !x.merged_into)) {
    let linha: LinhaGrv | null = null; let como: "cnpj" | "nome" = "cnpj";
    const c = dig(f.tax_id);
    if (c.length === 14 && porCnpj.has(c) && !repetido.has(c)) linha = porCnpj.get(c)![0];
    if (!linha) {
      for (const n of [normNome(f.legal_name), normNome(f.name), normNome(f.trade_name)]) {
        const cand = n ? porNome.get(n) : undefined;
        if (!cand?.length) continue;
        const docs = new Set(cand.map((l) => dig(l["*C.N.P.J/CPF"])));
        if (docs.size > 1) { plano.ambiguos.push({ id: f.id, nome: f.name, opcoes: cand.map((l) => `${l["*Razão Social"]}${pessoaFisica(l) ? " (pessoa física)" : ` (${cnpjFormatado(dig(l["*C.N.P.J/CPF"]))})`}`) }); cand.forEach((l) => usadas.add(l)); linha = null; como = "nome"; break; }
        linha = cand[0]; como = "nome"; break;
      }
      if (!linha && plano.ambiguos.some((a) => a.id === f.id)) continue;
    }
    if (!linha) { plano.semPar.push({ id: f.id, nome: f.name }); continue; }
    usadas.add(linha);
    if (pessoaFisica(linha)) { plano.pessoaFisica.push({ id: f.id, nome: f.name }); continue; }
    const novos = camposDaLinha(linha);
    const campos: Campos = {};
    for (const [k, v] of Object.entries(novos) as [keyof Campos, string][]) {
      const atual = f[k];
      if (atual === null || atual === undefined || String(atual).trim() === "") campos[k] = v;
    }
    // CNPJ que a plataforma já tem e é diferente: não mexe (fica para a conferência).
    if (c.length === 14 && novos.tax_id && dig(novos.tax_id) !== c) { plano.ambiguos.push({ id: f.id, nome: f.name, opcoes: [`CNPJ na plataforma ${cnpjFormatado(c)} × no GRV ${novos.tax_id}`] }); continue; }
    if (Object.keys(campos).length) plano.completar.push({ id: f.id, nome: f.name, razaoGrv: String(linha["*Razão Social"]), como, campos });
    else plano.jaCompletos++;
  }
  for (const l of linhas) {
    if (usadas.has(l)) continue;
    plano.novos.push({ razao: String(l["*Razão Social"]), tipo: String(l["*Tipo de Fornecedor"] ?? ""), pessoa: pessoaFisica(l) ? "PF" : "PJ",
      cidade: txt(l["Cidade"]) ?? "", uf: txt(l["*Estado"]) ?? "", inativo: /^s/i.test(String(l["Inativo"] ?? "")) });
  }
  return plano;
}
