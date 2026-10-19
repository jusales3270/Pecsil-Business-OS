export const WARROOM_PERMISSIONS = {
  view: "warroom.view",
} as const;

export type WarRoomPermission = (typeof WARROOM_PERMISSIONS)[keyof typeof WARROOM_PERMISSIONS];
