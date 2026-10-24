"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Segmented, Status } from "../../packages/design-system";

/**
 * Fundação › WhatsApp: as duas listas de um número da plataforma (decisões do proprietário, 24/10/2026).
 * Comunicação interna: quem é da Pecsil, ligado ao usuário da plataforma; só estes falam com a SARA do número,
 * com a credencial do usuário (número fora da lista é ignorado em silêncio). Comunicação externa: fornecedores,
 * clientes e outros, para os envios e respostas autorizadas pela API oficial (etapa seguinte).
 */
type Sara = { modulo: string; rotulo: string };
type Usuario = { id: string; nome: string; saras: string[] };
type Contato = {
  id: string; lista: "interna" | "externa"; numero: string; numeroLegivel: string | null; ativo: boolean; observacao: string | null;
  usuario: { id: string; nome: string; ativo: boolean } | null; nome: string | null; categoria: string | null; vinculo: string | null;
};
type Dados = { interna: Contato[]; externa: Contato[]; usuarios: Usuario[] };
type Form = { id?: string; numero: string; profile_id: string; nome: string; categoria: string; supplier_id: string; customer_id: string; vinculoNome: string; observacao: string };
type Aba = "interna" | "externa";
type CanalResumo = { id: string; nome: string; sara: Sara | null; conectado: boolean };

const VAZIO: Form = { numero: "", profile_id: "", nome: "", categoria: "fornecedor", supplier_id: "", customer_id: "", vinculoNome: "", observacao: "" };
const CATEGORIA: Record<string, string> = { fornecedor: "Fornecedor", cliente: "Cliente", outro: "Outro" };

async function enviar(corpo: Record<string, unknown>) {
  const r = await fetch("/api/foundation/whatsapp/contatos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

export function WhatsappListas({ notify, canal }: { notify: (m: string) => void; canal: CanalResumo }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("interna");
  const [form, setForm] = useState<Form | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [remover, setRemover] = useState<string | null>(null);
  const [achados, setAchados] = useState<{ id: string; nome: string; documento: string | null }[]>([]);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/foundation/whatsapp/contatos?canal=${canal.id}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.error || "Não foi possível carregar as listas."); return; }
    setErro(""); setDados(d as Dados);
  }, [canal.id]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  // Busca no cadastro para o vínculo do contato externo (fornecedor ou cliente).
  useEffect(() => {
    if (!form || aba !== "externa" || form.categoria === "outro" || form.vinculoNome.trim().length < 2 || form.supplier_id || form.customer_id) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/foundation/whatsapp/contatos?tipo=${form.categoria}&busca=${encodeURIComponent(form.vinculoNome.trim())}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setAchados(r.ok ? d.achados ?? [] : []);
    }, 300);
    return () => clearTimeout(t);
  }, [form, aba]);

  if (erro) return <Callout variant="warning" title="Listas deste número">{erro}</Callout>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando as listas…</small></div>;

  const lista = aba === "interna" ? dados.interna : dados.externa;
  const mudar = (campo: Partial<Form>) => setForm((f) => (f ? { ...f, ...campo } : f));
  const podeSara = (u: Usuario) => Boolean(canal.sara && u.saras.includes(canal.sara.modulo));

  const salvar = async () => {
    if (!form) return;
    setOcupado("salvar");
    const { ok, d } = await enviar({ acao: "salvar", canal: canal.id, lista: aba, ...form, id: form.id ?? null });
    setOcupado(null);
    if (!ok) { notify(d.error || "Não foi possível salvar."); return; }
    notify(form.id ? "Contato alterado." : "Número incluído na lista.");
    setForm(null); setAchados([]);
    void carregar();
  };
  const agir = async (c: Contato, acao: "ativar" | "desativar" | "remover" | "boas_vindas") => {
    setOcupado(`${acao}-${c.id}`); setRemover(null);
    const { ok, d } = await enviar({ acao, id: c.id });
    setOcupado(null);
    const feito = { ativar: "Número ativado.", desativar: "Número desativado.", remover: "Número removido da lista.", boas_vindas: "Boas-vindas enviadas." }[acao];
    notify(ok ? feito : d.error || "Não foi possível.");
    if (ok && acao !== "boas_vindas") void carregar();
  };
  const editar = (c: Contato) => setForm({ ...VAZIO, id: c.id, numero: c.numero.replace(/^55/, ""), profile_id: c.usuario?.id ?? "",
    nome: c.nome ?? "", categoria: c.categoria ?? "fornecedor", vinculoNome: c.vinculo ?? "", observacao: c.observacao ?? "" });

  return (
    <section className="wa-listas" aria-label={`Quem fala com o WhatsApp ${canal.nome}`}>
      <header>
        <div>
          <h3>Quem fala com este número</h3>
          <small>Só os números destas listas são atendidos. Qualquer outro é ignorado em silêncio.</small>
        </div>
        <Segmented<Aba> ariaLabel="Lista" value={aba} onChange={(v) => { setAba(v); setForm(null); setAchados([]); }}
          options={[{ value: "interna", label: `Comunicação interna (${dados.interna.length})` }, { value: "externa", label: `Comunicação externa (${dados.externa.length})` }]} />
      </header>

      <p className="wa-listas-nota">
        {aba === "interna"
          ? <>Funcionários da Pecsil, cada número ligado ao usuário da plataforma. Quem responde é a <b>{canal.sara?.rotulo ?? "SARA responsável (ainda não escolhida)"}</b>, com a credencial do usuário: o que ele não vê na plataforma, não vê pelo WhatsApp. Usuário desativado ou com acesso vencido deixa de valer sozinho.</>
          : "Fornecedores, clientes e outros. O envio de mensagens e as respostas autorizadas a eles começam na etapa da API oficial da Meta; por enquanto, só o cadastro."}
      </p>
      {aba === "interna" && !canal.sara && <Callout variant="warning" title="Falta a SARA responsável">Escolha em Alterar a SARA que responde por este número antes de incluir funcionários.</Callout>}

      {!form && <div className="wa-acoes"><Button type="button" onClick={() => setForm({ ...VAZIO })} disabled={aba === "interna" && !canal.sara}>{aba === "interna" ? "Adicionar funcionário" : "Adicionar contato externo"}</Button></div>}

      {form && (
        <form className="wa-form" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <b>{form.id ? "Alterar" : "Novo"} {aba === "interna" ? "número de funcionário" : "contato externo"}</b>
          <label>Número com DDD<input value={form.numero} onChange={(e) => mudar({ numero: e.target.value })} inputMode="tel" placeholder="15 99662-2530" required /></label>
          {aba === "interna" ? (
            <label>Usuário da plataforma
              <select value={form.profile_id} onChange={(e) => mudar({ profile_id: e.target.value })} required>
                <option value="">Escolha…</option>
                {dados.usuarios.map((u) => <option key={u.id} value={u.id} disabled={!podeSara(u)}>{u.nome}{podeSara(u) ? "" : ` (sem a ${canal.sara?.rotulo ?? "SARA"})`}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label>Nome<input value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={120} placeholder="Pessoa ou empresa" required /></label>
              <label>Categoria
                <select value={form.categoria} onChange={(e) => { mudar({ categoria: e.target.value, supplier_id: "", customer_id: "", vinculoNome: "" }); setAchados([]); }}>
                  <option value="fornecedor">Fornecedor</option><option value="cliente">Cliente</option><option value="outro">Outro</option>
                </select>
              </label>
              {form.categoria !== "outro" && (
                <label className="wa-vinculo">Vínculo no cadastro (opcional)
                  <input value={form.vinculoNome} onChange={(e) => mudar({ vinculoNome: e.target.value, supplier_id: "", customer_id: "" })} placeholder={`Procure o ${form.categoria} pelo nome ou CNPJ`} />
                  {achados.length > 0 && !form.supplier_id && !form.customer_id && (
                    <ul role="listbox">
                      {achados.map((a) => (
                        <li key={a.id}><button type="button" onClick={() => { mudar(form.categoria === "cliente" ? { customer_id: a.id, vinculoNome: a.nome } : { supplier_id: a.id, vinculoNome: a.nome }); setAchados([]); }}>
                          {a.nome}{a.documento ? <small> · {a.documento}</small> : null}</button></li>
                      ))}
                    </ul>
                  )}
                  {(form.supplier_id || form.customer_id) && <small className="wa-ligado">Ligado ao cadastro ✓</small>}
                </label>
              )}
            </>
          )}
          <label className="wa-obs">Observação<input value={form.observacao} onChange={(e) => mudar({ observacao: e.target.value })} maxLength={300} placeholder="Opcional" /></label>
          <div className="wa-acoes">
            <Button type="button" variant="secondary" onClick={() => { setForm(null); setAchados([]); }}>Cancelar</Button>
            <Button type="submit" disabled={ocupado === "salvar"}>{ocupado === "salvar" ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>
      )}

      {!lista.length
        ? <div className="finance-empty almox-vazio"><b>Nenhum número nesta lista</b><small>{aba === "interna" ? "Enquanto a lista estiver vazia, ninguém fala com a SARA por este número." : "Os contatos externos entram aqui quando forem cadastrados."}</small></div>
        : (
          <div className="fin-tabela-rolagem">
            <table className="wa-tabela">
              <thead>
                <tr>
                  <th>Número</th>
                  {aba === "interna" ? <th>Usuário</th> : <><th>Nome</th><th>Categoria</th><th>Cadastro</th></>}
                  <th>Situação</th><th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} className={c.ativo ? "" : "inativo"}>
                    <td>{c.numeroLegivel ?? c.numero}</td>
                    {aba === "interna"
                      ? <td>{c.usuario?.nome}{c.usuario && !c.usuario.ativo ? <small> (não vale: usuário inativo)</small> : null}</td>
                      : <><td>{c.nome}</td><td>{CATEGORIA[c.categoria ?? ""] ?? "—"}</td><td>{c.vinculo ?? "—"}</td></>}
                    <td><Status tone={c.ativo && (aba === "externa" || c.usuario?.ativo) ? "success" : "neutral"}>{c.ativo ? "Ativo" : "Desativado"}</Status></td>
                    <td className="wa-linha-acoes">
                      {aba === "interna" && c.ativo && canal.conectado && <Button type="button" variant="ghost" disabled={ocupado === `boas_vindas-${c.id}`} onClick={() => void agir(c, "boas_vindas")}>Boas-vindas</Button>}
                      <Button type="button" variant="ghost" onClick={() => editar(c)}>Alterar</Button>
                      <Button type="button" variant="ghost" onClick={() => void agir(c, c.ativo ? "desativar" : "ativar")}>{c.ativo ? "Desativar" : "Ativar"}</Button>
                      {remover === c.id
                        ? <><Button type="button" variant="ghost" onClick={() => setRemover(null)}>Cancelar</Button><Button type="button" variant="secondary" onClick={() => void agir(c, "remover")}>Confirmar remoção</Button></>
                        : <Button type="button" variant="ghost" onClick={() => setRemover(c.id)}>Remover</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
