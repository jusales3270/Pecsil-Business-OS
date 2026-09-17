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

export const demoFoundationSnapshot: FoundationSnapshot = {
  source: "demo",
  organization: { id: null, name: "Pecsil" },
  summary: {
    employees: 248,
    activeEmployees: 246,
    users: 236,
    roles: 6,
    units: 2,
    departments: 8,
    teams: 12,
    positions: 34,
  },
  people: [
    { initials:"JS", name:"Júnior Sales", email:"junior.sales@pecsil.com.br", role:"Proprietário", department:"Diretoria", unit:"Matriz Boituva", profile:"Proprietário", status:"Ativo" },
    { initials:"MC", name:"Mariana Costa", email:"mariana.costa@pecsil.com.br", role:"Gerente de RH", department:"Recursos Humanos", unit:"Matriz Boituva", profile:"Gestor", status:"Ativo" },
    { initials:"RA", name:"Ricardo Alves", email:"ricardo.alves@pecsil.com.br", role:"Gerente Industrial", department:"Produção", unit:"Unidade Industrial", profile:"Diretor", status:"Ativo" },
    { initials:"CF", name:"Camila Ferreira", email:"camila.ferreira@pecsil.com.br", role:"Analista de Qualidade", department:"Qualidade", unit:"Unidade Industrial", profile:"Operador", status:"Ativo" },
    { initials:"LM", name:"Lucas Martins", email:"lucas.martins@pecsil.com.br", role:"Supervisor de Turno", department:"Produção", unit:"Unidade Industrial", profile:"Gestor", status:"Pendente" },
    { initials:"AS", name:"Ana Souza", email:"ana.souza@pecsil.com.br", role:"Assistente Administrativo", department:"Administrativo", unit:"Matriz Boituva", profile:"Colaborador", status:"Bloqueado" },
  ],
  organizationData: {
    Unidades: [
      { name:"Matriz Boituva", meta:"Sede administrativa", detail:"Boituva · SP", count:"82 colaboradores", icon:"building" },
      { name:"Unidade Industrial", meta:"Operação fabril", detail:"Boituva · SP", count:"166 colaboradores", icon:"factory" },
    ],
    Departamentos: [
      { name:"Produção", meta:"Unidade Industrial", detail:"Ricardo Alves · Gerente", count:"96 pessoas", icon:"factory" },
      { name:"Qualidade", meta:"Unidade Industrial", detail:"Controle e conformidade", count:"18 pessoas", icon:"check" },
      { name:"Manutenção", meta:"Unidade Industrial", detail:"Ativos e disponibilidade", count:"24 pessoas", icon:"settings" },
      { name:"Recursos Humanos", meta:"Matriz Boituva", detail:"Pessoas e cultura", count:"8 pessoas", icon:"users" },
      { name:"Administrativo", meta:"Matriz Boituva", detail:"Serviços corporativos", count:"22 pessoas", icon:"briefcase" },
      { name:"Comercial", meta:"Matriz Boituva", detail:"Clientes e mercado", count:"14 pessoas", icon:"chart" },
    ],
    Equipes: [
      { name:"Usinagem · Turno A", meta:"Produção", detail:"Lucas Martins · Supervisor", count:"24 membros", icon:"team" },
      { name:"Usinagem · Turno B", meta:"Produção", detail:"Carlos Lima · Supervisor", count:"22 membros", icon:"team" },
      { name:"Fundição", meta:"Produção", detail:"Roberto Dias · Supervisor", count:"31 membros", icon:"team" },
      { name:"Inspeção Final", meta:"Qualidade", detail:"Camila Ferreira · Referência", count:"9 membros", icon:"check" },
    ],
    Cargos: [
      { name:"Gerente Industrial", meta:"Liderança", detail:"Produção · Escopo industrial", count:"1 ocupante", icon:"briefcase" },
      { name:"Supervisor de Turno", meta:"Liderança", detail:"Produção · Escopo por equipe", count:"4 ocupantes", icon:"briefcase" },
      { name:"Operador de Usinagem", meta:"Operacional", detail:"Produção · CBO vinculado", count:"42 ocupantes", icon:"settings" },
      { name:"Analista de Qualidade", meta:"Técnico", detail:"Qualidade · CBO vinculado", count:"8 ocupantes", icon:"check" },
      { name:"Assistente Administrativo", meta:"Administrativo", detail:"Matriz · Serviços internos", count:"12 ocupantes", icon:"file" },
    ],
  },
  loadedAt: new Date(0).toISOString(),
};
