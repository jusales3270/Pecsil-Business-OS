/**
 * "Parâmetros usados" (E5, 22/10/2026): abaixo da resposta, os filtros com que a SARA consultou
 * (período, situação, busca, limite), como a LIA mostra. Vem das próprias chamadas das consultas —
 * não do texto do modelo —, então é exatamente o que foi pedido ao banco.
 */

export type Usada = { nome: string; entrada: unknown; ok: boolean };
export type Parametros = { consulta: string; filtros: string[] };

/** Ferramentas que não filtram dados (navegação, visual, ação, conta): ficam fora. */
const FORA = new Set(["abrir_tela", "abrir_lancamento", "mostrar", "registrar_lacuna", "propor_habilidade", "calcular", "periodo", "pesquisar_na_internet"]);
const NOMES: Record<string, string> = {
  de: "de", ate: "até", inicio: "de", fim: "até", busca: "busca", termo: "busca", situacao: "situação", limite: "limite",
  fornecedor: "fornecedor", cliente: "cliente", modulo: "módulo", tabela: "tabela", campos: "campos", agrupar: "agrupar por",
  ordem: "ordem", mes: "mês", ano: "ano", dias: "dias", peca: "peça", codigo: "código",
};
/** Colunas comuns em português (consulta direta às tabelas). */
const COLUNAS: Record<string, string> = {
  status: "situação", origem: "origem", created_at: "data de criação", updated_at: "última alteração", requested_by_name: "quem pediu",
  precisa_ate: "precisa até", numero: "número", divisao: "divisão", urgencia: "urgência", valor: "valor", amount: "valor", due_date: "vencimento",
  vencimento: "vencimento", fornecedor: "fornecedor", supplier_name: "fornecedor", customer_name: "cliente", descricao: "descrição", codigo: "código",
  data: "data", paid_at: "pago em", issue_date: "emissão", name: "nome", full_name: "nome", department: "setor",
};
const OPS: Record<string, string> = {
  igual: "=", diferente: "≠", contem: "contém", comeca: "começa com", maior: ">", maior_igual: "≥", menor: "<", menor_igual: "≤", entre: "entre", em: "em", vazio: "vazio", preenchido: "preenchido",
};
const coluna = (c: unknown) => COLUNAS[String(c)] ?? String(c ?? "").replace(/_/g, " ");
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const br = (s: string) => s.split("-").reverse().join("/");

function valor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") return v.toLocaleString("pt-BR");
  if (typeof v === "string") return DATA.test(v) ? br(v) : v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (Array.isArray(v)) return v.map(valor).filter(Boolean).join(", ");
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${NOMES[k] ?? k.replace(/_/g, " ")} ${valor(x)}`).join("; ").slice(0, 80);
}

/** Consulta direta às tabelas (consultar_dados): tabela pelo nome da tela, período, filtros e agrupamento legíveis. */
function daConsultaDireta(e: Record<string, unknown>, tabelas: Record<string, string>): { consulta: string; filtros: string[] } {
  const filtros: string[] = [];
  const per = (e.periodo ?? {}) as Record<string, unknown>;
  if (per.de || per.ate) filtros.push(`período${per.campo && per.campo !== "created_at" ? ` (${coluna(per.campo)})` : ""}: ${per.de ? valor(per.de) : "…"} a ${per.ate ? valor(per.ate) : "…"}`);
  for (const f of (Array.isArray(e.filtros) ? e.filtros : []) as Record<string, unknown>[]) {
    const op = String(f.op ?? "");
    const v = op === "entre" ? `${valor(f.valor)} e ${valor(f.ate)}` : op === "vazio" || op === "preenchido" ? "" : op === "contem" || op === "comeca" ? `"${valor(f.valor)}"` : valor(f.valor);
    filtros.push(`${coluna(f.campo)} ${OPS[op] ?? op}${v ? ` ${v}` : ""}`);
  }
  if (e.agrupar) filtros.push(`agrupado por ${(Array.isArray(e.agrupar) ? e.agrupar : [e.agrupar]).map(coluna).join(", ")}`);
  if (e.somar) filtros.push(`soma de ${(Array.isArray(e.somar) ? e.somar : [e.somar]).map(coluna).join(", ")}`);
  if (e.limite) filtros.push(`até ${valor(e.limite)} linhas`);
  const tabela = String(e.tabela ?? "");
  return { consulta: tabelas[tabela] ?? (tabela.replace(/_/g, " ") || "dados"), filtros };
}

export function parametrosUsados(usadas: Usada[], rotulos: Record<string, string>, acoes: Set<string> = new Set(), tabelas: Record<string, string> = {}): Parametros[] {
  const saida: Parametros[] = [];
  for (const u of usadas) {
    if (!u.ok || FORA.has(u.nome) || acoes.has(u.nome)) continue;
    const e = (u.entrada && typeof u.entrada === "object" ? u.entrada : {}) as Record<string, unknown>;
    if (u.nome === "consultar_dados") {
      const d = daConsultaDireta(e, tabelas);
      const f = d.filtros.length ? d.filtros : ["padrão da consulta"];
      if (!saida.some((p) => p.consulta === d.consulta && p.filtros.join("|") === f.join("|"))) saida.push({ consulta: d.consulta, filtros: f });
      continue;
    }
    const filtros: string[] = [];
    // Período junto: "período: 01/09/2026 a 30/09/2026".
    const de = e.de ?? e.inicio, ate = e.ate ?? e.fim;
    if (typeof de === "string" || typeof ate === "string") filtros.push(`período: ${de ? valor(de) : "…"} a ${ate ? valor(ate) : "…"}`);
    for (const [k, x] of Object.entries(e)) {
      if (["de", "ate", "inicio", "fim"].includes(k)) continue;
      const t = valor(x);
      if (t) filtros.push(`${NOMES[k] ?? k.replace(/_/g, " ")}: ${t}`);
    }
    const consulta = rotulos[u.nome] ?? u.nome.replace(/_/g, " ");
    const repetida = saida.find((p) => p.consulta === consulta && p.filtros.join("|") === (filtros.length ? filtros : ["padrão da consulta"]).join("|"));
    if (!repetida) saida.push({ consulta, filtros: filtros.length ? filtros : ["padrão da consulta"] });
  }
  return saida.slice(0, 6);
}
