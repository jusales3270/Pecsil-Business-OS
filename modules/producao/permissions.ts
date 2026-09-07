export const PRODUCAO_PERMISSIONS = {
  view: "producao.view",
  create: "producao.create",
  edit: "producao.edit",
  approve: "producao.approve",
  export: "producao.export",
  admin: "producao.admin",
} as const;

export type ProducaoPermission = (typeof PRODUCAO_PERMISSIONS)[keyof typeof PRODUCAO_PERMISSIONS];
