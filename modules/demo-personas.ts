import type { ModuleAccessContext } from "./access";

export type DemoPersonaId = "owner" | "director" | "manager" | "hr" | "employee";

export const demoPersonas: Record<DemoPersonaId, ModuleAccessContext> = {
  owner: {
    userId: "demo-owner", name: "Júnior Sales", initials: "JS", role: "Proprietário", scopeLabel: "Toda a empresa",
    permissions: ["*"], scopes: [{ type: "company" }],
  },
  director: {
    userId: "demo-director", name: "Mariana Costa", initials: "MC", role: "Diretora", scopeLabel: "Diretoria Industrial",
    permissions: ["platform.modules.view", "core.organization.view", "core.people.view", "core.documents.view", "core.notifications.view", "core.search.view", "core.audit.view", "rh.view", "rh.approve", "rh.export", "financeiro.view", "financeiro.approve", "financeiro.export"],
    scopes: [{ type: "unit", referenceId: "industrial" }],
  },
  manager: {
    userId: "demo-manager", name: "Carlos Mendes", initials: "CM", role: "Gestor", scopeLabel: "Produção · Equipes A e B",
    permissions: ["core.people.view", "core.documents.view", "core.notifications.view", "core.search.view", "rh.view", "rh.approve"],
    scopes: [{ type: "department", referenceId: "producao" }],
  },
  hr: {
    userId: "demo-hr", name: "Camila Ferreira", initials: "CF", role: "RH", scopeLabel: "Pessoas · Toda a empresa",
    permissions: ["core.organization.view", "core.people.*", "core.documents.*", "core.notifications.view", "core.search.view", "rh.*"],
    scopes: [{ type: "company" }],
  },
  employee: {
    userId: "demo-employee", name: "Lucas Martins", initials: "LM", role: "Colaborador", scopeLabel: "Somente meus dados",
    permissions: ["core.documents.view", "core.notifications.view", "rh.view"],
    scopes: [{ type: "self", referenceId: "demo-employee" }],
  },
};

export const demoPersonaOrder: DemoPersonaId[] = ["owner", "director", "manager", "hr", "employee"];
