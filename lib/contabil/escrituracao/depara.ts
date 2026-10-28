/**
 * De-para proposto (N-04 passo 5): o que o plano do escritório já diz sobre os cadastros do Financeiro. Puro.
 * Tudo sai como PROPOSTA com a evidência; quem confirma é a área (Financeiro com o escritório). O motor só usa
 * vínculo confirmado.
 * - Fornecedor → a conta própria dele no plano (o escritório tem uma por fornecedor): nome igual ao do cadastro,
 *   ou o nome do plano é o começo da razão social (o plano corta em uns 40 caracteres); sem isso, nome parecido
 *   (abreviado: "Ind E Mecanica" = "Industria Mecanica"), marcado para conferir. Mais de uma conta possível = nenhuma
 *   proposta.
 * - Conta bancária → a conta do plano que tem o mesmo número de conta e o nome do banco.
 * - Conta gerencial → pelo voto do histórico: as compras de cada fornecedor foram lançadas pelo escritório em
 *   certas contas (a ECD do ano anterior); os títulos da conta gerencial, pelos fornecedores, votam nessas contas.
 */

export type ContaRef = { id: string; codigo: string; nome: string; natureza?: string };
export type Fornecedor = { id: string; name: string | null; legal_name?: string | null; trade_name?: string | null };
export type Proposta = { chave: string; conta_id: string; evidencia: string };

export const normalizarNome = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/&/g, " E ").replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const FIM = new Set(["LTDA", "LTD", "LT", "L", "EIRELI", "EIREL", "EIRE", "ME", "EPP", "SA", "CIA", "MEI"]);
/** Tira o tipo de sociedade do fim (LTDA, EIRELI, S/A, ME…), que o plano e o cadastro escrevem cada um de um jeito. */
export function semSociedade(nome: string) {
  const t = nome.split(" ");
  for (;;) {
    if (t.length > 1 && FIM.has(t[t.length - 1])) { t.pop(); continue; }
    if (t.length > 2 && t[t.length - 1] === "A" && t[t.length - 2] === "S") { t.splice(-2); continue; }
    return t.join(" ");
  }
}
/** O plano do escritório corta o nome; a partir daqui de tamanho, o nome pode ser só o começo da razão social. */
const CORTE = 36;
const VAZIAS = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "EM", "S", "A", ...FIM]);
const palavras = (nome: string) => normalizarNome(nome).split(" ").filter((t) => t && !VAZIAS.has(t));
/** Mesma palavra, ou uma é o começo da outra (abreviação: IND = INDUSTRIA), com 3 letras ou mais. */
const mesmaPalavra = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
/** Quanto do nome da conta aparece no nome do cadastro (0 a 1). A 1ª palavra de 3 letras ou mais tem de bater. */
function parecido(conta: string[], cadastro: string[]) {
  const principal = (x: string[]) => x.find((t) => t.length >= 3);
  const pc = principal(conta), pf = principal(cadastro);
  if (!pc || !pf || !mesmaPalavra(pc, pf) || conta.length < 2) return 0;
  const usadas = new Set<number>();
  let iguais = 0;
  for (const t of conta) {
    const k = cadastro.findIndex((u, i) => !usadas.has(i) && mesmaPalavra(t, u));
    if (k >= 0) { usadas.add(k); iguais++; }
  }
  return iguais >= 2 ? iguais / conta.length : 0;
}
const PARECIDO = 0.75;

export function proporFornecedores(fornecedores: readonly Fornecedor[], contas: readonly ContaRef[]) {
  const porChave = new Map<string, ContaRef[]>();
  for (const c of contas) {
    const k = semSociedade(normalizarNome(c.nome));
    if (k) porChave.set(k, [...(porChave.get(k) ?? []), c]);
  }
  const cortadas = contas.filter((c) => c.nome.trim().length >= CORTE).map((c) => ({ c, k: normalizarNome(c.nome) }));
  const palavrasConta = contas.map((c) => ({ c, p: palavras(c.nome) }));
  const propostas: Proposta[] = [];
  const ambiguos: { chave: string; contas: string[] }[] = [];
  for (const f of fornecedores) {
    const nomes = [f.legal_name, f.name, f.trade_name].filter((x): x is string => Boolean(x && x.trim())).map(normalizarNome);
    const achadas = new Map<string, { c: ContaRef; como: "igual" | "comeco" | "parecido" }>();
    for (const n of nomes) for (const c of porChave.get(semSociedade(n)) ?? []) achadas.set(c.id, { c, como: "igual" });
    if (!achadas.size) for (const n of nomes) for (const x of cortadas) if (n.startsWith(x.k)) achadas.set(x.c.id, { c: x.c, como: "comeco" });
    let nota = 0;
    if (!achadas.size) {
      // Nome parecido: só o melhor, e só se for um.
      const nomesF = nomes.map((n) => palavras(n));
      const notas = palavrasConta.map((x) => ({ c: x.c, nota: Math.max(...nomesF.map((p) => parecido(x.p, p))) })).filter((x) => x.nota >= PARECIDO);
      nota = Math.max(0, ...notas.map((x) => x.nota));
      for (const x of notas) if (x.nota === nota) achadas.set(x.c.id, { c: x.c, como: "parecido" });
    }
    if (achadas.size === 1) {
      const [{ c, como }] = achadas.values();
      propostas.push({ chave: f.id, conta_id: c.id, evidencia: como === "igual" ? `Nome igual ao do cadastro (${c.codigo} ${c.nome})`
        : como === "comeco" ? `O nome no plano (${c.codigo} ${c.nome}) é o começo da razão social do cadastro`
        : `Nome parecido, confira: ${c.codigo} ${c.nome} (${Math.round(nota * 100)}% das palavras)` });
    } else if (achadas.size > 1) ambiguos.push({ chave: f.id, contas: [...achadas.values()].map((x) => x.c.codigo) });
  }
  return { propostas, ambiguos };
}

export type ContaBancaria = { id: string; bank_name: string | null; account_number: string | null; account_digit?: string | null };
const digitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

export function proporBancos(bancos: readonly ContaBancaria[], contas: readonly ContaRef[]): Proposta[] {
  const saida: Proposta[] = [];
  for (const b of bancos) {
    if (!b.account_number) continue;
    const numero = digitos(`${b.account_number}${b.account_digit ?? ""}`);
    const banco = normalizarNome(b.bank_name ?? "").split(" ")[0];
    if (numero.length < 4 || !banco) continue;
    const achadas = contas.filter((c) => {
      const nome = normalizarNome(c.nome);
      return nome.includes(banco) && (c.nome.match(/[\d][\d.\-/]*[\d]/g) ?? []).some((trecho) => digitos(trecho) === numero);
    });
    // Empate (cheque especial, aplicação da mesma conta): vale a conta corrente, a que se chama "Banco…".
    const correntes = achadas.length > 1 ? achadas.filter((c) => /^(BANCO|BCO)\b/.test(normalizarNome(c.nome))) : achadas;
    if (correntes.length === 1) saida.push({ chave: b.id, conta_id: correntes[0].id, evidencia: `Mesmo banco e mesma conta (${correntes[0].codigo} ${correntes[0].nome})` });
  }
  return saida;
}

export type PartidaHist = { lancamento_id: string; conta_id: string; lado: "D" | "C"; valor: number };
export type TituloVoto = { conta_gerencial: string; fornecedor: string; valor: number };

/**
 * Voto do histórico. `contaDoFornecedor`: fornecedor → conta dele no plano. Em cada lançamento do histórico que credita
 * a conta de um fornecedor (a compra), o débito diz onde o escritório pôs a compra. Cada título da conta gerencial
 * vota, pelo valor, nas contas onde as compras do seu fornecedor foram lançadas. Proposta só com maioria clara.
 */
export function proporGerenciais(
  partidas: readonly PartidaHist[], titulos: readonly TituloVoto[], contaDoFornecedor: ReadonlyMap<string, string>, contas: readonly ContaRef[],
  opcoes = { participacaoMinima: 0.6, titulosMinimos: 3 },
): Proposta[] {
  const contasForn = new Set(contaDoFornecedor.values());
  const porLanc = new Map<string, PartidaHist[]>();
  for (const p of partidas) porLanc.set(p.lancamento_id, [...(porLanc.get(p.lancamento_id) ?? []), p]);
  // Para cada conta de fornecedor: onde o escritório debitou as compras dela (valor).
  const destino = new Map<string, Map<string, number>>();
  for (const ps of porLanc.values()) {
    const creditos = ps.filter((p) => p.lado === "C" && contasForn.has(p.conta_id));
    if (!creditos.length) continue;
    const debitos = ps.filter((p) => p.lado === "D" && !contasForn.has(p.conta_id));
    const totalC = creditos.reduce((s, p) => s + Number(p.valor), 0);
    for (const c of creditos) {
      const m = destino.get(c.conta_id) ?? new Map<string, number>();
      for (const d of debitos) m.set(d.conta_id, (m.get(d.conta_id) ?? 0) + Number(d.valor) * (Number(c.valor) / totalC));
      destino.set(c.conta_id, m);
    }
  }
  const porId = new Map(contas.map((c) => [c.id, c]));
  const votos = new Map<string, { contas: Map<string, number>; titulos: number; fornecedores: Set<string> }>();
  for (const t of titulos) {
    const contaF = contaDoFornecedor.get(t.fornecedor);
    const m = contaF ? destino.get(contaF) : undefined;
    if (!m || !m.size) continue;
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    if (!(total > 0)) continue;
    const g = votos.get(t.conta_gerencial) ?? { contas: new Map<string, number>(), titulos: 0, fornecedores: new Set<string>() };
    for (const [x, v] of m) g.contas.set(x, (g.contas.get(x) ?? 0) + Number(t.valor) * (v / total));
    g.titulos++; g.fornecedores.add(t.fornecedor);
    votos.set(t.conta_gerencial, g);
  }
  const saida: Proposta[] = [];
  for (const [gerencial, g] of votos) {
    const total = [...g.contas.values()].reduce((s, v) => s + v, 0);
    const [melhor, valor] = [...g.contas].sort((a, b) => b[1] - a[1])[0] ?? [];
    const conta = melhor ? porId.get(melhor) : undefined;
    if (!conta || !(total > 0) || g.titulos < opcoes.titulosMinimos) continue;
    const parte = valor / total;
    if (parte < opcoes.participacaoMinima) continue;
    saida.push({
      chave: gerencial, conta_id: conta.id,
      evidencia: `No histórico do escritório, as compras dos fornecedores desta conta foram lançadas em ${conta.codigo} ${conta.nome}: ${Math.round(parte * 100)}% do valor (${g.titulos} título(s), ${g.fornecedores.size} fornecedor(es))`,
    });
  }
  return saida;
}
