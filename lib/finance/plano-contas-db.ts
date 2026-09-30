/** Colunas e formato do plano de contas, compartilhados pelas rotas do Financeiro. */
import type { ChartAccount, ManagementType } from "./plano-contas-core";

export const CHART_COLUMNS = "id, code, name, parent_id, management_type, allows_posting, active";

export type ChartRow = {
  id: string;
  code: string | null;
  name: string;
  parent_id: string | null;
  management_type: ManagementType;
  allows_posting: boolean;
  active: boolean;
};

export function toChartAccount(row: ChartRow): ChartAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parent_id,
    managementType: row.management_type,
    allowsPosting: row.allows_posting,
    active: row.active,
  };
}

/** Mensagem do banco (raise exception das funções do plano) → resposta clara. */
export function chartError(error: { code?: string; message: string }): { status: number; error: string } {
  if (error.code === "42501") return { status: 403, error: "Sem permissão para alterar o plano de contas." };
  if (error.code === "23505") return { status: 409, error: "Já existe uma conta com esse código." };
  if (error.code === "23514") return { status: 400, error: "Código inválido. Use o formato 02, 02.20 ou 02.01.016." };
  return { status: 400, error: error.message };
}
