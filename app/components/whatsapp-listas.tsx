"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Fundação › WhatsApp: a allowlist de um número da plataforma (decisões do proprietário, 25/10/2026). Só quem está
 * nela fala com o número; qualquer outro é ignorado em silêncio. Cada pessoa é um usuário da plataforma (escolhido
 * na lista; o nome digitado é só apelido), com a SARA de que recebe e envia informação, sempre com a credencial
 * dela: o que não vê na plataforma, não vê pelo WhatsApp. Fornecedores e clientes ficam para depois.
 */
type Sara = { modulo: string; rotulo: string };
type Usuario = { id: string; nome: string; saras: string[] };
type Contato = {
  id: string; numero: string; numeroLegivel: string | null; ativo: boolean; observacao: string | null; nome: string | null;
  usuario: { id: string; nome: string; ativo: boolean } | null; sara: { modulo: string; rotulo: string; liberada: boolean } | null;
};
type Dados = { interna: Contato[]; usuarios: Usuario[]; saras: Sara[] };
type Form = { id?: string; numero: string; profile_id: string; busca: string; nome: string; sara_modulo: string; observacao: string };
type CanalResumo = { id: string; nome: string; conectado: boolean };

const VAZIO: Form = { numero: "", profile_id: "", busca: "", nome: "", sara_modulo: "", observacao: "" };
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function enviar(corpo: Record<string, unknown>) {
  const r = await fetch("/api/foundation/whatsapp/contatos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

export function WhatsappListas({ notify, canal }: { notify: (m: string) => void; canal: CanalResumo }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [remover, setRemover] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/foundation/whatsapp/contatos?canal=${canal.id}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.error || "Não foi possível carregar a allowlist."); return; }
    setErro(""); setDados(d as Dados);
  }, [canal.id]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  if (erro) return <Callout variant="warning" title="Allowlist deste número">{erro}</Callout>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando a allowlist…</small></div>;

  const mudar = (campo: Partial<Form>) => setForm((f) => (f ? { ...f, ...campo } : f));
  const rotulo = (modulo: string) => dados.saras.find((s) => s.modulo === modulo)?.rotulo ?? modulo;
  const escolhido = form?.profile_id ? dados.usuarios.find((u) => u.id === form.profile_id) ?? null : null;
  const achados = form && !escolhido && form.busca.trim().length >= 2
    ? dados.usuarios.filter((u) => semAcento(u.nome).includes(semAcento(form.busca.trim()))).slice(0, 8) : [];

  const escolher = (u: Usuario) => mudar({ profile_id: u.id, busca: u.nome, sara_modulo: u.saras.length === 1 ? u.saras[0] : "" });
  const salvar = async () => {
    if (!form) return;
    setOcupado("salvar");
    const { ok, d } = await enviar({ acao: "salvar", canal: canal.id, lista: "interna", numero: form.numero, profile_id: form.profile_id, nome: form.nome,
      sara_modulo: form.sara_modulo, observacao: form.observacao, id: form.id ?? null });
    setOcupado(null);
    if (!ok) { notify(d.error || "Não foi possível salvar."); return; }
    notify(form.id ? "Pessoa alterada." : "Pessoa incluída na allowlist.");
    setForm(null);
    void carregar();
  };
  const agir = async (c: Contato, acao: "ativar" | "desativar" | "remover" | "boas_vindas") => {
    setOcupado(`${acao}-${c.id}`); setRemover(null);
    const { ok, d } = await enviar({ acao, id: c.id });
    setOcupado(null);
    const feito = { ativar: "Número ativado.", desativar: "Número desativado.", remover: "Número removido da allowlist.", boas_vindas: "Boas-vindas enviadas." }[acao];
    notify(ok ? feito : d.error || "Não foi possível.");
    if (ok && acao !== "boas_vindas") void carregar();
  };
  const editar = (c: Contato) => setForm({ id: c.id, numero: c.numero.replace(/^55/, ""), profile_id: c.usuario?.id ?? "", busca: c.usuario?.nome ?? "",
    nome: c.nome ?? "", sara_modulo: c.sara?.modulo ?? "", observacao: c.observacao ?? "" });

  return (
    <section className="wa-listas" aria-label={`Allowlist do WhatsApp ${canal.nome}`}>
      <header>
        <div>
          <h3>Allowlist</h3>
          <small>Só os números desta lista falam com a SARA por este número: ela só responde e envia a eles. Qualquer outro é ignorado em silêncio.</small>
        </div>
      </header>
      <p className="wa-listas-nota">
        Cada pessoa é um usuário da plataforma, com a SARA de que recebe e envia informação. A SARA responde com a credencial dela: o que ela não vê na plataforma, não vê pelo WhatsApp. Usuário desativado ou com acesso vencido deixa de valer sozinho. Fornecedores e clientes entram numa etapa seguinte.
      </p>

      {!form && <div className="wa-acoes"><Button type="button" onClick={() => setForm({ ...VAZIO })}>Adicionar pessoa</Button></div>}

      {form && (
        <form className="wa-form" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <b>{form.id ? "Alterar pessoa da allowlist" : "Nova pessoa na allowlist"}</b>
          <label className="wa-vinculo">Pessoa (usuário da plataforma)
            <input value={form.busca} onChange={(e) => mudar({ busca: e.target.value, profile_id: "", sara_modulo: "" })} placeholder="Digite parte do nome e escolha na lista" autoComplete="off" required />
            {achados.length > 0 && (
              <ul role="listbox" aria-label="Usuários da plataforma">
                {achados.map((u) => (
                  <li key={u.id}><button type="button" onClick={() => escolher(u)} disabled={!u.saras.length}>
                    {u.nome}{u.saras.length ? <small> · {u.saras.length === 1 ? rotulo(u.saras[0]) : `${u.saras.length} SARAs`}</small> : <small> · sem nenhuma SARA liberada</small>}</button></li>
                ))}
              </ul>
            )}
            {form.busca.trim().length >= 2 && !escolhido && !achados.length && <small className="wa-falta">Nenhum usuário com esse nome.</small>}
            {escolhido && <small className="wa-ligado">Usuário escolhido ✓</small>}
          </label>
          <label>SARA
            <select value={form.sara_modulo} onChange={(e) => mudar({ sara_modulo: e.target.value })} disabled={!escolhido} required>
              <option value="">{escolhido ? "De qual SARA ela recebe e envia" : "Escolha a pessoa antes"}</option>
              {(escolhido?.saras ?? []).map((m) => <option key={m} value={m}>{rotulo(m)}</option>)}
            </select>
          </label>
          <label>Número com DDD<input value={form.numero} onChange={(e) => mudar({ numero: e.target.value })} inputMode="tel" placeholder="15 91234-5678" required /></label>
          <label>Apelido<input value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={60} placeholder="Opcional (como aparece na lista)" /></label>
          <label className="wa-obs">Observação<input value={form.observacao} onChange={(e) => mudar({ observacao: e.target.value })} maxLength={300} placeholder="Opcional" /></label>
          <div className="wa-acoes">
            <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
            <Button type="submit" disabled={ocupado === "salvar" || !escolhido || !form.sara_modulo}>{ocupado === "salvar" ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>
      )}

      {!dados.interna.length
        ? <div className="finance-empty almox-vazio"><b>Ninguém na allowlist</b><small>Enquanto a lista estiver vazia, ninguém fala com a SARA por este número.</small></div>
        : (
          <div className="fin-tabela-rolagem">
            <table className="wa-tabela">
              <thead>
                <tr><th>Número</th><th>Pessoa</th><th>SARA</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {dados.interna.map((c) => {
                  const vale = c.ativo && Boolean(c.usuario?.ativo) && Boolean(c.sara?.liberada);
                  return (
                    <tr key={c.id} className={c.ativo ? "" : "inativo"}>
                      <td>{c.numeroLegivel ?? c.numero}</td>
                      <td>{c.nome ? <>{c.nome} <small>({c.usuario?.nome})</small></> : c.usuario?.nome}{c.usuario && !c.usuario.ativo ? <small> (não vale: usuário inativo)</small> : null}</td>
                      <td>{c.sara ? <>{c.sara.rotulo}{!c.sara.liberada && c.usuario?.ativo ? <small className="wa-falta"> (a credencial não libera mais)</small> : null}</> : <em className="wa-falta">escolha a SARA</em>}</td>
                      <td><Status tone={vale ? "success" : "neutral"}>{c.ativo ? "Ativo" : "Desativado"}</Status></td>
                      <td className="wa-linha-acoes">
                        {c.ativo && canal.conectado && <Button type="button" variant="ghost" disabled={ocupado === `boas_vindas-${c.id}`} onClick={() => void agir(c, "boas_vindas")}>Boas-vindas</Button>}
                        <Button type="button" variant="ghost" onClick={() => editar(c)}>Alterar</Button>
                        <Button type="button" variant="ghost" onClick={() => void agir(c, c.ativo ? "desativar" : "ativar")}>{c.ativo ? "Desativar" : "Ativar"}</Button>
                        {remover === c.id
                          ? <><Button type="button" variant="ghost" onClick={() => setRemover(null)}>Cancelar</Button><Button type="button" variant="secondary" onClick={() => void agir(c, "remover")}>Confirmar remoção</Button></>
                          : <Button type="button" variant="ghost" onClick={() => setRemover(c.id)}>Remover</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
