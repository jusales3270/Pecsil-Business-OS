/**
 * Almoxarifado › Materiais: validação do cadastro (tela e API). O código vem do grupo quando fica
 * vazio (continua a numeração do GRV); NCM e plano de contas resolvem as pendências da carga.
 */

import { FAMILIAS, type Familia, type Pendencia } from "./materiais-carga.ts";

export { FAMILIAS, PENDENCIAS, type Familia, type Pendencia } from "./materiais-carga.ts";

/** Quem lê o catálogo (o mesmo de materiais_pode_ver no banco). */
export const LEITORES_MATERIAIS = [
  "almoxarifado.materiais", "almoxarifado.solicitacoes", "almoxarifado.recebimento",
  "compras.cotacoes", "compras.realizadas", "compras.aprovacoes", "fundicao.pedidos", "rh.sst",
] as const;

export type Material = {
  id: string; codigo: string; descricao: string; group_id: string | null; familia: string; grupo_nome: string | null; subgrupo: string | null;
  unidade: string; unidade_compra: string | null; ncm: string | null; plano_contas: string | null; tipo_item: string | null;
  custo_referencia: number; saldo_grv: number | null; controla_estoque: boolean; ativo: boolean; origem: "grv" | "plataforma";
  pendencias: Pendencia[]; observacoes: string | null; created_by_name: string | null; updated_at: string;
};
export type GrupoMaterial = { id: string; prefixo: string; codigo: string; nome: string; familia: string; proximo: number; controla_estoque: boolean };

export const COLUNAS_MATERIAL = "id, codigo, descricao, group_id, familia, grupo_nome, subgrupo, unidade, unidade_compra, ncm, plano_contas, tipo_item, custo_referencia, saldo_grv, controla_estoque, ativo, origem, pendencias, observacoes, created_by_name, updated_at";

export type MaterialEntrada = {
  codigo: string | null; descricao: string; group_id: string | null; familia: Familia; subgrupo: string | null; unidade: string;
  unidade_compra: string | null; ncm: string | null; plano_contas: string | null; controla_estoque: boolean; ativo: boolean; observacoes: string | null;
};

const txt = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const opc = (v: unknown, max: number) => txt(v, max) || null;
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export function normalizarMaterial(v: unknown): { material: MaterialEntrada; erros: string[] } {
  const b = (v ?? {}) as Record<string, unknown>;
  const erros: string[] = [];
  const codigo = opc(b.codigo, 30)?.toUpperCase().replace(/\s/g, "") ?? null;
  if (codigo && !/^[0-9A-Z][0-9A-Z.\-/]{0,29}$/.test(codigo)) erros.push("Código: use letras, números, ponto, hífen ou barra.");
  const descricao = txt(b.descricao, 200).toUpperCase();
  if (!descricao) erros.push("Informe o nome do material.");
  const ncm = String(b.ncm ?? "").replace(/\D/g, "");
  if (ncm && ncm.length !== 8) erros.push("O NCM tem 8 dígitos.");
  const unidade = txt(b.unidade, 8).toUpperCase() || "UN";
  const familia = (String(b.familia ?? "") in FAMILIAS ? String(b.familia) : "uso_consumo") as Familia;
  return {
    erros,
    material: {
      codigo, descricao, group_id: uuid(b.group_id), familia, subgrupo: opc(b.subgrupo, 60)?.toUpperCase() ?? null, unidade,
      unidade_compra: opc(b.unidade_compra, 8)?.toUpperCase() ?? null, ncm: ncm || null, plano_contas: opc(b.plano_contas, 60)?.toUpperCase() ?? null,
      controla_estoque: Boolean(b.controla_estoque), ativo: b.ativo === undefined ? true : Boolean(b.ativo), observacoes: opc(b.observacoes, 2000),
    },
  };
}

/** Depois de editar: NCM e plano preenchidos tiram as pendências deles; o resto continua até alguém resolver. */
export function pendenciasDepois(antes: readonly string[], m: Pick<MaterialEntrada, "ncm" | "plano_contas">): string[] {
  return antes.filter((p) => !(p === "sem_ncm" && m.ncm) && !(p === "sem_plano" && m.plano_contas) && !(p === "plano_suspeito" && m.plano_contas && m.plano_contas !== "DESPESAS DE VIAGEM"));
}
