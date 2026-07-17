import { createClient } from "@supabase/supabase-js";

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const ownerEmail = required("INITIAL_OWNER_EMAIL").toLowerCase();
const ownerName = process.env.INITIAL_OWNER_NAME || ownerEmail;

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: usersData, error: usersError } =
  await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (usersError) fail(usersError.message);

const authUser = usersData.users.find(
  (user) => user.email?.toLowerCase() === ownerEmail,
);
if (!authUser) {
  fail(
    `Crie primeiro o usuário ${ownerEmail} no Supabase Auth. O bootstrap não cria senhas nem envia convites automaticamente.`,
  );
}

let organization = await oneOrNull(
  supabase.from("organizations").select("id, display_name").eq("display_name", "Pecsil").limit(1),
);
if (!organization) {
  organization = await one(
    supabase
      .from("organizations")
      .insert({ legal_name: "Pecsil", display_name: "Pecsil" })
      .select("id, display_name")
      .single(),
  );
}

const profile = await one(
  supabase
    .from("profiles")
    .upsert(
      {
        user_id: authUser.id,
        organization_id: organization.id,
        email: ownerEmail,
        full_name: ownerName,
        status: "active",
      },
      { onConflict: "user_id" },
    )
    .select("id")
    .single(),
);

const moduleSeeds = [
  { code: "rh", name: "Recursos Humanos", version: "1.0.0", route: "/modules/rh", entry_permission: "rh.view", status: "integrated", menu_order: 10 },
  { code: "compras", name: "Compras", version: "0.0.0", route: "/modules/compras", entry_permission: "compras.view", status: "planned", menu_order: 20 },
  { code: "producao", name: "Produção", version: "0.0.0", route: "/modules/producao", entry_permission: "producao.view", status: "planned", menu_order: 30 },
  { code: "estoque", name: "Estoque", version: "0.0.0", route: "/modules/estoque", entry_permission: "estoque.view", status: "planned", menu_order: 40 },
  { code: "qualidade", name: "Qualidade", version: "0.0.0", route: "/modules/qualidade", entry_permission: "qualidade.view", status: "planned", menu_order: 50 },
  { code: "financeiro", name: "Financeiro", version: "0.0.0", route: "/modules/financeiro", entry_permission: "financeiro.view", status: "future", menu_order: 60 },
];

const { error: moduleError } = await supabase
  .from("modules")
  .upsert(moduleSeeds, { onConflict: "code" });
if (moduleError) fail(moduleError.message);

const { error: organizationModuleError } = await supabase
  .from("organization_modules")
  .upsert(
    moduleSeeds.map((module) => ({
      organization_id: organization.id,
      module_code: module.code,
      enabled: module.code === "rh",
      menu_enabled: module.code === "rh",
      enabled_at: module.code === "rh" ? new Date().toISOString() : null,
      enabled_by: module.code === "rh" ? profile.id : null,
    })),
    { onConflict: "organization_id,module_code" },
  );
if (organizationModuleError) fail(organizationModuleError.message);

const unit = await upsertOne(
  "units",
  { organization_id: organization.id, code: "MATRIZ", name: "Matriz Pecsil", active: true },
  "organization_id,code",
  "id",
);
const departmentSeeds = [
  ["ADMIN", "Administrativo"],
  ["RH", "Recursos Humanos"],
  ["PROD", "Produção"],
  ["QUAL", "Qualidade"],
];
const { data: departments, error: departmentsError } = await supabase
  .from("departments")
  .upsert(
    departmentSeeds.map(([code, name]) => ({ organization_id: organization.id, unit_id: unit.id, code, name, active: true })),
    { onConflict: "organization_id,code" },
  )
  .select("id, code");
if (departmentsError) fail(departmentsError.message);

const productionDepartment = departments.find((department) => department.code === "PROD");
if (!productionDepartment) fail("Departamento Produção não foi provisionado.");
await upsertOne(
  "teams",
  { organization_id: organization.id, department_id: productionDepartment.id, code: "OPERACAO", name: "Operação", active: true },
  "organization_id,code",
  "id",
);

const positionSeeds = [
  ["DIRETOR", "Diretor", "Direção"],
  ["GESTOR", "Gestor", "Gestão"],
  ["ANALISTA", "Analista", "Especialista"],
  ["OPERADOR", "Operador", "Operacional"],
];
const { error: positionsError } = await supabase.from("positions").upsert(
  positionSeeds.map(([code, name, level]) => ({ organization_id: organization.id, code, name, level, active: true })),
  { onConflict: "organization_id,code" },
);
if (positionsError) fail(positionsError.message);

const roleSeeds = [
  ["owner", "Proprietário", "Visão transversal e decisões estratégicas"],
  ["director", "Diretor", "Indicadores e decisões das áreas autorizadas"],
  ["manager", "Gestor", "Gestão de departamento e equipes"],
  ["operator", "Operador", "Execução operacional autorizada"],
  ["employee", "Colaborador", "Autosserviço e próprio registro"],
  ["admin", "Administrador", "Configuração técnica da plataforma"],
];

const { data: roles, error: rolesError } = await supabase
  .from("roles")
  .upsert(
    roleSeeds.map(([code, name, description]) => ({
      organization_id: organization.id,
      code,
      name,
      description,
      system_role: true,
    })),
    { onConflict: "organization_id,code" },
  )
  .select("id, code");
if (rolesError) fail(rolesError.message);

const ownerRole = roles.find((role) => role.code === "owner");
if (!ownerRole) fail("O papel Proprietário não foi provisionado.");

const modules = [
  "core.organization",
  "core.people",
  "core.access",
  "core.documents",
  "core.audit",
  "platform.modules",
  "rh",
];
const actions = ["view", "create", "edit", "approve", "export", "admin"];
const { error: permissionError } = await supabase.from("role_permissions").upsert(
  modules.flatMap((module_code) =>
    actions.map((action) => ({
      role_id: ownerRole.id,
      module_code,
      action,
      granted: true,
    })),
  ),
  { onConflict: "role_id,module_code,action" },
);
if (permissionError) fail(permissionError.message);

let companyScope = await oneOrNull(
  supabase
    .from("access_scopes")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("scope_type", "company")
    .eq("entity_id", organization.id)
    .limit(1),
);
if (!companyScope) {
  companyScope = await one(
    supabase
      .from("access_scopes")
      .insert({
        organization_id: organization.id,
        scope_type: "company",
        entity_id: organization.id,
        label: "Pecsil completa",
      })
      .select("id")
      .single(),
  );
}

const { error: assignmentError } = await supabase.from("user_roles").upsert(
  {
    profile_id: profile.id,
    role_id: ownerRole.id,
    scope_id: companyScope.id,
    granted_by: profile.id,
  },
  { onConflict: "profile_id,role_id,scope_id" },
);
if (assignmentError) fail(assignmentError.message);

console.log(`Bootstrap concluído para ${ownerEmail} na organização Pecsil.`);

function required(name) {
  const value = process.env[name];
  if (!value) fail(`Variável obrigatória ausente: ${name}`);
  return value;
}

async function one(builder) {
  const { data, error } = await builder;
  if (error) fail(error.message);
  return data;
}

async function oneOrNull(builder) {
  const { data, error } = await builder;
  if (error) fail(error.message);
  return data?.[0] ?? null;
}

async function upsertOne(table, values, onConflict, columns) {
  return one(
    supabase
      .from(table)
      .upsert(values, { onConflict })
      .select(columns)
      .single(),
  );
}

function fail(message) {
  console.error(`Bootstrap interrompido: ${message}`);
  process.exit(1);
}
