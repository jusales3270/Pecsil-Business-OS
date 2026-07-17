export const RH_PERMISSIONS = {
  view: "rh.view",
  create: "rh.create",
  edit: "rh.edit",
  approve: "rh.approve",
  export: "rh.export",
  admin: "rh.admin",
} as const;

export type RhPermission = (typeof RH_PERMISSIONS)[keyof typeof RH_PERMISSIONS];
