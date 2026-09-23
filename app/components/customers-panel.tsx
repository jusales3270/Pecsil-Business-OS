"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Status } from "../../packages/design-system";
import { formatTaxId, plural, send } from "./cadastros-utils";

export type CustomerEmail = { id: string; email: string; label: string | null };

export type Customer = {
  id: string;
  name: string;
  taxId: string | null;
  active: boolean;
  aliases: string[];
  emails: CustomerEmail[];
  usage: { titulos: number; cards: number };
};

/**
 * Cadastro de clientes — a mesma tela em dois lugares: Fundação › Cadastros
 * (junto de fornecedores e centros de custo) e Comercial › CRM › Clientes,
 * que é onde quem atende o cliente trabalha. Uma implementação só, para as
 * duas não divergirem.
 *
 * Cliente é cadastrado aqui, à mão. Os e-mails de cada um são o que permite
 * ao CRM reconhecer o remetente quando a leitura de e-mail estiver ligada.
 */
export function CustomersPanel({ notify }: { notify: (message: string) => void }) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canMerge, setCanMerge] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [merging, setMerging] = useState<Customer | null>(null);
  const [removing, setRemoving] = useState<Customer | null>(null);
  const [error, setError] = useState("");

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const resposta = await fetch("/api/cadastros/clientes", { cache: "no-store", signal });
    if (!resposta.ok) {
      setError(resposta.status === 403 ? "Sem acesso ao cadastro de clientes." : "Não foi possível carregar os clientes.");
      setCustomers([]);
      return;
    }
    const dados = await resposta.json();
    setError("");
    setCustomers(dados.customers);
    setCanEdit(Boolean(dados.canEdit));
    setCanMerge(Boolean(dados.canMerge));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => carregar(controller.signal))
      .catch((motivo: Error) => {
        if (motivo.name !== "AbortError") setError(motivo.message);
      });
    return () => controller.abort();
  }, [carregar]);

  const filtrados = useMemo(() => {
    const termo = query.trim().toLowerCase();
    const lista = customers ?? [];
    if (!termo) return lista;
    return lista.filter((item) =>
      `${item.name} ${item.aliases.join(" ")} ${item.taxId ?? ""} ${item.emails.map((e) => e.email).join(" ")}`
        .toLowerCase()
        .includes(termo),
    );
  }, [customers, query]);

  return (
    <Card className="md-card">
      <div className="md-toolbar">
        <label className="inline-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, CNPJ ou e-mail…" />
        </label>
        <Status tone="info">{customers ? plural(customers.length, "cliente", "clientes") : "Carregando…"}</Status>
        {canEdit && (
          <span>
            <Button onClick={() => setEditing("new")}>+ Novo cliente</Button>
          </span>
        )}
      </div>
      <p className="md-hint">
        Os e-mails de cada cliente são a lista de <b>remetentes conhecidos</b>: é por ela que o CRM reconhece de quem veio a
        mensagem. Cliente cadastrado aqui aparece na hora ao criar um card no funil.
      </p>
      {error && <p className="user-admin-error">{error}</p>}
      <div className="md-list">
        {filtrados.map((customer) => (
          <div className="md-row" key={customer.id}>
            <span className="md-main">
              <b>{customer.name}</b>
              <small>
                {formatTaxId(customer.taxId) ?? "CNPJ não informado"}
                {customer.emails.length > 0 && ` · ${customer.emails.map((item) => item.email).join(", ")}`}
                {customer.aliases.length > 0 && ` · também escrito: ${customer.aliases.join(", ")}`}
              </small>
            </span>
            <span className="md-usage">
              {plural(customer.usage.cards, "card", "cards")} · {plural(customer.usage.titulos, "título", "títulos")}
            </span>
            <Status tone={customer.active ? "success" : "neutral"}>{customer.active ? "Ativo" : "Inativo"}</Status>
            {canEdit && (
              <span className="md-actions">
                <Button variant="secondary" compact onClick={() => setEditing(customer)}>
                  Editar
                </Button>
                {canMerge && (
                  <Button variant="secondary" compact onClick={() => setMerging(customer)}>
                    Unificar
                  </Button>
                )}
                <Button variant="secondary" compact onClick={() => setRemoving(customer)}>
                  Excluir
                </Button>
              </span>
            )}
          </div>
        ))}
        {customers && filtrados.length === 0 && (
          <div className="user-admin-empty">{query ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}</div>
        )}
      </div>

      {editing && (
        <CustomerForm
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (mensagem) => {
            notify(mensagem);
            setEditing(null);
            await carregar();
          }}
          onChanged={carregar}
        />
      )}
      {merging && customers && (
        <MergeCustomerForm
          keep={merging}
          options={customers.filter((item) => item.id !== merging.id)}
          onClose={() => setMerging(null)}
          onMerged={async (dropped) => {
            notify(`"${dropped}" unificado em "${merging.name}".`);
            setMerging(null);
            await carregar();
          }}
        />
      )}
      {removing && (
        <RemoveCustomerForm
          customer={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            notify(`Cliente ${removing.name} excluído.`);
            setRemoving(null);
            await carregar();
          }}
        />
      )}
    </Card>
  );
}

function CustomerForm({
  customer,
  onClose,
  onSaved,
  onChanged,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (mensagem: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [taxId, setTaxId] = useState(formatTaxId(customer?.taxId ?? null) ?? "");
  const [active, setActive] = useState(customer?.active ?? true);
  const [emails, setEmails] = useState<CustomerEmail[]>(customer?.emails ?? []);
  const [novoEmail, setNovoEmail] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    const falha = customer
      ? await send(`/api/cadastros/clientes/${customer.id}`, "PATCH", { name, taxId, active })
      : await send("/api/cadastros/clientes", "POST", { name, taxId });
    setOcupado(false);
    if (falha) return setErro(falha);
    await onSaved(customer ? `Cliente ${name} atualizado.` : `Cliente ${name} cadastrado.`);
  }

  async function adicionarEmail() {
    if (!customer) return;
    setOcupado(true);
    setErro("");
    const resposta = await fetch(`/api/cadastros/clientes/${customer.id}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: novoEmail }),
    });
    setOcupado(false);
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      return setErro(corpo.error ?? "Não foi possível adicionar o e-mail.");
    }
    // O id vem do banco: sem ele o botão Remover não teria o que remover.
    const { email } = (await resposta.json()) as { email: CustomerEmail };
    setEmails((atual) => [...atual, email]);
    setNovoEmail("");
    await onChanged();
  }

  async function removerEmail(item: CustomerEmail) {
    if (!customer) return;
    setOcupado(true);
    setErro("");
    const resposta = await fetch(`/api/cadastros/clientes/${customer.id}/emails?emailId=${item.id}`, { method: "DELETE" });
    setOcupado(false);
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      return setErro(corpo.error ?? "Não foi possível remover o e-mail.");
    }
    setEmails((atual) => atual.filter((cada) => cada.id !== item.id));
    await onChanged();
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={enviar} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">CADASTROS · CLIENTE</p>
            <h2>{customer ? customer.name : "Novo cliente"}</h2>
            <p>
              {customer
                ? "Renomear não quebra o reconhecimento: a grafia antiga continua caindo neste cliente."
                : "O cliente entra aqui e passa a valer para o Financeiro e para o Comercial."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="user-admin-fields">
          <label className="field-wide">
            <span>Nome *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Razão social ou nome conhecido" />
          </label>
          <label>
            <span>CNPJ ou CPF</span>
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" />
          </label>
          {customer && (
            <label>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Cliente ativo</span>
            </label>
          )}
          {customer ? (
            <div className="field-wide md-emails">
              <span className="md-emails-title">E-mails conhecidos</span>
              {emails.length === 0 && <small>Nenhum e-mail cadastrado. Sem isso o CRM não reconhece o remetente.</small>}
              {emails.map((item) => (
                <span className="md-email-row" key={item.id}>
                  <b>{item.email}</b>
                  <button type="button" onClick={() => void removerEmail(item)} disabled={ocupado} aria-label={`Remover ${item.email}`}>
                    Remover
                  </button>
                </span>
              ))}
              <span className="md-email-add">
                <input
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  placeholder="compras@cliente.com.br"
                  inputMode="email"
                />
                <Button variant="secondary" compact type="button" disabled={ocupado || !novoEmail.includes("@")} onClick={() => void adicionarEmail()}>
                  Adicionar
                </Button>
              </span>
            </div>
          ) : (
            <p className="md-hint field-wide">Depois de salvar, os e-mails do cliente são cadastrados aqui mesmo.</p>
          )}
          {erro && <p className="user-admin-error field-wide">{erro}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={ocupado || !name.trim()}>
            {ocupado ? "Salvando…" : "Salvar"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

/**
 * Excluir apaga o cadastro de vez. Quando o cliente já tem card ou título, o
 * servidor recusa: apagar levaria junto o vínculo do histórico. Nesse caso o
 * caminho é desativar.
 */
function RemoveCustomerForm({
  customer,
  onClose,
  onRemoved,
}: {
  customer: Customer;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const emUso = customer.usage.cards > 0 || customer.usage.titulos > 0;

  async function excluir(evento: FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    const resposta = await fetch(`/api/cadastros/clientes/${customer.id}`, { method: "DELETE" });
    setOcupado(false);
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      return setErro(corpo.error ?? "Não foi possível excluir o cliente.");
    }
    await onRemoved();
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={excluir} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">CADASTROS · EXCLUIR CLIENTE</p>
            <h2>Excluir “{customer.name}”?</h2>
            <p>
              {emUso
                ? "Este cliente já tem histórico. Excluir não é possível — desative no botão Editar para tirá-lo das listas sem perder o vínculo."
                : "Some da lista e dos formulários. Os e-mails conhecidos dele vão junto. Não dá para desfazer."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="user-admin-fields">
          <p className="md-hint field-wide">
            {plural(customer.usage.cards, "card no funil", "cards no funil")} ·{" "}
            {plural(customer.usage.titulos, "título no Financeiro", "títulos no Financeiro")} ·{" "}
            {plural(customer.emails.length, "e-mail conhecido", "e-mails conhecidos")}
          </p>
          {erro && <p className="user-admin-error field-wide">{erro}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={ocupado || emUso}>
            {ocupado ? "Excluindo…" : "Excluir"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function MergeCustomerForm({
  keep,
  options,
  onClose,
  onMerged,
}: {
  keep: Customer;
  options: Customer[];
  onClose: () => void;
  onMerged: (droppedName: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [dropId, setDropId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const dropped = options.find((item) => item.id === dropId) ?? null;
  const filtrados = useMemo(() => {
    const termo = query.trim().toLowerCase();
    return (termo ? options.filter((item) => item.name.toLowerCase().includes(termo)) : options).slice(0, 40);
  }, [options, query]);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!dropped) return;
    setOcupado(true);
    const falha = await send("/api/cadastros/clientes/unificar", "POST", { keepId: keep.id, dropId: dropped.id });
    setOcupado(false);
    if (falha) return setErro(falha);
    await onMerged(dropped.name);
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={enviar} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">CADASTROS · UNIFICAR CLIENTE</p>
            <h2>Manter “{keep.name}”</h2>
            <p>Escolha o cadastro duplicado. Títulos e e-mails dele passam para “{keep.name}”, e a grafia dele continua reconhecida.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="user-admin-fields">
          <div className="field-wide access-step">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar o duplicado…" />
            <div className="access-employee-list" role="listbox" aria-label="Clientes">
              {filtrados.map((item) => (
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
                    {plural(item.usage.titulos, "título", "títulos")} · {plural(item.emails.length, "e-mail", "e-mails")}
                  </small>
                </button>
              ))}
              {filtrados.length === 0 && <small>Nenhum cliente encontrado.</small>}
            </div>
          </div>
          {dropped && (
            <p className="md-hint field-wide">
              “{dropped.name}” deixa de aparecer na lista; {plural(dropped.usage.titulos, "título", "títulos")} e{" "}
              {plural(dropped.emails.length, "e-mail", "e-mails")} passam para “{keep.name}”. Não dá para desfazer pela tela.
            </p>
          )}
          {erro && <p className="user-admin-error field-wide">{erro}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={ocupado || !dropped}>
            {ocupado ? "Unificando…" : "Unificar"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
