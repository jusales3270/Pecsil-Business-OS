export type PermissionContext = {
  permissions: readonly string[];
};

export function hasPermission(context: PermissionContext, permission: string) {
  const [namespace] = permission.split(".");
  return context.permissions.includes("*")
    || context.permissions.includes(permission)
    || context.permissions.includes(`${namespace}.*`);
}

export function hasAnyPermission(context: PermissionContext, permissions: readonly string[]) {
  return permissions.some(permission => hasPermission(context, permission));
}
