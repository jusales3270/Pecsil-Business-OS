"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Financeiro › Homologação › Alçadas: as regras reais de aprovação da organização. Sem nenhuma
 * regra, nada muda (o título segue aprovado numa etapa só). Com regra, o título que cai na faixa
 * nasce "em aprovação", passa por cada nível e só recebe baixa depois de aprovado; a mesma pessoa
 * não aprova dois níveis do mesmo título.
 */

type Regra = {
  id: string; name: string; direction: "payable" | "receivable" | null; min_amount: number; max_amount: number | null;
  approval_level: number; approver_profile_id: string | null; approver_role_id: string | null; active: boolean;
};
type Dados = { regras: Regra[]; pessoas: { id: string; nome: string }[]; papeis: { id: string; name: string }[]; podeEditar: boolean };
type Form = { id?: string; name: string; direction: string; min: string; max: string; nivel: string; quem: string; active: boolean };

const VAZIO: Form = { name: "", direction: "payable", min: "", max: "", nivel: "1", quem: "", active: true };
const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const lerValor = (s: string) => {
  const v = s.trim();
  if (!v) return null;
  return Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
};
const DIRECAO: Record<string, string> = { payable: "Contas a pagar", receivable: "Contas a receber", "": "Pagar e receber" };

export function FinanceAlcadas({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/finance/alcadas", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.error || "Não foi possível carregar as alçadas."); return; }
    setErro("");
    setDados(d as Dados);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const quemDe = (r: Regra) => r.approver_profile_id
    ? dados?.pessoas.find((p) => p.id === r.approver_profile_id)?.nome ?? "—"
    : r.approver_role_id ? `Papel: ${dados?.papeis.find((p) => p.id === r.approver_role_id)?.name ?? "—"}` : "Quem aprova contas";

  const editar = (r: Regra) => setForm({
    id: r.id, name: r.name, direction: r.direction ?? "", min: String(r.min_amount).replace(".", ","), max: r.max_amount == null ? "" : String(r.max_amount).replace(".", ","),
    nivel: String(r.approval_level), quem: r.approver_profile_id ? `p:${r.approver_profile_id}` : r.approver_role_id ? `r:${r.approver_role_id}` : "", active: r.active,
  });

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const min = lerValor(form.min) ?? 0;
    const max = lerValor(form.max);
    if (!form.name.trim()) { notify("Dê um nome à alçada."); return; }
    if (!Number.isFinite(min) || min < 0 || (max != null && (!Number.isFinite(max) || max <= min))) { notify("Confira a faixa de valor: o valor até tem de ser maior que o a partir de."); return; }
    setSalvando(true);
    const r = await fetch("/api/finance/alcadas", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: form.id, name: form.name.trim(), direction: form.direction || null, min_amount: min, max_amount: max, approval_level: Number(form.nivel) || 1,
        approver_profile_id: form.quem.startsWith("p:") ? form.quem.slice(2) : null, approver_role_id: form.quem.startsWith("r:") ? form.quem.slice(2) : null, active: form.active,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) { notify(d.error || "Não foi possível gravar a alçada."); return; }
    notify(`Alçada gravada: ${form.name.trim()}.`);
    setForm(null);
    void carregar();
  };

  if (erro) return <Callout variant="warning" title="Alçadas">{erro}</Callout>;
  if (!dados) return <p className="fin-alcadas-carregando">Carregando alçadas…</p>;
  const ativas = dados.regras.filter((r) => r.active).length;

  return (
    <div className="fin-alcadas">
      {ativas === 0
        ? <Callout variant="info" title="Nenhuma alçada ativa">Sem alçada, tudo funciona como hoje: a conta a pagar lançada à mão pede um “Aprovar” de quem aprova contas, e a que vem do recebimento já nasce aprovada. Cadastre uma faixa para exigir aprovação por valor, nível e pessoa.</Callout>
        : <Callout variant="info" title={`${ativas} alçada(s) ativa(s)`}>O título que cai numa faixa nasce em aprovação e só recebe baixa depois de aprovado em todos os níveis. A mesma pessoa não aprova dois níveis do mesmo título.</Callout>}

      {dados.regras.length > 0 && (
        <div className="fin-alcadas-tabela">
          <table>
            <thead><tr><th>Alçada</th><th>Vale para</th><th className="num">A partir de</th><th className="num">Até</th><th className="num">Nível</th><th>Quem aprova</th><th>Situação</th>{dados.podeEditar && <th aria-label="Ações" />}</tr></thead>
            <tbody>
              {dados.regras.map((r) => (
                <tr key={r.id} className={r.active ? undefined : "inativa"}>
                  <td>{r.name}</td>
                  <td>{DIRECAO[r.direction ?? ""]}</td>
                  <td className="num">{money(r.min_amount)}</td>
                  <td className="num">{r.max_amount == null ? "sem limite" : money(r.max_amount)}</td>
                  <td className="num">{r.approval_level}</td>
                  <td>{quemDe(r)}</td>
                  <td><Status tone={r.active ? "success" : "neutral"}>{r.active ? "Ativa" : "Desligada"}</Status></td>
                  {dados.podeEditar && <td><Button type="button" variant="secondary" compact onClick={() => editar(r)}>Editar</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dados.podeEditar && !form && <div><Button type="button" onClick={() => setForm({ ...VAZIO })}>Nova alçada</Button></div>}
      {!dados.podeEditar && <p className="fin-alcadas-nota">Cadastrar e mudar alçadas é de quem opera a Homologação do Financeiro.</p>}

      {form && (
        <form className="fin-alcadas-form" onSubmit={salvar}>
          <label className="largo"><span>Nome *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="Ex.: Pagamentos acima de R$ 50 mil" autoFocus /></label>
          <label><span>Vale para</span>
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="payable">Contas a pagar</option><option value="receivable">Contas a receber</option><option value="">Pagar e receber</option>
            </select>
          </label>
          <label><span>A partir de (R$)</span><input inputMode="decimal" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="0,00" /></label>
          <label><span>Até (R$) · vazio = sem limite</span><input inputMode="decimal" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="sem limite" /></label>
          <label><span>Nível</span><input inputMode="numeric" value={form.nivel} onChange={(e) => setForm({ ...form, nivel: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></label>
          <label className="largo"><span>Quem aprova este nível</span>
            <select value={form.quem} onChange={(e) => setForm({ ...form, quem: e.target.value })}>
              <option value="">Qualquer pessoa que aprova contas</option>
              <optgroup label="Pessoa">{dados.pessoas.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.nome}</option>)}</optgroup>
              <optgroup label="Papel">{dados.papeis.map((p) => <option key={p.id} value={`r:${p.id}`}>{p.name}</option>)}</optgroup>
            </select>
          </label>
          <label><span>Situação</span>
            <select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}><option value="1">Ativa</option><option value="0">Desligada</option></select>
          </label>
          <footer>
            <Button type="button" variant="secondary" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? "Gravando…" : "Gravar alçada"}</Button>
          </footer>
        </form>
      )}
    </div>
  );
}
