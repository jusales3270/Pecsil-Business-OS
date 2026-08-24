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
};

const ROLES: { code: string; name: string; hint: string }[] = [
  { code: "director", name: "Diretor", hint: "Indicadores e aprovações das áreas" },
  { code: "manager", name: "Gestor", hint: "Gestão de RH e Financeiro" },
  { code: "operator", name: "Operador", hint: "Execução operacional" },
  { code: "employee", name: "Colaborador", hint: "Autosserviço e próprio registro" },
  { code: "admin", name: "Administrador", hint: "Configuração técnica da plataforma" },
];

const SCOPES: { type: string; label: string; hint: string }[] = [
  { type: "company", label: "Toda a empresa", hint: "Acesso aos dados de toda a Pecsil" },
  { type: "self", label: "Próprio registro", hint: "Somente os próprios dados" },
];

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function statusTone(status: string): "success" | "attention" | "neutral" {
  if (status === "active") return "success";
  if (status === "invited") return "attention";
  return "neutral";
}

const statusLabel: Record<string, string> = {
  active: "Ativo",
  invited: "Convidado",
  blocked: "Bloqueado",
  disabled: "Desativado",
};

export function UserManagement({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [creating, setCreating] = useState(false);

  async function fetchUsers(signal?: AbortSignal): Promise<{ denied: boolean; users: AdminUser[] }> {
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
          users.map((u) => (
            <div className="user-admin-row" key={u.id}>
              <div className="user-admin-person">
                <i>{initials(u.fullName)}</i>
                <span>
                  <b>{u.fullName}</b>
                  <small>{u.email}</small>
                </span>
              </div>
              <span>{u.roleName}</span>
              <span>{u.scopeLabel}</span>
              <Status tone={statusTone(u.status)}>{statusLabel[u.status] ?? u.status}</Status>
            </div>
          ))
        )}
      </Card>

      {creating && (
        <CreateUserForm
          onClose={() => setCreating(false)}
          onCreated={(email) => {
            setCreating(false);
            notify(`Usuário ${email} criado.`);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function CreateUserForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleCode, setRoleCode] = useState("manager");
  const [scopeType, setScopeType] = useState("company");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const valid = fullName.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && password.length >= 8;

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
        scope: { type: scopeType },
      }),
    });
    setSubmitting(false);
    if (response.status === 201) {
      onCreated(email.trim());
      return;
    }
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
          <label>
            <span>Senha inicial *</span>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
          </label>
          <label>
            <span>Papel *</span>
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Escopo de acesso *</span>
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
              {SCOPES.map((s) => (
                <option key={s.type} value={s.type}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="user-admin-note field-wide">
            <span>🔒</span>
            <span>
              <b>{ROLES.find((r) => r.code === roleCode)?.name}</b>
              <small>
                {ROLES.find((r) => r.code === roleCode)?.hint} · {SCOPES.find((s) => s.type === scopeType)?.hint}
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
