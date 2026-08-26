"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Status } from "../../packages/design-system";

type AdminUser = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  roleName: string;
  roleCode: string | null;
  scopeLabel: string;
  scopeType: string | null;
};

type ScopeOptions = {
  modules: { code: string; name: string; status: string }[];
  units: { id: string; name: string }[];
  departments: { id: string; name: string; unitId: string | null }[];
  teams: { id: string; name: string; departmentId: string | null }[];
};

const ROLES = [
  { code: "director", name: "Diretor", hint: "Indicadores e aprovações das áreas" },
  { code: "manager", name: "Gestor", hint: "Gestão de RH e Financeiro" },
  { code: "operator", name: "Operador", hint: "Execução operacional" },
  { code: "employee", name: "Colaborador", hint: "Autosserviço e próprio registro" },
  { code: "admin", name: "Administrador", hint: "Configuração técnica da plataforma" },
];

// O eixo principal de acesso da PecSil é o MÓDULO: a pessoa é "Gestor do
// Financeiro", "Diretor do RH". Os escopos de estrutura ficam disponíveis para
// quando fizer sentido recortar por unidade/departamento.
const SCOPES = [
  { type: "module", label: "Um módulo (RH, Financeiro…)", hint: "Trabalha apenas nesse módulo" },
  { type: "company", label: "Toda a empresa", hint: "Acesso a todos os módulos e dados" },
  { type: "self", label: "Próprio registro", hint: "Somente os próprios dados" },
  { type: "unit", label: "Uma unidade", hint: "Somente os dados da unidade escolhida" },
  { type: "department", label: "Um departamento", hint: "Somente os dados do departamento escolhido" },
  { type: "team", label: "Uma equipe", hint: "Somente os dados da equipe escolhida" },
];

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  invited: "Convidado",
  blocked: "Bloqueado",
  disabled: "Desativado",
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function statusTone(status: string): "success" | "attention" | "neutral" {
  if (status === "active") return "success";
  if (status === "invited") return "attention";
  return "neutral";
}

/** Escopos que exigem escolher uma entidade da estrutura. */
const ENTITY_SCOPES = new Set(["module", "unit", "department", "team"]);


/** Monta o escopo para a API: módulo usa moduleCode; a estrutura usa entityId. */
function scopePayload(scopeType: string, value: string) {
  return scopeType === "module"
    ? { type: scopeType, moduleCode: value || null }
    : { type: scopeType, entityId: value || null };
}

export function UserManagement({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [options, setOptions] = useState<ScopeOptions>({ modules: [], units: [], departments: [], teams: [] });
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  async function fetchUsers(signal?: AbortSignal) {
    const response = await fetch("/api/admin/users", { cache: "no-store", signal });
    if (response.status === 401 || response.status === 403) return { denied: true, users: [] };
    if (response.ok) {
      const data = (await response.json()) as { users: AdminUser[] };
      return { denied: false, users: data.users };
    }
    return { denied: false, users: [] };
  }

  async function refresh() {
    const result = await fetchUsers();
    setDenied(result.denied);
    setUsers(result.users);
    setLoading(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchUsers(controller.signal)
      .then((result) => {
        setDenied(result.denied);
        setUsers(result.users);
        setLoading(false);
      })
      .catch(() => {});
    fetch("/api/admin/scope-options", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setOptions(data as ScopeOptions))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (denied) {
    return (
      <Card className="user-admin-denied">
        <b>Sem permissão para gerenciar usuários</b>
        <small>Apenas o Proprietário e o Administrador podem criar e gerenciar contas.</small>
      </Card>
    );
  }

  return (
    <>
      <div className="user-admin-toolbar">
        <div>
          <b>Contas de login</b>
          <small>Crie usuários, defina o papel e direcione o que cada pessoa acessa.</small>
        </div>
        <Button onClick={() => setCreating(true)}>+ Novo usuário</Button>
      </div>

      <Card className="user-admin-card">
        <div className="user-admin-head">
          <span>Usuário</span>
          <span>Papel</span>
          <span>Escopo</span>
          <span>Situação</span>
        </div>
        {loading ? (
          <div className="user-admin-empty">Carregando usuários…</div>
        ) : users.length === 0 ? (
          <div className="user-admin-empty">Nenhum usuário cadastrado ainda.</div>
        ) : (
          users.map((user) => (
            <button
              className="user-admin-row"
              key={user.id}
              onClick={() => user.roleCode !== "owner" && setEditing(user)}
              disabled={user.roleCode === "owner"}
              title={user.roleCode === "owner" ? "O Proprietário não é editável" : "Gerenciar acesso"}
            >
              <span className="user-admin-person">
                <i>{initials(user.fullName)}</i>
                <span>
                  <b>{user.fullName}</b>
                  <small>{user.email}</small>
                </span>
              </span>
              <span>{user.roleName}</span>
              <span>{user.scopeLabel}</span>
              <Status tone={statusTone(user.status)}>{STATUS_LABEL[user.status] ?? user.status}</Status>
            </button>
          ))
        )}
      </Card>

      {creating && (
        <CreateUserForm
          options={options}
          onClose={() => setCreating(false)}
          onCreated={(email) => {
            setCreating(false);
            notify(`Usuário ${email} criado.`);
            void refresh();
          }}
        />
      )}

      {editing && (
        <EditUserDrawer
          user={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            notify(message);
            void refresh();
          }}
        />
      )}
    </>
  );
}

/** Seletor de escopo: tipo + entidade da estrutura quando necessário. */
function ScopeFields({
  options,
  scopeType,
  entityId,
  onScopeType,
  onEntityId,
}: {
  options: ScopeOptions;
  scopeType: string;
  entityId: string;
  onScopeType: (value: string) => void;
  onEntityId: (value: string) => void;
}) {
  // Para módulo o valor é o `code`; para a estrutura é o `id`. O componente
  // trata os dois como uma lista simples de {valor, rótulo}.
  const choices: { value: string; label: string }[] =
    scopeType === "module"
      ? options.modules.map((mod) => ({
          value: mod.code,
          label: mod.status === "integrated" ? mod.name : `${mod.name} (em preparação)`,
        }))
      : scopeType === "unit"
        ? options.units.map((u) => ({ value: u.id, label: u.name }))
        : scopeType === "department"
          ? options.departments.map((d) => ({ value: d.id, label: d.name }))
          : scopeType === "team"
            ? options.teams.map((t) => ({ value: t.id, label: t.name }))
            : [];

  return (
    <>
      <label>
        <span>Escopo de acesso *</span>
        <select
          value={scopeType}
          onChange={(event) => {
            onScopeType(event.target.value);
            onEntityId("");
          }}
        >
          {SCOPES.map((scope) => (
            <option key={scope.type} value={scope.type}>
              {scope.label}
            </option>
          ))}
        </select>
      </label>
      {ENTITY_SCOPES.has(scopeType) && (
        <label>
          <span>{scopeType === "module" ? "Qual módulo? *" : "Qual? *"}</span>
          <select value={entityId} onChange={(event) => onEntityId(event.target.value)}>
            <option value="">Selecione…</option>
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** Campo de senha mascarado com botão de revelar. */
function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      <span>{label}</span>
      <span className="user-admin-password">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Mínimo 8 caracteres"
        />
        <button type="button" onClick={() => setVisible((current) => !current)}>
          {visible ? "Ocultar" : "Ver"}
        </button>
      </span>
    </label>
  );
}

function CreateUserForm({
  options,
  onClose,
  onCreated,
}: {
  options: ScopeOptions;
  onClose: () => void;
  onCreated: (email: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleCode, setRoleCode] = useState("manager");
  const [scopeType, setScopeType] = useState("module");
  const [entityId, setEntityId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const scopeReady = !ENTITY_SCOPES.has(scopeType) || Boolean(entityId);
  const valid =
    Boolean(fullName.trim()) &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) &&
    password.length >= 8 &&
    scopeReady;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        roleCode,
        scope: scopePayload(scopeType, entityId),
      }),
    });
    setSubmitting(false);
    if (response.status === 201) return onCreated(email.trim());
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "Não foi possível criar o usuário.");
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">IDENTIDADE · NOVO ACESSO</p>
            <h2>Novo usuário</h2>
            <p>Cria a conta de login, o papel e o escopo. O acesso é garantido pelo RLS.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="user-admin-fields">
          <label className="field-wide">
            <span>Nome completo *</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ex.: Maria Oliveira" />
          </label>
          <label>
            <span>E-mail corporativo *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@pecsil.com.br" />
          </label>
          <PasswordField label="Senha inicial *" value={password} onChange={setPassword} />
          <label>
            <span>Papel *</span>
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              {ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <ScopeFields
            options={options}
            scopeType={scopeType}
            entityId={entityId}
            onScopeType={setScopeType}
            onEntityId={setEntityId}
          />
          <div className="user-admin-note field-wide">
            <span>🔒</span>
            <span>
              <b>{ROLES.find((role) => role.code === roleCode)?.name}</b>
              <small>
                {ROLES.find((role) => role.code === roleCode)?.hint} ·{" "}
                {SCOPES.find((scope) => scope.type === scopeType)?.hint}
              </small>
            </span>
          </div>
          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>

        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={!valid || submitting}>
            {submitting ? "Criando…" : "Criar usuário"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function EditUserDrawer({
  user,
  options,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  options: ScopeOptions;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [roleCode, setRoleCode] = useState(user.roleCode ?? "manager");
  const [scopeType, setScopeType] = useState(user.scopeType ?? "company");
  const [entityId, setEntityId] = useState("");
  const [status, setStatus] = useState(user.status);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Ações destrutivas exigem digitar o e-mail: protege contra clique errado.
  const confirmed = confirm.trim().toLowerCase() === user.email.toLowerCase();
  const scopeReady = !ENTITY_SCOPES.has(scopeType) || Boolean(entityId);

  async function send(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (response.ok) return onSaved(message);
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "Não foi possível aplicar a alteração.");
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">IDENTIDADE · GERENCIAR ACESSO</p>
            <h2>{user.fullName}</h2>
            <p>{user.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="user-admin-fields">
          <label>
            <span>Papel</span>
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              {ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <ScopeFields
            options={options}
            scopeType={scopeType}
            entityId={entityId}
            onScopeType={setScopeType}
            onEntityId={setEntityId}
          />
          <div className="user-admin-actions field-wide">
            <Button
              variant="secondary"
              disabled={busy || !scopeReady}
              onClick={() =>
                send(
                  { roleCode, scope: scopePayload(scopeType, entityId) },
                  `Acesso de ${user.fullName} atualizado.`,
                )
              }
            >
              Salvar papel e escopo
            </Button>
          </div>

          <label className="field-wide">
            <span>Situação</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Ativo</option>
              <option value="blocked">Bloqueado</option>
              <option value="disabled">Desativado</option>
            </select>
          </label>

          <PasswordField label="Definir nova senha" value={password} onChange={setPassword} />

          <label className="field-wide">
            <span>Para bloquear, desativar ou trocar a senha, digite o e-mail do usuário</span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.email} />
          </label>

          <div className="user-admin-actions field-wide">
            <Button
              variant="secondary"
              disabled={busy || !confirmed || status === user.status}
              onClick={() => send({ status }, `Situação de ${user.fullName} alterada.`)}
            >
              Aplicar situação
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !confirmed || password.length < 8}
              onClick={() => send({ password }, `Senha de ${user.fullName} redefinida.`)}
            >
              Redefinir senha
            </Button>
          </div>

          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>

        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </form>
    </div>
  );
}
