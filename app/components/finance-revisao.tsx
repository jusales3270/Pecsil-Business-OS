"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Modal, Segmented, Status } from "../../packages/design-system";
import type { FinanceChartAccount } from "../../lib/data/finance";

/**
 * Contas a pagar › Histórico a revisar. Cada cartão é um parcelamento/financiamento
 * (ou um lançamento antigo ainda "em aberto") vindo do sistema antigo:
 *   Aprovar  → a série sobe para as contas certas (em aberto vai para A pagar);
 *   Excluir  → a série sai do Financeiro, com as baixas;
 *   Editar   → corrige fornecedor, descrição, conta do plano e cada parcela.
 */

type Item = { id: string; lancamento: string; vencimento: string; valor: number; pago: boolean; pagoEm: string | null; texto: string; previsao: boolean };
type Grupo = {
  serie: string; fornecedor: string; documento: string | null; conta: string | null; contaId: string | null;
  inicio: string; parcelas: number; pagas: number; valorPago: number; abertas: number; valorAberto: number;
  primeiroVenc: string; ultimoVenc: string; proximoVenc: string | null; ativo: boolean; itens: Item[];
};
type Filtro = "todos" | "ativos" | "parados";

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const num = (t: string) => { const s = t.trim().replace(/[R$\s]/g, ""); return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s); };

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch { return { ok: false, error: "Sem conexão com o servidor." }; }
}

export function useRevisaoCount(ativo: boolean) {
  const [total, setTotal] = useState<number | null>(null);
  const recarregar = useCallback(async () => {
    const res = await api<{ grupos: Grupo[] }>("/api/finance/revisao");
    if (res.ok) setTotal(res.data.grupos.length);
  }, []);
  useEffect(() => { if (!ativo) return; const t = setTimeout(() => { void recarregar(); }, 0); return () => clearTimeout(t); }, [ativo, recarregar]);
  return { total, recarregar };
}

export function FinanceRevisao({ accounts, onChanged }: { accounts: FinanceChartAccount[]; onChanged: (mensagem: string) => Promise<void> | void }) {
  const [dados, setDados] = useState<{ grupos: Grupo[]; podeAprovar: boolean; podeEditar: boolean } | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [editar, setEditar] = useState<Grupo | null>(null);
  const [excluir, setExcluir] = useState<Grupo | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await api<{ grupos: Grupo[]; podeAprovar: boolean; podeEditar: boolean }>("/api/finance/revisao");
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setDados({ ...res.data, grupos: res.data.grupos.map((g) => ({ ...g, valorPago: Number(g.valorPago), valorAberto: Number(g.valorAberto), itens: g.itens.map((i) => ({ ...i, valor: Number(i.valor) })) })) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (dados?.grupos ?? []).filter((g) => (filtro === "todos" || (filtro === "ativos" ? g.ativo : !g.ativo))
      && (!termo || `${g.fornecedor} ${g.documento ?? ""} ${g.conta ?? ""}`.toLowerCase().includes(termo)));
  }, [dados, filtro, busca]);
  const conta = (f: Filtro) => (dados?.grupos ?? []).filter((g) => f === "todos" || (f === "ativos" ? g.ativo : !g.ativo)).length;

  const depois = async (mensagem: string) => { await carregar(); await onChanged(mensagem); };
  const aprovar = async (g: Grupo) => {
    setOcupado(g.serie);
    const res = await api<{ lancamentos: number }>("/api/finance/revisao", { method: "POST", body: JSON.stringify({ acao: "aprovar", serie: g.serie }) });
    setOcupado(null);
    if (!res.ok) { await onChanged(res.error); return; }
    await depois(`Aprovado: ${g.fornecedor} · ${res.data.lancamentos} lançamentos subiram para o Contas a pagar.`);
  };

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b></div>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando o histórico…</small></div>;

  return (
    <div className="rev-modulo">
      <Callout variant="info" title="Revise o que veio do sistema antigo">
        Cada cartão é um parcelamento ou financiamento (máquinas, empréstimos, serviços parcelados) ou um lançamento antigo que ainda aparecia em aberto. Aprovar mantém a série no Contas a pagar, e o que está em aberto vai para A pagar. Excluir tira do Financeiro. Editar corrige os dados e as parcelas. O restante do passado já pago foi arquivado e não aparece mais.
      </Callout>
      <div className="almox-filtros">
        <Segmented<Filtro> options={[{ value: "todos", label: `Todos · ${conta("todos")}` }, { value: "ativos", label: `Com parcela em 2026 · ${conta("ativos")}` }, { value: "parados", label: `Antigos em aberto · ${conta("parados")}` }]} value={filtro} onChange={setFiltro} ariaLabel="Tipo" />
        <input className="almox-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, documento ou conta" aria-label="Buscar" />
      </div>
      {!grupos.length && <div className="finance-empty almox-vazio"><b>{dados.grupos.length ? "Nada neste filtro" : "Histórico revisado"}</b><small>{dados.grupos.length ? "Troque o filtro ou a busca." : "Não há mais nada para revisar."}</small></div>}
      <div className="rev-lista">
        {grupos.map((g) => {
          const aberto = abertos.has(g.serie);
          return (
            <article key={g.serie} className="rev-cartao">
              <header>
                <div className="rev-titulo">
                  <span><b>{g.fornecedor}</b>{g.ativo ? <Status tone="info">Com parcela em 2026</Status> : <Status tone="attention">Antigo em aberto</Status>}</span>
                  <small>{g.documento || "Sem documento"}{g.conta ? ` · ${g.conta}` : ""}</small>
                </div>
                <div className="rev-acoes">
                  {dados.podeAprovar && <Button variant="ghost" compact className="almox-perigo" onClick={() => setExcluir(g)} disabled={ocupado === g.serie}>Excluir</Button>}
                  {dados.podeEditar && <Button variant="secondary" compact onClick={() => setEditar(g)} disabled={ocupado === g.serie}>Editar</Button>}
                  {dados.podeAprovar && <Button compact onClick={() => void aprovar(g)} disabled={ocupado === g.serie}>{ocupado === g.serie ? "Aprovando…" : "Aprovar"}</Button>}
                </div>
              </header>
              <div className="rev-numeros">
                <div><small>Início</small><b>{date(g.inicio)}</b><span>1º vencimento {date(g.primeiroVenc)}</span></div>
                <div><small>Pagas</small><b>{g.pagas} de {g.parcelas}</b><span>{money(g.valorPago)}</span></div>
                <div><small>Em aberto</small><b className={g.abertas ? "alerta" : ""}>{g.abertas}</b><span>{money(g.valorAberto)}</span></div>
                <div><small>Vencimentos</small><b>{g.proximoVenc ? `próximo ${date(g.proximoVenc)}` : "—"}</b><span>último {date(g.ultimoVenc)}</span></div>
              </div>
              <button type="button" className="almox-link" onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(g.serie)) n.delete(g.serie); else n.add(g.serie); return n; })}>
                {aberto ? "Esconder parcelas" : `Ver as ${g.parcelas} parcelas`}
              </button>
              {aberto && (
                <div className="rev-parcelas" role="table">
                  <div className="cabeca" role="row"><span>Vencimento</span><span>Lançamento</span><span>Histórico</span><span className="r">Valor</span><span>Situação</span></div>
                  {g.itens.map((i) => (
                    <div role="row" key={i.id}>
                      <span>{date(i.vencimento)}</span><span>{date(i.lancamento)}</span><span className="texto" title={i.texto}>{i.texto || "—"}</span>
                      <span className="r">{money(i.valor)}</span>
                      <span>{i.pago ? <Status tone="success">Paga {date(i.pagoEm)}</Status> : <Status tone={i.vencimento < "2026-01-01" ? "danger" : "info"}>Em aberto</Status>}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {editar && <EditarSerie grupo={editar} accounts={accounts} podeAprovar={dados.podeAprovar} onClose={() => setEditar(null)} onFeito={async (m) => { setEditar(null); await depois(m); }} />}
      {excluir && (
        <Modal eyebrow="Histórico a revisar" title={`Excluir ${excluir.fornecedor}?`} subtitle={excluir.documento ?? undefined} onClose={() => setExcluir(null)}>
          <div className="almox-form">
            <p>Os {excluir.parcelas} lançamentos desta série ({excluir.pagas} pagos e {excluir.abertas} em aberto) saem do Financeiro de vez, com as baixas. Use quando a série não deveria estar no sistema.</p>
            <footer>
              <Button variant="secondary" onClick={() => setExcluir(null)}>Voltar</Button>
              <Button className="almox-perigo-cheio" disabled={ocupado === excluir.serie} onClick={async () => {
                const g = excluir; setOcupado(g.serie);
                const res = await api<{ lancamentos: number }>("/api/finance/revisao", { method: "POST", body: JSON.stringify({ acao: "excluir", serie: g.serie }) });
                setOcupado(null); setExcluir(null);
                if (!res.ok) { await onChanged(res.error); return; }
                await depois(`Excluído: ${g.fornecedor} · ${res.data.lancamentos} lançamentos saíram do Financeiro.`);
              }}>Excluir de vez</Button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}

type Linha = { id: string; vencimento: string; valor: string; pago: boolean; pagoEm: string; original: Item };

function EditarSerie({ grupo, accounts, podeAprovar, onClose, onFeito }: { grupo: Grupo; accounts: FinanceChartAccount[]; podeAprovar: boolean; onClose: () => void; onFeito: (m: string) => Promise<void> }) {
  const [fornecedor, setFornecedor] = useState(grupo.fornecedor);
  const [descricao, setDescricao] = useState("");
  const [contaId, setContaId] = useState(grupo.contaId ?? "");
  const [linhas, setLinhas] = useState<Linha[]>(() => grupo.itens.map((i) => ({
    id: i.id, vencimento: i.vencimento, valor: i.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), pago: i.pago, pagoEm: i.pagoEm ?? "", original: i,
  })));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const lancaveis = accounts.filter((a) => a.allowsPosting);
  const mudar = (id: string, campo: keyof Linha, valor: string | boolean) => setLinhas((l) => l.map((x) => (x.id === id ? { ...x, [campo]: valor } : x)));

  const salvar = async (aprovar: boolean) => {
    setErro("");
    const itens = [];
    for (const l of linhas) {
      const valor = num(l.valor);
      if (!(valor > 0)) { setErro("Toda parcela precisa de valor maior que zero."); return; }
      const mudou = l.vencimento !== l.original.vencimento || Math.abs(valor - l.original.valor) > 0.004 || l.pago !== l.original.pago || (l.pago && !l.original.pago);
      if (mudou) itens.push({ id: l.id, vencimento: l.vencimento, valor, pago: l.pago, pagoEm: l.pagoEm || l.vencimento });
    }
    setSalvando(true);
    const res = await api<{ editadas: number }>("/api/finance/revisao", {
      method: "PATCH",
      body: JSON.stringify({ serie: grupo.serie, fornecedor: fornecedor.trim() !== grupo.fornecedor ? fornecedor.trim() : "", descricao: descricao.trim(), contaId: contaId !== (grupo.contaId ?? "") ? contaId : "", itens, aprovar }),
    });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    await onFeito(aprovar ? `Editado e aprovado: ${fornecedor}.` : `Editado: ${fornecedor} (${res.data.editadas} parcelas ajustadas). Continua para revisar.`);
  };

  return (
    <Modal eyebrow="Histórico a revisar · editar" title={grupo.fornecedor} subtitle={grupo.documento ?? undefined} onClose={onClose}>
      <div className="almox-form">
        <div className="almox-campos">
          <label className="almox-largo"><span>Fornecedor</span><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></label>
          <label className="almox-largo"><span>Descrição de todas as parcelas (vazio mantém a atual)</span><input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={grupo.itens[0]?.texto ?? ""} /></label>
          <label className="almox-largo"><span>Conta do plano de todas as parcelas</span>
            <select value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">{grupo.conta ? `Manter: ${grupo.conta}` : "Sem conta — escolher"}</option>
              {lancaveis.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="rev-editar" role="table">
          <div className="cabeca" role="row"><span>Vencimento</span><span>Valor</span><span>Paga</span><span>Pago em</span></div>
          {linhas.map((l) => (
            <div role="row" key={l.id}>
              <input type="date" value={l.vencimento} onChange={(e) => mudar(l.id, "vencimento", e.target.value)} disabled={l.original.pago && l.pago} aria-label="Vencimento" />
              <input value={l.valor} onChange={(e) => mudar(l.id, "valor", e.target.value)} inputMode="decimal" disabled={l.original.pago && l.pago} aria-label="Valor" />
              <label className="almox-marca"><input type="checkbox" checked={l.pago} onChange={(e) => mudar(l.id, "pago", e.target.checked)} /> <span>{l.pago ? "sim" : "não"}</span></label>
              <input type="date" value={l.pagoEm} onChange={(e) => mudar(l.id, "pagoEm", e.target.value)} disabled={!l.pago || l.original.pago} aria-label="Pago em" />
            </div>
          ))}
        </div>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="secondary" onClick={() => void salvar(false)} disabled={salvando}>Salvar</Button>
          {podeAprovar && <Button onClick={() => void salvar(true)} disabled={salvando}>{salvando ? "Gravando…" : "Salvar e aprovar"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}
