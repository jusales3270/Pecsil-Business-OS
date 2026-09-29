"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Status } from "../../packages/design-system";
import { formatTaxId, plural, send } from "./cadastros-utils";
import { CustomersPanel } from "./customers-panel";

type Supplier = {
  id: string;
  name: string;
  taxId: string | null;
  active: boolean;
  aliases: string[];
  usage: { cotacoes: number; compras: number; titulos: number };
};

type CostCenter = { id: string; code: string; name: string; active: boolean; departmentId: string | null; department: string | null };
type Department = { id: string; name: string };

const MASTER_TABS = ["Fornecedores", "Clientes", "Centros de custo"] as const;
type MasterTab = (typeof MASTER_TABS)[number];

/**
 * Cadastros mestres usados por todos os módulos. Fornecedor e centro de custo
 * servem a Compras e Financeiro; cliente serve ao Financeiro e ao CRM. O
 * fornecedor nasce sozinho de um lançamento; o cliente é cadastrado aqui (e,
 * quando o CRM estiver ligado, pelo e-mail que chega).
 */
export function MasterDataView({ notify }: { notify: (message: string) => void }) {
  const [tab, setTab] = useState<MasterTab>("Fornecedores");
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">FUNDAÇÃO · CADASTROS MESTRES</p>
          <h1>Cadastros</h1>
          <p>Um só cadastro de fornecedores, clientes e centros de custo para Compras, Financeiro, Comercial e os próximos módulos.</p>
        </div>
      </div>
      <div className="section-tabs" role="tablist">
        {MASTER_TABS.map((item) => (
          <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>
            {item}
          </button>
        ))}
      </div>
      {tab === "Fornecedores" && <SuppliersTab notify={notify} />}
      {tab === "Clientes" && <CustomersPanel notify={notify} />}
      {tab === "Centros de custo" && <CostCentersTab notify={notify} />}
    </>
  );
}

function SuppliersTab({ notify }: { notify: (message: string) => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [merging, setMerging] = useState<Supplier | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/cadastros/fornecedores", { cache: "no-store" });
    if (!response.ok) {
      setError(response.status === 403 ? "Sem acesso a Cadastros." : "Não foi possível carregar os fornecedores.");
      setSuppliers([]);
      return;
    }
    const data = await response.json();
    setSuppliers(data.suppliers);
    setCanEdit(Boolean(data.canEdit));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cadastros/fornecedores", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "Sem acesso a Cadastros." : "Não foi possível carregar os fornecedores.");
        return response.json();
      })
      .then((data) => {
        setSuppliers(data.suppliers);
        setCanEdit(Boolean(data.canEdit));
      })
      .catch((reason: Error) => {
        if (reason.name === "AbortError") return;
        setError(reason.message);
        setSuppliers([]);
      });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = suppliers ?? [];
    if (!term) return list;
    return list.filter((item) => `${item.name} ${item.aliases.join(" ")} ${item.taxId ?? ""}`.toLowerCase().includes(term));
  }, [suppliers, query]);

  return (
    <Card className="md-card">
      <div className="md-toolbar">
        <label className="inline-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar fornecedor, apelido ou CNPJ…" />
        </label>
        <Status tone="info">{suppliers ? plural(suppliers.length, "fornecedor", "fornecedores") : "Carregando…"}</Status>
      </div>
      <p className="md-hint">
        Fornecedores nascem sozinhos quando alguém lança uma cotação, compra ou título com um nome novo. Se o mesmo fornecedor
        aparecer escrito de dois jeitos, use <b>Unificar</b>: os lançamentos passam para o principal e a grafia antiga continua
        reconhecida.
      </p>
      {error && <p className="user-admin-error">{error}</p>}
      <div className="md-list">
        {filtered.map((supplier) => (
          <div className="md-row" key={supplier.id}>
            <span className="md-main">
              <b>{supplier.name}</b>
              <small>
                {formatTaxId(supplier.taxId) ?? "CNPJ não informado"}
                {supplier.aliases.length > 0 && ` · também escrito: ${supplier.aliases.join(", ")}`}
              </small>
            </span>
            <span className="md-usage">
              {plural(supplier.usage.cotacoes, "cotação", "cotações")} · {plural(supplier.usage.compras, "compra", "compras")} ·{" "}
              {plural(supplier.usage.titulos, "título", "títulos")}
            </span>
            <Status tone={supplier.active ? "success" : "neutral"}>{supplier.active ? "Ativo" : "Inativo"}</Status>
            {canEdit && (
              <span className="md-actions">
                <Button variant="secondary" compact onClick={() => setEditing(supplier)}>Editar</Button>
                <Button variant="secondary" compact onClick={() => setMerging(supplier)}>Unificar</Button>
              </span>
            )}
          </div>
        ))}
        {suppliers && filtered.length === 0 && <div className="user-admin-empty">Nenhum fornecedor encontrado.</div>}
      </div>

      {editing && (
        <SupplierForm
          supplier={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            notify(`Fornecedor ${editing.name} atualizado.`);
            setEditing(null);
            void load();
          }}
        />
      )}
      {merging && suppliers && (
        <MergeForm
          keep={merging}
          options={suppliers.filter((item) => item.id !== merging.id)}
          onClose={() => setMerging(null)}
          onMerged={(dropped) => {
            notify(`"${dropped}" unificado em "${merging.name}".`);
            setMerging(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(supplier.name);
  const [taxId, setTaxId] = useState(formatTaxId(supplier.taxId) ?? "");
  const [active, setActive] = useState(supplier.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const failure = await send(`/api/cadastros/fornecedores/${supplier.id}`, "PATCH", { name, taxId, active });
    setBusy(false);
    if (failure) return setError(failure);
    onSaved();
  }

  return (
    <div className="employee-layer form-layer">
      <form className="user-admin-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">CADASTROS · FORNECEDOR</p>
            <h2>{supplier.name}</h2>
            <p>O nome antigo continua reconhecido nos lançamentos do Compras e do Financeiro.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        <div className="user-admin-fields">
          <label className="field-wide">
            <span>Nome *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>CNPJ ou CPF</span>
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" />
          </label>
          <label>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Fornecedor ativo</span>
          </label>
          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? "Salvando…" : "Salvar"}</Button>
        </footer>
      </form>
    </div>
  );
}

function MergeForm({
  keep,
  options,
  onClose,
  onMerged,
}: {
  keep: Supplier;
  options: Supplier[];
  onClose: () => void;
  onMerged: (droppedName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [dropId, setDropId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dropped = options.find((item) => item.id === dropId) ?? null;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (term ? options.filter((item) => item.name.toLowerCase().includes(term)) : options).slice(0, 40);
  }, [options, query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dropped) return;
    setBusy(true);
    const failure = await send("/api/cadastros/fornecedores/unificar", "POST", { keepId: keep.id, dropId: dropped.id });
    setBusy(false);
    if (failure) return setError(failure);
    onMerged(dropped.name);
  }

  return (
    <div className="employee-layer form-layer">
      <form className="user-admin-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">CADASTROS · UNIFICAR FORNECEDOR</p>
            <h2>Manter “{keep.name}”</h2>
            <p>Escolha o cadastro duplicado. Os lançamentos dele passam para “{keep.name}”, e a grafia dele continua reconhecida.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        <div className="user-admin-fields">
          <div className="field-wide access-step">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar o duplicado…" />
            <div className="access-employee-list" role="listbox" aria-label="Fornecedores">
              {filtered.map((item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === dropId}
                  className={item.id === dropId ? "selected" : ""}
                  key={item.id}
                  onClick={() => setDropId(item.id)}
                >
                  <b>{item.name}</b>
                  <small>
                    {plural(item.usage.cotacoes, "cotação", "cotações")} · {plural(item.usage.compras, "compra", "compras")}
                  </small>
                </button>
              ))}
              {filtered.length === 0 && <small>Nenhum fornecedor encontrado.</small>}
            </div>
          </div>
          {dropped && (
            <p className="md-hint field-wide">
              “{dropped.name}” deixa de aparecer na lista; {plural(dropped.usage.cotacoes, "cotação", "cotações")} e{" "}
              {plural(dropped.usage.compras, "compra", "compras")} passam para “{keep.name}”. Não dá para desfazer pela tela.
            </p>
          )}
          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button>
          <Button type="submit" disabled={busy || !dropped}>{busy ? "Unificando…" : "Unificar"}</Button>
        </footer>
      </form>
    </div>
  );
}

/**
 * Clientes. Ao contrário do fornecedor, o cliente não nasce de lançamento
 * nenhum hoje: o Financeiro não tem títulos a receber lançados. Por isso a
 * aba começa vazia e o cadastro é manual — e cada cliente guarda os e-mails
 * por onde ele escreve, que é como o CRM vai reconhecer o remetente.
 */
function CostCentersTab({ notify }: { notify: (message: string) => void }) {
  const [centers, setCenters] = useState<CostCenter[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState<CostCenter | "new" | null>(null);
  const [error, setError] = useState("");

  const apply = (data: { centers: CostCenter[]; departments: Department[]; canEdit: boolean }) => {
    setCenters(data.centers);
    setDepartments(data.departments);
    setCanEdit(Boolean(data.canEdit));
  };

  const load = useCallback(async () => {
    const response = await fetch("/api/cadastros/centros", { cache: "no-store" });
    if (!response.ok) {
      setError("Não foi possível carregar os centros de custo.");
      setCenters([]);
      return;
    }
    apply(await response.json());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cadastros/centros", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os centros de custo.");
        return response.json();
      })
      .then(apply)
      .catch((reason: Error) => {
        if (reason.name === "AbortError") return;
        setError(reason.message);
        setCenters([]);
      });
    return () => controller.abort();
  }, []);

  return (
    <Card className="md-card">
      <div className="md-toolbar">
        <p className="md-hint">
          Centros de custo servem ao Financeiro e, quando o processo definir, ao Compras. Crie aqui os centros da PecSil.
        </p>
        {canEdit && <span><Button onClick={() => setEditing("new")}>+ Novo centro</Button></span>}
      </div>
      {error && <p className="user-admin-error">{error}</p>}
      <div className="md-list">
        {(centers ?? []).map((center) => (
          <div className="md-row" key={center.id}>
            <span className="md-main">
              <b>{center.code} · {center.name}</b>
              <small>{center.department ?? "Sem departamento"}</small>
            </span>
            <span className="md-usage" />
            <Status tone={center.active ? "success" : "neutral"}>{center.active ? "Ativo" : "Inativo"}</Status>
            {canEdit && (
              <span className="md-actions">
                <Button variant="secondary" compact onClick={() => setEditing(center)}>Editar</Button>
              </span>
            )}
          </div>
        ))}
        {centers && centers.length === 0 && (
          <div className="user-admin-empty">Nenhum centro de custo cadastrado ainda.</div>
        )}
      </div>
      {editing && (
        <CostCenterForm
          center={editing === "new" ? null : editing}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={(label) => {
            notify(label);
            setEditing(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}

function CostCenterForm({
  center,
  departments,
  onClose,
  onSaved,
}: {
  center: CostCenter | null;
  departments: Department[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [code, setCode] = useState(center?.code ?? "");
  const [name, setName] = useState(center?.name ?? "");
  const [departmentId, setDepartmentId] = useState(center?.departmentId ?? "");
  const [active, setActive] = useState(center?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const failure = center
      ? await send(`/api/cadastros/centros/${center.id}`, "PATCH", { name, departmentId, active })
      : await send("/api/cadastros/centros", "POST", { code, name, departmentId });
    setBusy(false);
    if (failure) return setError(failure);
    onSaved(center ? `Centro ${center.code} atualizado.` : `Centro ${code} criado.`);
  }

  return (
    <div className="employee-layer form-layer">
      <form className="user-admin-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">CADASTROS · CENTRO DE CUSTO</p>
            <h2>{center ? `${center.code} · ${center.name}` : "Novo centro de custo"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        <div className="user-admin-fields">
          <label>
            <span>Código *</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} disabled={Boolean(center)} placeholder="Ex.: 3.01" />
          </label>
          <label>
            <span>Nome *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Fundição" />
          </label>
          <label className="field-wide">
            <span>Departamento</span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Sem departamento</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>
          {center && (
            <label>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Centro ativo</span>
            </label>
          )}
          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>Cancelar</button>
          <Button type="submit" disabled={busy || !code.trim() || !name.trim()}>{busy ? "Salvando…" : "Salvar"}</Button>
        </footer>
      </form>
    </div>
  );
}
