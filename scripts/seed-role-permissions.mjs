/**
 * Semeia as permissões-padrão dos papéis não-owner (director, manager,
 * operator, employee, admin). O bootstrap só deu permissões ao owner; sem
 * estas, um usuário criado com outro papel não acessaria nada.
 *
 * Idempotente (upsert por role_id,module_code,action). Roda com a service
 * role key: `node scripts/seed-role-permissions.mjs`
 */
import { createClient } from "@supabase/supabase-js";

const url = req("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = req("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// module_code -> ações concedidas, por papel.
const MATRIX = {
  director: {
    "core.organization": ["view", "export"],
    "core.people": ["view", "export"],
    "core.documents": ["view", "export"],
    "core.audit": ["view", "export"],
    "platform.modules": ["view"],
    rh: ["view", "approve", "export"],
    financeiro: ["view", "approve", "export"],
  },
  manager: {
    "core.people": ["view"],
    "core.documents": ["view", "create", "edit"],
    rh: ["view", "create", "edit", "approve", "export"],
    financeiro: ["view", "create", "edit", "approve", "export"],
  },
  operator: {
    "core.documents": ["view", "create"],
    rh: ["view", "create", "edit"],
    financeiro: ["view"],
  },
  employee: {
    "core.documents": ["view"],
    rh: ["view"],
  },
  admin: {
    "core.organization": ["view", "edit", "admin"],
    "core.access": ["view", "edit", "admin"],
    "core.people": ["view", "edit"],
    "core.audit": ["view", "export"],
    "platform.modules": ["view", "edit", "admin"],
  },
};

const { data: roles, error: rolesError } = await supabase
  .from("roles")
  .select("id, code");
if (rolesError) fail(rolesError.message);

const rows = [];
for (const [code, modules] of Object.entries(MATRIX)) {
  const role = roles.find((r) => r.code === code);
  if (!role) {
    console.warn(`papel ${code} não encontrado — pulando`);
    continue;
  }
  for (const [module_code, actions] of Object.entries(modules)) {
    for (const action of actions) {
      rows.push({ role_id: role.id, module_code, action, granted: true });
    }
  }
}

const { error } = await supabase
  .from("role_permissions")
  .upsert(rows, { onConflict: "role_id,module_code,action" });
if (error) fail(error.message);

console.log(`OK: ${rows.length} permissões semeadas para ${Object.keys(MATRIX).length} papéis.`);

function req(name) {
  const v = process.env[name];
  if (!v) fail(`variável ausente: ${name}`);
  return v;
}
function fail(msg) {
  console.error("FALHOU:", msg);
  process.exit(1);
}
