export const TI_PERMISSIONS = {
  view: "ti.view",
  create: "ti.create",
  edit: "ti.edit",
  approve: "ti.approve",
  export: "ti.export",
} as const;

export type TiPermission = (typeof TI_PERMISSIONS)[keyof typeof TI_PERMISSIONS];
