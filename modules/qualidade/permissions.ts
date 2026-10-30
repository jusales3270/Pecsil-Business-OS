export const QUALIDADE_PERMISSIONS = {
  view: "qualidade.view",
  create: "qualidade.create",
  edit: "qualidade.edit",
  approve: "qualidade.approve",
  export: "qualidade.export",
} as const;

export type QualidadePermission = (typeof QUALIDADE_PERMISSIONS)[keyof typeof QUALIDADE_PERMISSIONS];
