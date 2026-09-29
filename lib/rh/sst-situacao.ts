/**
 * Situação de um registro de SST calculada pelo vencimento.
 *
 * Exames (ASO) e treinamentos têm validade: a situação sai da data, não de
 * quem lembra de atualizar. A mesma regra está no banco (gatilho da migração
 * 202609290004) — mudou aqui, muda lá.
 *
 *   vencido               → Vencido  · Crítico
 *   vence em até 60 dias  → A vencer · Atenção   (o "1 a 2 meses" do RH)
 *   mais de 60 dias       → Conforme · Regular
 *
 * EPI, ocorrência, registro sem data e "Em análise" (decisão manual) mantêm o
 * que foi gravado.
 */

export const JANELA_ALERTA_DIAS = 60;

type Categoria = "exam" | "training" | "ppe" | "incident";
type Status = "compliant" | "due_soon" | "overdue" | "scheduled" | "under_review";
type Risco = "critical" | "attention" | "regular";

const COM_VALIDADE: readonly Categoria[] = ["exam", "training"];

/** Hoje no fuso de Brasília, "AAAA-MM-DD". */
export function hojeBrasilia(agora: Date = new Date()): string {
  return agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Dias corridos de `hoje` até `data` (negativo = já passou). */
export function diasAte(data: string, hoje: string): number {
  const [a, b] = [data, hoje].map((d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return Math.round((a - b) / 86_400_000);
}

export function situacaoSst<T extends { category: Categoria; dueDate: string | null; status: Status; risk: Risco }>(
  registro: T,
  hoje: string = hojeBrasilia(),
): { status: Status; risk: Risco } {
  const { category, dueDate, status, risk } = registro;
  if (!COM_VALIDADE.includes(category) || !dueDate || status === "under_review") return { status, risk };
  const dias = diasAte(dueDate.slice(0, 10), hoje);
  if (dias < 0) return { status: "overdue", risk: "critical" };
  if (dias <= JANELA_ALERTA_DIAS) return { status: "due_soon", risk: "attention" };
  return { status: "compliant", risk: "regular" };
}
