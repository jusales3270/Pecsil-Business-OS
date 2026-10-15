/**
 * Busca de produto no item do orçamento: o Rafael digita o começo do código (5-01, 50100339, 339)
 * ou palavras da descrição (anel cerveja) e a lista abre com as peças que batem. Código que começa
 * com o que foi digitado vem primeiro; depois código que contém; depois descrição. Peças do cliente
 * do orçamento sobem dentro de cada faixa.
 */

export type ProdutoBuscavel = {
  id: string; codigo: string; descricao: string; desenho_codigo?: string | null; material?: string | null;
  customer_id?: string | null; nome_cliente?: string | null;
};

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soAlfanum = (t: string) => semAcento(t).replace(/[^0-9a-z]/g, "");

export function buscarProdutos<T extends ProdutoBuscavel>(produtos: readonly T[], texto: string, opcoes: { clienteId?: string | null; limite?: number } = {}): T[] {
  const limite = opcoes.limite ?? 30;
  const termo = semAcento(texto.trim());
  const doCliente = (p: T) => (opcoes.clienteId && p.customer_id === opcoes.clienteId ? 0 : 1);
  if (!termo) return [...produtos].sort((a, b) => doCliente(a) - doCliente(b) || a.codigo.localeCompare(b.codigo)).slice(0, limite);

  const compacto = soAlfanum(termo);
  const palavras = termo.split(/\s+/).filter(Boolean);
  const achados: { p: T; faixa: number }[] = [];
  for (const p of produtos) {
    const codigo = semAcento(p.codigo);
    const codigoCompacto = soAlfanum(p.codigo);
    const descricao = semAcento(p.descricao);
    const resto = semAcento([p.desenho_codigo, p.material, p.nome_cliente].filter(Boolean).join(" "));
    let faixa: number | null = null;
    if (codigo.startsWith(termo) || (compacto && codigoCompacto.startsWith(compacto))) faixa = 0;
    else if (codigo.includes(termo) || (compacto.length >= 3 && codigoCompacto.includes(compacto))) faixa = 1;
    else if (descricao.startsWith(termo)) faixa = 2;
    else if (palavras.every((w) => descricao.includes(w) || codigo.includes(w) || resto.includes(w))) faixa = 3;
    if (faixa !== null) achados.push({ p, faixa });
  }
  return achados
    .sort((a, b) => a.faixa - b.faixa || doCliente(a.p) - doCliente(b.p) || a.p.codigo.localeCompare(b.p.codigo))
    .slice(0, limite)
    .map((a) => a.p);
}

/** O texto digitado parece um código interno (5-01-00339, 5-24-40)? Vai para o campo código do cadastro. */
export const pareceCodigo = (texto: string) => /^[0-9A-Z]{1,6}-[0-9A-Z]{1,6}(-[0-9A-Z./-]*)?$/i.test(texto.trim());
