export const LOGISTICA_PERMISSIONS = {
  view: "logistica.view",
} as const;

export type LogisticaPermission = (typeof LOGISTICA_PERMISSIONS)[keyof typeof LOGISTICA_PERMISSIONS];
