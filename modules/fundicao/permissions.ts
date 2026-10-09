export const FUNDICAO_PERMISSIONS = {
  view: "fundicao.view",
  create: "fundicao.create",
  edit: "fundicao.edit",
  export: "fundicao.export",
} as const;

export type FundicaoPermission = (typeof FUNDICAO_PERMISSIONS)[keyof typeof FUNDICAO_PERMISSIONS];
