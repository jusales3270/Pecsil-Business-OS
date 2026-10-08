/** Tipos e formatação compartilhados pelas telas do Almoxarifado. */

export type SituacaoPedido = "aberta" | "em_cotacao" | "aprovada" | "rejeitada" | "comprada" | "parcial" | "recebida" | "cancelada";

export type Pedido = {
  id: string;
  numero: number;
  divisao: "USINAGEM" | "FUNDICAO" | "GERAL";
  urgencia: "normal" | "urgente";
  observacao: string | null;
  status: SituacaoPedido;
  solicitante: string | null;
  motivoCancelamento: string | null;
  criadoEm: string;
  atualizadoEm: string;
  itens: { produto: string; quantidade: number; unidade: string; observacao: string | null }[];
};

export type ACaminho = {
  cotacaoId: number;
  fornecedor: string;
  supplierId: string | null;
  cnpj: string | null;
  divisao: string | null;
  pedidoId: string | null;
  pedidoNumero: number | null;
  solicitante: string | null;
  compradoEm: string | null;
  totalComprado: number;
  jaRecebido: number;
  recebimentos: number;
  previsaoVencimento: string | null;
  itens: { produto: string; quantidade: number; unidade: string; valorUnit: number; total: number }[];
};

export type Recebido = {
  id: string;
  numero: number;
  cotacao_id: number | null;
  fornecedor: string;
  nf_numero: string;
  nf_serie: string | null;
  nf_chave: string | null;
  emissao: string | null;
  recebido_em: string;
  valor_total: number;
  icms: number;
  ipi: number;
  com_xml: boolean;
  encerra_pedido: boolean;
  divergencia: boolean;
  divergencia_motivo: string | null;
  observacao: string | null;
  received_by_name: string | null;
  material_requests: { numero: number } | null;
  receipt_installments: { numero: string | null; vencimento: string; valor: number }[];
  receipt_items: { descricao: string; quantidade: number; unidade: string | null; valor_total: number; ordem: number }[];
};

export const SITUACAO: Record<SituacaoPedido, { label: string; tone: "neutral" | "info" | "success" | "attention" | "danger" | "purple" }> = {
  aberta: { label: "Aguardando cotação", tone: "attention" },
  em_cotacao: { label: "Em cotação", tone: "info" },
  aprovada: { label: "Aprovado · aguardando compra", tone: "success" },
  rejeitada: { label: "Rejeitado", tone: "danger" },
  comprada: { label: "Comprado · a caminho", tone: "purple" },
  parcial: { label: "Recebido em parte", tone: "purple" },
  recebida: { label: "Recebido", tone: "neutral" },
  cancelada: { label: "Cancelado", tone: "neutral" },
};

export const DIVISAO: Record<string, string> = { USINAGEM: "Usinagem", FUNDICAO: "Fundição", GERAL: "Geral" };
export const UNIDADES = ["UN", "KG", "L", "M", "CX", "PC", "PAR", "JG", "RL", "TON"];

export const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const date = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split("-").reverse().join("/") : "—");
export const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const qtd = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Texto de erro da API, ou o padrão. */
export async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** Nota lida no servidor (XML ou DANFE em PDF), com o fornecedor do cadastro e os pedidos que combinam. */
export type NotaLidaResposta = {
  nfe: import("../../../lib/almoxarifado/nfe-xml").Nfe;
  origem: "xml" | "pdf";
  xml: string | null;
  camposNaoLidos: string[];
  jaRecebida: { numero: number; em: string } | null;
  jaNoIcms: boolean;
  fornecedor: { id: string; nome: string; porCnpj: boolean; gravarCnpj: boolean } | null;
  pedidos: { cotacaoId: number; fornecedor: string; falta: number; motivo: "cnpj" | "fornecedor" | "nome"; valorConfere: boolean }[];
};

export async function lerNotaArquivo(file: File): Promise<{ ok: true; data: NotaLidaResposta } | { ok: false; error: string }> {
  const corpo = new FormData();
  corpo.set("arquivo", file);
  try {
    const res = await fetch("/api/almoxarifado/nfe", { method: "POST", body: corpo, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível ler a nota." };
    return { ok: true, data: body as NotaLidaResposta };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** Ícones da tela, com tamanho explícito (sem largura o SVG global vira 20px). */
export function Icone({ nome, size = 18 }: { nome: "mais" | "caixa" | "caminhao" | "nota" | "lixo" | "alerta" | "check" | "seta"; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    mais: <path d="M12 5v14M5 12h14" />,
    caixa: <><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></>,
    caminhao: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>,
    nota: <><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h6" /></>,
    lixo: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
    alerta: <><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5M12 18h.01" /></>,
    check: <path d="m5 12 4 4 10-10" />,
    seta: <path d="m9 18 6-6-6-6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[nome]}</svg>;
}
