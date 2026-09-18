export type PersonStatus = "Ativo" | "Pendente" | "Bloqueado";

export type Person = {
  initials: string;
  name: string;
  email: string;
  role: string;
  department: string;
  unit: string;
  profile: string;
  status: PersonStatus;
  /** Presentes só nos dados reais (cadastro mestre do banco). */
  id?: string;
  registration?: string;
  admissionDate?: string | null;
  team?: string | null;
};

export type OrganizationEntity = {
  name: string;
  meta: string;
  detail: string;
  count: string;
  icon: string;
};

export type OrganizationData = Record<
  "Unidades" | "Departamentos" | "Equipes" | "Cargos",
  OrganizationEntity[]
>;

export type FoundationSummary = {
  employees: number;
  activeEmployees: number;
  users: number;
  roles: number;
  units: number;
  departments: number;
  teams: number;
  positions: number;
};

export type FoundationSnapshot = {
  source: "demo" | "supabase";
  organization: { id: string | null; name: string };
  summary: FoundationSummary;
  people: Person[];
  organizationData: OrganizationData;
  loadedAt: string;
};

// Sem sessão ou sem conexão a aplicação não inventa cadastro: mostra vazio e
// sinaliza a origem "demo". Dado fictício em tela já levou a decisão errada.
export const demoFoundationSnapshot: FoundationSnapshot = {
  source: "demo",
  organization: { id: null, name: "Pecsil Molds for Glass" },
  summary: {
    employees: 0,
    activeEmployees: 0,
    users: 0,
    roles: 0,
    units: 0,
    departments: 0,
    teams: 0,
    positions: 0,
  },
  people: [],
  organizationData: { Unidades: [], Departamentos: [], Equipes: [], Cargos: [] },
  loadedAt: new Date(0).toISOString(),
};
