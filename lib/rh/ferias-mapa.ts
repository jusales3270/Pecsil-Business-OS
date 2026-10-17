/**
 * Mapa de férias por setor (R-03, parte 2). Só regra, sem banco e sem React: setores nas linhas, os
 * próximos 12 meses nas colunas. Em cada mês: quem do setor tem férias (aprovadas ou registradas) que
 * tocam o mês e quantos dias caem nele, e os saldos cujo prazo de concessão vence no mês. À parte, os
 * saldos com o prazo já vencido (férias em dobro, CLT art. 137).
 */

export type Setor = { id: string; nome: string; ativos: number };
export type Ferias = { employee: string; nome: string; setor: string; inicio: string; fim: string; status: string };
export type Concessivo = { employee: string; nome: string; setor: string; vence: string; saldo: number; aquisitivoInicio: string; aquisitivoFim: string };
export type DadosMapa = { hoje: string; inicio: string; fim: string; setores: Setor[]; ferias: Ferias[]; concessivos: Concessivo[] };

export type Fora = { employee: string; nome: string; inicio: string; fim: string; diasNoMes: number };
export type Celula = { mes: string; fora: Fora[]; parte: number; vencem: Concessivo[] };
export type Linha = { setor: Setor; vencidos: Concessivo[]; celulas: Celula[] };
export type Mapa = { meses: { chave: string; rotulo: string }[]; linhas: Linha[]; vencidos: number; vencemNaJanela: number; maiorParte: { setor: string; mes: string; parte: number } | null };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "AAAA-MM" de n meses depois de `iso`. */
export function mesMais(iso: string, n: number): string {
  const [a, m] = iso.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const ultimoDia = (mes: string) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };

/** Dias de [inicio, fim] que caem no mês "AAAA-MM". */
export function diasNoMes(inicio: string, fim: string, mes: string): number {
  const de = `${mes}-01`, ate = `${mes}-${String(ultimoDia(mes)).padStart(2, "0")}`;
  const a = inicio > de ? inicio : de, b = fim < ate ? fim : ate;
  if (a > b) return 0;
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;
}

export function montarMapa(d: DadosMapa, nMeses = 12): Mapa {
  const primeiro = d.inicio.slice(0, 7);
  const meses = Array.from({ length: nMeses }, (_, i) => {
    const chave = mesMais(primeiro, i);
    return { chave, rotulo: `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}` };
  });
  let maiorParte: Mapa["maiorParte"] = null;
  const linhas = d.setores.map((setor) => {
    const ferias = d.ferias.filter((f) => f.setor === setor.id);
    const conc = d.concessivos.filter((c) => c.setor === setor.id);
    const celulas = meses.map(({ chave }) => {
      const porPessoa = new Map<string, Fora>();
      for (const f of ferias) {
        const n = diasNoMes(f.inicio, f.fim, chave);
        if (!n) continue;
        const atual = porPessoa.get(f.employee);
        if (atual) atual.diasNoMes += n;
        else porPessoa.set(f.employee, { employee: f.employee, nome: f.nome, inicio: f.inicio, fim: f.fim, diasNoMes: n });
      }
      const fora = [...porPessoa.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
      const parte = setor.ativos ? fora.length / setor.ativos : 0;
      if (fora.length && (!maiorParte || parte > maiorParte.parte)) maiorParte = { setor: setor.nome, mes: chave, parte };
      return { mes: chave, fora, parte, vencem: conc.filter((c) => c.vence.slice(0, 7) === chave && c.vence >= d.hoje) };
    });
    return { setor, vencidos: conc.filter((c) => c.vence < d.hoje), celulas };
  });
  return {
    meses, linhas,
    vencidos: d.concessivos.filter((c) => c.vence < d.hoje).length,
    vencemNaJanela: d.concessivos.filter((c) => c.vence >= d.hoje).length,
    maiorParte,
  };
}
