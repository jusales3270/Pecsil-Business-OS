/**
 * Extrato do Itaú em PDF (layout "Lançamentos do período", Itaú BBA): colunas
 * Data | Lançamentos | Razão Social | CNPJ/CPF | Valor | Saldo.
 *
 * Cada lançamento é ancorado na linha que tem a data; o texto que quebra em mais
 * linhas (lançamento ou razão social) fica logo acima e logo abaixo dessa linha,
 * e o que sobra no pé da página continua no primeiro lançamento da página seguinte.
 * O histórico é montado como no OFX do mesmo banco (lançamento + razão social +
 * documento), para a mesma operação ter a mesma chave nos dois formatos e não
 * duplicar. Devolve o mesmo formato do leitor de OFX.
 */
import type { ItemPdf } from "../arquivos/pdf-texto";
import type { LancamentoOfx, SaldoDia } from "./ofx-parser";
import type { ExtratoPlanilha } from "./extrato-planilha";

export class ExtratoPdfInvalido extends Error {}

const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const VALOR = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const iso = (t: string) => t.replace(DATA, "$3-$2-$1");
const centavos = (t: string) => {
  const neg = t.startsWith("-");
  const [i, f] = t.replace(/[-.]/g, "").split(",");
  const v = Number(i) * 100 + Number(f);
  return neg ? -v : v;
};

type Registro = { data: string; partes: ItemPdf[]; y: number };

/** Junta os pedaços em linhas (mesmo y, com tolerância), da esquerda para a direita. */
function linhasDoPdf(pagina: ItemPdf[], tolerancia = 2): ItemPdf[][] {
  const linhas: ItemPdf[][] = [];
  for (const it of [...pagina].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const atual = linhas.at(-1);
    if (atual && Math.abs(atual[0].y - it.y) <= tolerancia) atual.push(it);
    else linhas.push([it]);
  }
  return linhas.map((l) => l.sort((a, b) => a.x - b.x));
}

/** Identifica o PDF de extrato do Itaú pelo cabeçalho da tabela. */
export function pareceExtratoItau(paginas: ItemPdf[][]): boolean {
  const texto = (paginas[0] ?? []).map((i) => i.s).join(" ");
  return /Lançamentos do período/i.test(texto) && /Razão Social/i.test(texto) && /CNPJ\/CPF/i.test(texto) && /Agência\s*\d{4}/.test(texto);
}

export function lerExtratoItauPdf(paginas: ItemPdf[][]): ExtratoPlanilha {
  if (!pareceExtratoItau(paginas)) throw new ExtratoPdfInvalido("Este PDF não é um extrato do Itaú no formato \"Lançamentos do período\".");
  const topo = paginas[0].map((i) => i.s).join(" ");
  const agencia = topo.match(/Agência\s*(\d{4})/)?.[1] ?? "";
  const conta = (topo.match(/Conta\s*([\d.-]+)/)?.[1] ?? "").replace(/\D/g, "");
  if (!agencia || conta.length < 2) throw new ExtratoPdfInvalido("Agência ou conta não encontradas no cabeçalho do PDF.");

  const registros: Registro[] = [];
  let sobra: ItemPdf[] = []; // texto do pé da página que continua no 1º lançamento da seguinte
  let saldoFinal: number | null = null;

  for (const pagina of paginas) {
    // Corpo da tabela: abaixo do cabeçalho (na 1ª página) e acima do rodapé "aviso:".
    const cabecalho = pagina.find((i) => i.s.trim() === "Data" && i.x < 60);
    const aviso = pagina.find((i) => /^aviso:/i.test(i.s.trim()));
    const corpo = pagina.filter((i) => (!cabecalho || i.y < cabecalho.y - 1) && (!aviso || i.y > aviso.y + 1));
    const linhas = linhasDoPdf(corpo);
    const ancoras = linhas.filter((l) => l[0].x < 60 && DATA.test(l[0].s.trim()));
    const soltas = linhas.filter((l) => !ancoras.includes(l)).flat();
    if (!ancoras.length) { sobra.push(...soltas); continue; }
    const daPagina: Registro[] = ancoras.map((l) => ({ data: iso(l[0].s.trim()), partes: l.slice(1), y: l[0].y }));
    // A sobra da página anterior vem antes (acima) do texto do 1º lançamento desta.
    if (sobra.length) {
      daPagina[0].partes.push(...sobra.map((p) => ({ ...p, y: daPagina[0].y + 100 + p.y })));
      sobra = [];
    }
    const ultima = daPagina[daPagina.length - 1];
    for (const it of soltas) {
      // Texto quebrado fica a ~6 pontos da linha da data: vai para a âncora mais próxima.
      let melhor = daPagina[0];
      for (const r of daPagina) if (Math.abs(r.y - it.y) < Math.abs(melhor.y - it.y)) melhor = r;
      if (melhor === ultima && it.y < ultima.y - 9) sobra.push(it);
      else melhor.partes.push(it);
    }
    registros.push(...daPagina);
  }
  if (sobra.length && registros.length) registros[registros.length - 1].partes.push(...sobra);

  const lancamentos: LancamentoOfx[] = [];
  const saldosDiarios: SaldoDia[] = [];
  let saldoAnterior: { data: string; centavos: number } | null = null;

  for (const r of registros) {
    const ordem = [...r.partes].sort((a, b) => b.y - a.y || a.x - b.x);
    // Pedaços da mesma célula: palavra quebrada com hífen ("PIX QR-" / "CODE") junta sem espaço, como no OFX.
    const coluna = (min: number, max: number) =>
      ordem
        .filter((i) => i.x >= min && i.x < max && !VALOR.test(i.s.trim()))
        .map((i) => i.s.trim())
        .reduce((acc, t) => (!acc ? t : acc.endsWith("-") ? acc + t : `${acc} ${t}`), "");
    const numeros = ordem.filter((i) => VALOR.test(i.s.trim()));
    // Valor termina por volta de x≈505; saldo, por volta de x≈565.
    const valor = numeros.find((i) => i.x + i.w < 515);
    const saldo = numeros.find((i) => i.x + i.w >= 515);
    const lancamento = coluna(80, 220).replace(/\s+/g, " ").trim();
    const razao = coluna(220, 355).replace(/\s+/g, " ").trim();
    const documento = coluna(355, 445).replace(/\s+/g, " ").trim();

    if (/^SALDO ANTERIOR$/i.test(lancamento)) { if (saldo) saldoAnterior = { data: r.data, centavos: centavos(saldo.s.trim()) }; continue; }
    if (/^SALDO TOTAL DISPON/i.test(lancamento)) { if (saldo) saldosDiarios.push({ data: r.data, centavos: centavos(saldo.s.trim()) }); continue; }
    if (/^SALDO EM CONTA CORRENTE/i.test(lancamento)) { if (saldo) saldoFinal = centavos(saldo.s.trim()); continue; }
    if (!valor) throw new ExtratoPdfInvalido(`Lançamento de ${r.data} sem valor: "${lancamento}".`);
    const c = centavos(valor.s.trim());
    lancamentos.push({ data: r.data, centavos: c, fitid: "", memo: [lancamento, razao, documento].filter(Boolean).join(" "), tipo: c < 0 ? "DEBIT" : "CREDIT" });
  }
  if (!lancamentos.length) throw new ExtratoPdfInvalido("Nenhum lançamento encontrado no PDF.");

  return {
    banco: "0341",
    conta: `${agencia}${conta}`,
    tipoConta: "CHECKING",
    moeda: "BRL",
    inicio: lancamentos[0].data,
    fim: lancamentos[lancamentos.length - 1].data,
    saldoAnterior,
    lancamentos,
    saldosDiarios,
    saldoFinal,
    agencia,
    // "0004024-3" → conta 04024 e dígito 3 (o mesmo padrão do OFX: 5 dígitos + dígito).
    numeroConta: conta.slice(0, -1).slice(-5),
    digito: conta.slice(-1),
    saldoCorridoDivergente: 0,
  };
}
