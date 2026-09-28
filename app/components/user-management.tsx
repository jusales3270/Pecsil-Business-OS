"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Button, Card, Status } from "../../packages/design-system";
import {
  ACCESS_CATALOG,
  ACCESS_DEPARTMENTS,
  JOB_TITLES,
  levelLabel,
  levelRank,
  type AccessGrants,
  type AccessLevel,
  type AccessModule,
  type AccountType,
  type JobTitle,
} from "../../modules/access-catalog";

type AdminUser = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  isOwner: boolean;
  accountType: AccountType;
  companyName: string | null;
  jobTitle: JobTitle | null;
  accessExpiresAt: string | null;
  expired: boolean;
  employee: { id: string; name: string; registration: string | null; department: string | null } | null;
  grants: AccessGrants;
};

type Candidate = {
  id: string;
  name: string;
  email: string | null;
  registration: string | null;
  department: string | null;
  position: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  invited: "Convidado",
  blocked: "Bloqueado",
  disabled: "Desativado",
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

/** Data no fuso de Brasília: exibição (dd/mm/aaaa) e campo de data (aaaa-mm-dd). */
function brDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function inputDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "";
}
function todayInput() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function statusTone(status: string): "success" | "attention" | "neutral" {
  if (status === "active") return "success";
  if (status === "invited") return "attention";
  return "neutral";
}

function modulesOf(grants: AccessGrants) {
  return ACCESS_CATALOG.filter((module) => module.features.some((feature) => grants[feature.code]));
}

function summary(grants: AccessGrants) {
  const features = Object.keys(grants).length;
  const modules = modulesOf(grants).length;
  if (!features) return "Nenhuma funcionalidade marcada";
  return `${features} ${features === 1 ? "funcionalidade" : "funcionalidades"} em ${modules} ${modules === 1 ? "módulo" : "módulos"}`;
}

export function UserManagement({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
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
    return () => controller.abort();
  }, []);

  if (denied) {
    return (
      <Card className="user-admin-denied">
        <b>Sem permissão para gerenciar usuários</b>
        <small>Somente o proprietário cria usuários e define o que cada pessoa acessa.</small>
      </Card>
    );
  }

  const copySources = users.filter((user) => !user.isOwner && Object.keys(user.grants).length > 0);

  return (
    <>
      <div className="user-admin-toolbar">
        <div>
          <b>Usuários e acessos</b>
          <small>Cada pessoa tem o próprio acesso: os módulos e, dentro deles, as funcionalidades com o nível.</small>
        </div>
        <Button onClick={() => setCreating(true)}>+ Novo usuário</Button>
      </div>

      <Card className="user-admin-card">
        <div className="user-admin-head">
          <span>Usuário</span>
          <span>Vínculo</span>
          <span>Acesso</span>
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
              onClick={() => !user.isOwner && setEditing(user)}
              disabled={user.isOwner}
              title={user.isOwner ? "O proprietário tem acesso total" : "Gerenciar acesso"}
            >
              <span className="user-admin-person">
                <i>{initials(user.fullName)}</i>
                <span>
                  <b>{user.fullName}</b>
                  <small>{user.email}</small>
                </span>
              </span>
              <span>{linkLabel(user)}</span>
              <span className="access-chips">
                {user.isOwner ? (
                  <em>Proprietário · acesso total</em>
                ) : modulesOf(user.grants).length === 0 ? (
                  <em>Sem acesso</em>
                ) : (
                  modulesOf(user.grants).map((module) => <em key={module.code}>{module.label}</em>)
                )}
              </span>
              {user.expired ? (
                <Status tone="danger">Expirado</Status>
              ) : (
                <Status tone={statusTone(user.status)}>{STATUS_LABEL[user.status] ?? user.status}</Status>
              )}
            </button>
          ))
        )}
      </Card>

      {creating && (
        <CreateUserForm
          copySources={copySources}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            notify(`Acesso de ${name} criado.`);
            void refresh();
          }}
        />
      )}

      {editing && (
        <EditUserDrawer
          user={editing}
          copySources={copySources.filter((source) => source.id !== editing.id)}
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

/** Coluna "Vínculo": ficha do RH, terceiro com a empresa e a validade, ou cargo do administrativo. */
function linkLabel(user: AdminUser) {
  if (user.isOwner) return "—";
  if (user.accountType === "administrativo") return `Administrativo · ${user.jobTitle ? JOB_TITLES[user.jobTitle] : "cargo não informado"}`;
  if (user.accountType === "terceiro") {
    const until = user.accessExpiresAt ? ` · ${user.expired ? "expirou" : "até"} ${brDate(user.accessExpiresAt)}` : "";
    return `Terceiro · ${user.companyName ?? "empresa não informada"}${until}`;
  }
  return user.employee ? user.employee.name : "Colaborador sem ficha vinculada";
}

/**
 * Checklist de dois níveis: módulo (liga/desliga) → funcionalidades, cada uma
 * com o nível (Ver / Operar / Aprovar). Ligar um módulo marca todas as
 * funcionalidades em Ver; os níveis se ajustam um a um.
 */
function AccessChecklist({ grants, onChange }: { grants: AccessGrants; onChange: (next: AccessGrants) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ACCESS_CATALOG.map((module) => [module.code, module.features.some((feature) => grants[feature.code])])),
  );

  function setModule(module: AccessModule, enabled: boolean) {
    const next = { ...grants };
    for (const feature of module.features) {
      if (enabled) next[feature.code] = next[feature.code] ?? "ver";
      else delete next[feature.code];
    }
    onChange(next);
    setOpen((current) => ({ ...current, [module.code]: enabled }));
  }

  function setFeature(code: string, level: AccessLevel | null) {
    const next = { ...grants };
    if (level) next[code] = level;
    else delete next[code];
    onChange(next);
  }

  return (
    <div className="access-checklist">
      {ACCESS_CATALOG.map((module, index) => {
        const marked = module.features.filter((feature) => grants[feature.code]).length;
        const all = marked === module.features.length;
        // Primeiro módulo de um departamento abre o bloco com o nome dele.
        const department =
          module.department && ACCESS_CATALOG[index - 1]?.department !== module.department
            ? ACCESS_DEPARTMENTS[module.department]
            : null;
        return (
          <Fragment key={module.code}>
            {department && <p className="access-department">{department}</p>}
            <section className={`access-module${marked ? " on" : ""}${module.department ? " in-department" : ""}`}>
            <header>
              <label className="access-check">
                <input
                  type="checkbox"
                  checked={marked > 0}
                  ref={(input) => {
                    if (input) input.indeterminate = marked > 0 && !all;
                  }}
                  onChange={(event) => setModule(module, event.target.checked)}
                />
                <span>
                  <b>{module.label}</b>
                  <small>{marked ? `${marked} de ${module.features.length} funcionalidades` : "Sem acesso"}</small>
                </span>
              </label>
              <button
                type="button"
                className="access-toggle"
                aria-expanded={Boolean(open[module.code])}
                onClick={() => setOpen((current) => ({ ...current, [module.code]: !current[module.code] }))}
              >
                <span>{open[module.code] ? "Ocultar" : "Detalhar"}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </header>
            {open[module.code] && (
              <ul className="access-submenu" aria-label={`Funcionalidades de ${module.label}`}>
                {module.features.map((feature) => {
                  const level = grants[feature.code];
                  return (
                    <li key={feature.code} className={level ? "on" : ""}>
                      <label className="access-check">
                        <input
                          type="checkbox"
                          checked={Boolean(level)}
                          onChange={(event) => setFeature(feature.code, event.target.checked ? "ver" : null)}
                        />
                        <span>
                          <b>{feature.label}</b>
                          <small>{feature.description}</small>
                        </span>
                      </label>
                      <div className="access-levels" role="radiogroup" aria-label={`Nível em ${feature.label}`}>
                        {feature.levels.map((candidate) => (
                          <button
                            type="button"
                            key={candidate}
                            role="radio"
                            aria-checked={level === candidate}
                            className={level === candidate ? "active" : ""}
                            onClick={() => setFeature(feature.code, candidate)}
                          >
                            {levelLabel(feature, candidate)}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Resumo legível do que a pessoa poderá fazer, antes de salvar. */
function AccessSummary({ grants }: { grants: AccessGrants }) {
  const modules = modulesOf(grants);
  if (!modules.length) {
    return <p className="access-summary empty">Nenhuma funcionalidade marcada: a pessoa não verá nenhum módulo.</p>;
  }
  return (
    <div className="access-summary">
      <b>O que esta pessoa poderá fazer · {summary(grants)}</b>
      <ul>
        {modules.map((module) => (
          <li key={module.code}>
            <span>{module.label}</span>
            <small>
              {module.features
                .filter((feature) => grants[feature.code])
                .map((feature) => `${feature.label} (${levelLabel(feature, grants[feature.code]).toLowerCase()})`)
                .join(" · ")}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyFrom({ sources, onCopy }: { sources: AdminUser[]; onCopy: (grants: AccessGrants) => void }) {
  if (!sources.length) return null;
  return (
    <label>
      <span>Copiar acessos de…</span>
      <select
        value=""
        onChange={(event) => {
          const source = sources.find((user) => user.id === event.target.value);
          if (source) onCopy({ ...source.grants });
        }}
      >
        <option value="">Escolha um usuário para usar como base</option>
        {sources.map((user) => (
          <option key={user.id} value={user.id}>
            {user.fullName} — {summary(user.grants)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Campo de senha mascarado com botão de revelar. */
function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
          autoComplete="new-password"
        />
        <button type="button" onClick={() => setVisible((current) => !current)}>
          {visible ? "Ocultar" : "Ver"}
        </button>
      </span>
    </label>
  );
}

function CreateUserForm({
  copySources,
  onClose,
  onCreated,
}: {
  copySources: AdminUser[];
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [kind, setKind] = useState<AccountType>("colaborador");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState<JobTitle | "">("");
  const [companyName, setCompanyName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [grants, setGrants] = useState<AccessGrants>({});
  const [checklistKey, setChecklistKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/employees", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { employees: [] }))
      .then((data: { employees: Candidate[] }) => setCandidates(data.employees))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const employee = candidates?.find((candidate) => candidate.id === employeeId) ?? null;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = candidates ?? [];
    return term
      ? list.filter((candidate) =>
          `${candidate.name} ${candidate.registration ?? ""} ${candidate.department ?? ""}`.toLowerCase().includes(term),
        )
      : list;
  }, [candidates, query]);

  // O que ainda falta para criar — mostrado ao lado do botão, para ninguém
  // ficar diante de um botão desativado sem saber por quê.
  const missing = [
    kind === "colaborador" && !employee && "escolher o colaborador (passo 1)",
    kind === "terceiro" && !fullName.trim() && "nome do terceiro",
    kind === "administrativo" && !fullName.trim() && "nome completo",
    kind === "administrativo" && !jobTitle && "cargo",
    kind === "terceiro" && !companyName.trim() && "empresa prestadora",
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && "e-mail de login válido",
    password.length < 8 && "senha com pelo menos 8 caracteres",
    Object.keys(grants).length === 0 && "marcar ao menos uma funcionalidade",
  ].filter((item): item is string => Boolean(item));
  const valid = missing.length === 0;

  function choose(candidate: Candidate) {
    setEmployeeId(candidate.id);
    if (candidate.email) setEmail(candidate.email);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError("");
    const payload = kind === "colaborador"
      ? { kind, employeeId: employee?.id, email: email.trim(), password, grants }
      : kind === "administrativo"
      ? { kind, fullName: fullName.trim(), jobTitle, email: email.trim(), password, grants }
      : { kind, fullName: fullName.trim(), companyName: companyName.trim(), accessExpiresAt: expiresAt || null, email: email.trim(), password, grants };
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (response.status === 201) return onCreated(kind === "colaborador" ? employee?.name ?? "" : fullName.trim());
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "Não foi possível criar o usuário.");
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form access-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">PESSOAS E ACESSOS · NOVO USUÁRIO</p>
            <h2>Novo usuário</h2>
            <p>Diga quem é (colaborador da PecSil, administrativo ou terceiro), defina a senha inicial e marque o que a pessoa poderá acessar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="user-admin-fields">
          <div className="field-wide access-step">
            <span className="access-step-title">1. Quem é</span>
            <div className="access-kind" role="radiogroup" aria-label="Tipo de usuário">
              {([
                ["colaborador", "Colaborador da PecSil", "Está no quadro do RH"],
                ["administrativo", "Administrativo", "Diretor, gerente, assistente ou estagiário"],
                ["terceiro", "Terceiro", "Prestador de fora do quadro"],
              ] as const).map(([value, label, hint]) => (
                <button
                  type="button"
                  key={value}
                  role="radio"
                  aria-checked={kind === value}
                  className={kind === value ? "active" : ""}
                  onClick={() => setKind(value)}
                >
                  <b>{label}</b>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
            {kind === "administrativo" ? (
              <div className="access-third-party">
                <label>
                  <span>Nome completo *</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ex.: Maria Oliveira" />
                </label>
                <label>
                  <span>Cargo *</span>
                  <select value={jobTitle} onChange={(e) => setJobTitle(e.target.value as JobTitle | "")}>
                    <option value="">Escolha o cargo</option>
                    {(Object.entries(JOB_TITLES) as [JobTitle, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : kind === "terceiro" ? (
              <div className="access-third-party">
                <label>
                  <span>Nome completo *</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ex.: Maria Oliveira" />
                </label>
                <label>
                  <span>Empresa prestadora *</span>
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ex.: Contabilidade Silva" />
                </label>
                <label>
                  <span>Acesso válido até</span>
                  <input type="date" value={expiresAt} min={todayInput()} onChange={(e) => setExpiresAt(e.target.value)} />
                  <small>Opcional. No fim desse dia o acesso para sozinho; dá para renovar depois.</small>
                </label>
              </div>
            ) : employee ? (
              <div className="access-employee chosen">
                <span className="user-admin-person">
                  <i>{initials(employee.name)}</i>
                  <span>
                    <b>{employee.name}</b>
                    <small>{[employee.registration && `Matrícula ${employee.registration}`, employee.department, employee.position].filter(Boolean).join(" · ")}</small>
                  </span>
                </span>
                <button type="button" className="employee-cancel" onClick={() => setEmployeeId("")}>Trocar</button>
              </div>
            ) : (
              <>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, matrícula ou setor" />
                <div className="access-employee-list" role="listbox" aria-label="Colaboradores sem acesso">
                  {candidates === null ? (
                    <small>Carregando colaboradores…</small>
                  ) : filtered.length === 0 ? (
                    <small>{candidates.length === 0 ? "Todos os colaboradores ativos já têm acesso." : "Nenhum colaborador encontrado."}</small>
                  ) : (
                    filtered.slice(0, 40).map((candidate) => (
                      <button type="button" role="option" aria-selected={false} key={candidate.id} onClick={() => choose(candidate)}>
                        <b>{candidate.name}</b>
                        <small>{[candidate.registration && `Mat. ${candidate.registration}`, candidate.department].filter(Boolean).join(" · ") || "Sem setor"}</small>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <label>
            <span>E-mail de login *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@pecsil.com.br" autoComplete="off" />
          </label>
          <PasswordField label="Senha inicial *" value={password} onChange={setPassword} />

          <div className="field-wide access-step">
            <span className="access-step-title">2. Acessos</span>
            <CopyFrom
              sources={copySources}
              onCopy={(copied) => {
                setGrants(copied);
                setChecklistKey((key) => key + 1);
              }}
            />
            <AccessChecklist key={checklistKey} grants={grants} onChange={setGrants} />
          </div>

          <div className="field-wide">
            <AccessSummary grants={grants} />
          </div>
          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>

        <footer className="access-form-footer">
          {!valid && <p className="access-missing" role="status">Para criar, falta: {missing.join(" · ")}.</p>}
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

function sameGrants(a: AccessGrants, b: AccessGrants) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => levelRank(a[key]) === levelRank(b[key]));
}

function EditUserDrawer({
  user,
  copySources,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  copySources: AdminUser[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [grants, setGrants] = useState<AccessGrants>(user.grants);
  const [checklistKey, setChecklistKey] = useState(0);
  const [companyName, setCompanyName] = useState(user.companyName ?? "");
  const [jobTitle, setJobTitle] = useState<JobTitle | "">(user.jobTitle ?? "");
  const [expiresAt, setExpiresAt] = useState(inputDate(user.accessExpiresAt));
  const [status, setStatus] = useState(user.status);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Ações destrutivas exigem digitar o e-mail: protege contra clique errado.
  const confirmed = confirm.trim().toLowerCase() === user.email.toLowerCase();
  const changed = !sameGrants(grants, user.grants);

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

  async function remove() {
    if (!window.confirm(`Excluir ${user.fullName} de vez? O login e as permissões serão apagados. Não dá para desfazer.`)) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmEmail: confirm.trim() }),
    });
    setBusy(false);
    if (response.ok) return onSaved(`${user.fullName} foi excluído.`);
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "Não foi possível excluir o usuário.");
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form access-form" onSubmit={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">PESSOAS E ACESSOS · GERENCIAR</p>
            <h2>{user.fullName}</h2>
            <p>{user.email} · {linkLabel(user)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="user-admin-fields">
          {user.accountType === "terceiro" && (
            <div className="field-wide access-step">
              <span className="access-step-title">Dados do terceiro</span>
              {user.expired && (
                <p className="user-admin-error">O acesso expirou em {brDate(user.accessExpiresAt!)}. Defina uma nova data ou remova o prazo para liberar de novo.</p>
              )}
              <div className="access-third-party">
                <label>
                  <span>Empresa prestadora *</span>
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </label>
                <label>
                  <span>Acesso válido até</span>
                  <input type="date" value={expiresAt} min={todayInput()} onChange={(e) => setExpiresAt(e.target.value)} />
                  <small>Vazio = sem prazo.</small>
                </label>
              </div>
              <div className="user-admin-actions">
                <Button
                  variant="secondary"
                  disabled={busy || !companyName.trim() || (companyName.trim() === (user.companyName ?? "") && expiresAt === inputDate(user.accessExpiresAt))}
                  onClick={() => send({ companyName: companyName.trim(), accessExpiresAt: expiresAt || null }, `Dados de ${user.fullName} atualizados.`)}
                >
                  Salvar dados do terceiro
                </Button>
              </div>
            </div>
          )}
          {user.accountType === "administrativo" && (
            <div className="field-wide access-step">
              <span className="access-step-title">Dados do administrativo</span>
              <div className="access-third-party">
                <label>
                  <span>Cargo *</span>
                  <select value={jobTitle} onChange={(e) => setJobTitle(e.target.value as JobTitle | "")}>
                    <option value="">Escolha o cargo</option>
                    {(Object.entries(JOB_TITLES) as [JobTitle, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="user-admin-actions">
                <Button
                  variant="secondary"
                  disabled={busy || !jobTitle || jobTitle === user.jobTitle}
                  onClick={() => send({ jobTitle }, `Cargo de ${user.fullName} atualizado.`)}
                >
                  Salvar cargo
                </Button>
              </div>
            </div>
          )}
          <div className="field-wide access-step">
            <span className="access-step-title">Acessos</span>
            <CopyFrom
              sources={copySources}
              onCopy={(copied) => {
                setGrants(copied);
                setChecklistKey((key) => key + 1);
              }}
            />
            <AccessChecklist key={checklistKey} grants={grants} onChange={setGrants} />
          </div>
          <div className="field-wide">
            <AccessSummary grants={grants} />
          </div>
          <div className="user-admin-actions field-wide">
            <Button disabled={busy || !changed} onClick={() => send({ grants }, `Acesso de ${user.fullName} atualizado.`)}>
              {busy ? "Salvando…" : "Salvar acessos"}
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
            <span>Para bloquear, desativar, trocar a senha ou excluir, digite o e-mail do usuário</span>
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

          <div className="user-admin-danger field-wide">
            <span>
              <b>Excluir usuário</b>
              <small>Apaga o login e as permissões de vez. O histórico do que a pessoa fez continua registrado. Para só tirar o acesso, use a situação Desativado.</small>
            </span>
            <Button variant="secondary" className="danger" disabled={busy || !confirmed} onClick={remove}>
              Excluir usuário
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
