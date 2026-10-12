/** Utilitários das telas do Fiscal (Painel do ICMS, Notas recebidas, Configuração). */

export const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const curto = (v: number) => (Math.abs(v) >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : Math.abs(v) >= 10_000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : money(v));
export const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : "—");
export const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
/** Data e hora no fuso de Brasília (para o que vem com hora: consulta à SEFAZ, validade). */
export const dataHora = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const cnpjFormatado = (v: string | null | undefined) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (v ?? "");
};

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const formulario = init?.body instanceof FormData;
    const res = await fetch(url, { cache: "no-store", ...init, headers: formulario ? undefined : { "content-type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch { return { ok: false, error: "Sem conexão com o servidor." }; }
}
