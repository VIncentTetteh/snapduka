// Ported from Snapduka/src/lib/auth/permissions.ts — RBAC matrix shared by web + mobile.
// The mobile UI uses this to hide/disable actions a team role cannot perform;
// Supabase RLS remains the authoritative enforcement layer regardless.
export type TeamRole =
  | "owner"
  | "manager"
  | "catalog"
  | "fulfillment"
  | "support"
  | "analyst";

export type Permission =
  | "billing.manage"
  | "team.manage"
  | "products.manage"
  | "orders.manage"
  | "customers.read"
  | "campaigns.manage"
  | "analytics.read"
  | "settings.manage";

const matrix: Record<TeamRole, readonly Permission[]> = {
  owner: [
    "billing.manage",
    "team.manage",
    "products.manage",
    "orders.manage",
    "customers.read",
    "campaigns.manage",
    "analytics.read",
    "settings.manage",
  ],
  manager: [
    "products.manage",
    "orders.manage",
    "customers.read",
    "campaigns.manage",
    "analytics.read",
    "settings.manage",
  ],
  catalog: ["products.manage", "analytics.read"],
  fulfillment: ["orders.manage"],
  support: ["orders.manage", "customers.read"],
  analyst: ["customers.read", "analytics.read"],
};

export function hasPermission(role: TeamRole, permission: Permission) {
  return matrix[role].includes(permission);
}
