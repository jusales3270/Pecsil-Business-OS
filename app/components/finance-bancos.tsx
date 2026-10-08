"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Modal, Segmented, Status } from "../../packages/design-system";
import type { FinanceBankAccount } from "../../lib/data/finance";
import { EnviarArquivo } from "./enviar-arquivo";

/**
 * Bancos e conciliação. O extrato importado do banco é conferido contra o Financeiro:
 *   Conciliar   → liga o lançamento a baixas que já existem (ou dá baixa numa parcela em aberto);
 *   Criar conta → o que não tem conta no Financeiro (tarifa, tributo, folha…) vira conta já baixada;
 *   Ignorar     → movimento que não pede conta (transferência entre contas etc.);
 *   Desfazer    → tira o vínculo e o lançamento volta para "A conciliar".
 * As sugestões são só locais (valor, data e nome); nada é conciliado sem o clique da pessoa.
 */

type Situacao = "pendente" | "conciliado" | "ignorado" | "todos";
type Lancamento = {
  id: string; conta: string; data: string; valor: number; descricao: string; categoria: string | null; categoriaRotulo: string | null;
  contraparte: string | null; situacao: "pending" | "partial" | "matched" | "ignored";
  ligacoes: { valor: number; data: string | null; fornecedor: string | null; descricao: string | null }[];
};
type Resumo = { bank_account_id: string; entries: number; pending: number; partial: number; matched: number; ignored: number; first_date: string | null; last_date: string | null };
type Dados = {
  lancamentos: Lancamento[]; total: number; pagina: number; tamanho: number; resumo: Resumo[];
  categorias: { codigo: string; rotulo: string }[];
  plano: { id: string; code: string; name: string; type: string; allowsPosting: boolean }[];
  podeOperar: boolean; podePagar: boolean; podeReceber: boolean;
};
type Baixa = { id: string; data: string; valor: number; fornecedor: string | null; descricao: string | null; documento: string | null; sugerida: boolean };
type Parcela = { id: string; numero: number; vencimento: string; saldo: number; fornecedor: string | null; descricao: string | null; documento: string | null; previsao: boolean; historico: boolean; valorIgual: boolean };

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

/** Conta do plano que costuma servir a cada categoria (só uma sugestão; a pessoa escolhe). */
const CONTA_SUGERIDA: Record<string, string> = { tarifa_bancaria: "02.01.014", folha: "02.01.008" };

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch { return { ok: false, error: "Sem conexão com o servidor." }; }
}

export function FinanceBancos({ accounts, onChanged }: { accounts: FinanceBankAccount[]; onChanged: (mensagem: string) => Promise<void> | void }) {
  const [situacao, setSituacao] = useState<Situacao>("pendente");
  const [categoria, setCategoria] = useState("");
  const [sentido, setSentido] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [conciliar, setConciliar] = useState<Lancamento | null>(null);
  const [criar, setCriar] = useState<Lancamento[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [busca]);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams({ situacao, pagina: String(pagina) });
    if (categoria) q.set("categoria", categoria);
    if (sentido) q.set("sentido", sentido);
    if (de) q.set("de", de);
    if (ate) q.set("ate", ate);
    if (buscaAplicada) q.set("q", buscaAplicada);
    const res = await api<Dados>(`/api/finance/bancos?${q}`);
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setDados(res.data);
  }, [situacao, pagina, categoria, sentido, de, ate, buscaAplicada]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const totais = useMemo(() => {
    const soma = { pendente: 0, conciliado: 0, ignorado: 0, todos: 0 };
    for (const r of dados?.resumo ?? []) {
      soma.pendente += Number(r.pending) + Number(r.partial);
      soma.conciliado += Number(r.matched);
      soma.ignorado += Number(r.ignored);
      soma.todos += Number(r.entries);
    }
    return soma;
  }, [dados]);

  const depois = async (mensagem: string) => { setMarcados(new Set()); await carregar(); await onChanged(mensagem); };
  const acao = async (l: Lancamento, corpo: Record<string, unknown>, ok: string) => {
    setOcupado(l.id);
    const res = await api<unknown>("/api/finance/bancos/acoes", { method: "POST", body: JSON.stringify({ entryId: l.id, ...corpo }) });
    setOcupado(null);
    if (!res.ok) { await onChanged(res.error); return; }
    await depois(ok);
  };

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.tamanho)) : 1;
  const selecionaveis = (dados?.lancamentos ?? []).filter((l) => l.situacao === "pending" || l.situacao === "partial");
  const escolhidos = (dados?.lancamentos ?? []).filter((l) => marcados.has(l.id));
  const alternar = (id: string) => setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const podeCriar = (l: Lancamento) => !!dados && dados.podeOperar && (l.valor < 0 ? dados.podePagar : dados.podeReceber);

  if (erro && !dados) return <div className="finance-empty almox-vazio"><b>{erro}</b></div>;

  return (
    <div className="banco-modulo">
      {dados?.podeOperar && (
        <div className="banco-topo">
          <EnviarArquivo<PreviaExtrato>
            rotulo="Enviar extrato"
            titulo="Enviar extrato bancário"
            descricao="OFX de qualquer banco, planilha (.xlsx) do Santander ou PDF do Itaú. A plataforma identifica o banco e a conta, confere os saldos e mostra o que vai conciliar antes de gravar."
            aceita=".ofx,.xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            endpoint="/api/finance/bancos/extrato"
            renderPrevia={(p) => <PreviaExtratoView p={p} />}
            podeConfirmar={(p) => p.saldo.confere && p.novos > 0}
            textoConfirmar="Gravar e conciliar"
            onConcluido={depois}
          />
        </div>
      )}
      {accounts.length ? (
        <div className="banco-contas">
          {accounts.map((c) => (
            <article key={c.id} className="banco-conta">
              <header><b>{c.name}</b><Status tone={c.active ? "success" : "neutral"}>{c.active ? "Ativa" : "Inativa"}</Status></header>
              <small>Agência {c.branch} · Conta {c.accountNumber}</small>
              <strong>{money(c.balance)}</strong>
              <span>Saldo pelo extrato{c.lastEntryDate ? ` até ${date(c.lastEntryDate)}` : ""}</span>
              <span>{plural(c.entries, "lançamento", "lançamentos")} · {c.pending ? <b className="alerta">{c.pending} a conciliar</b> : "tudo conciliado"}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="finance-empty almox-vazio"><b>Nenhuma conta bancária cadastrada</b><small>A conta entra junto com a carga do extrato do banco.</small></div>
      )}

      <Callout variant="info" title="Como a conciliação funciona">
        Cada linha do extrato precisa ter uma correspondência no Financeiro. Conciliar liga o lançamento a pagamentos já registrados (ou dá baixa numa parcela em aberto); Criar conta registra o que ainda não existe, como tarifas, tributos e folha; Ignorar serve para o que não pede conta. As sugestões usam só valor, data e nome, e nada é ligado sem você confirmar.
      </Callout>

      {totais.pendente > 0 && (
        <Callout variant="warning" title="Conciliação pendente">
          {plural(totais.pendente, "lançamento do extrato ainda não tem correspondência no Financeiro", "lançamentos do extrato ainda não têm correspondência no Financeiro")}.
        </Callout>
      )}

      <div className="almox-filtros">
        <Segmented<Situacao>
          options={[
            { value: "pendente", label: `A conciliar · ${totais.pendente.toLocaleString("pt-BR")}` },
            { value: "conciliado", label: `Conciliados · ${totais.conciliado.toLocaleString("pt-BR")}` },
            { value: "ignorado", label: `Ignorados · ${totais.ignorado.toLocaleString("pt-BR")}` },
            { value: "todos", label: `Todos · ${totais.todos.toLocaleString("pt-BR")}` },
          ]}
          value={situacao} onChange={(v) => { setSituacao(v); setPagina(1); setMarcados(new Set()); }} ariaLabel="Situação"
        />
      </div>
      <div className="banco-filtros">
        <select value={categoria} onChange={(e) => { setCategoria(e.target.value); setPagina(1); }} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {(dados?.categorias ?? []).map((c) => <option key={c.codigo} value={c.codigo}>{c.rotulo}</option>)}
        </select>
        <select value={sentido} onChange={(e) => { setSentido(e.target.value); setPagina(1); }} aria-label="Entradas ou saídas">
          <option value="">Entradas e saídas</option>
          <option value="credit">Só entradas</option>
          <option value="debit">Só saídas</option>
        </select>
        <label className="banco-data"><span>De</span><input type="date" value={de} onChange={(e) => { setDe(e.target.value); setPagina(1); }} /></label>
        <label className="banco-data"><span>Até</span><input type="date" value={ate} onChange={(e) => { setAte(e.target.value); setPagina(1); }} /></label>
        <input className="almox-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Descrição ou nome" aria-label="Buscar" />
      </div>

      {escolhidos.length > 0 && dados?.podeOperar && (
        <div className="banco-selecao" role="status">
          <span><b>{plural(escolhidos.length, "lançamento", "lançamentos")}</b> · {money(escolhidos.reduce((s, l) => s + l.valor, 0))}</span>
          <Button compact onClick={() => setCriar(escolhidos)} disabled={!escolhidos.every(podeCriar) || new Set(escolhidos.map((l) => l.valor < 0)).size > 1}>Criar contas para os marcados</Button>
          <Button variant="ghost" compact onClick={() => setMarcados(new Set())}>Limpar</Button>
        </div>
      )}

      {!dados && <div className="finance-empty almox-vazio"><small>Carregando o extrato…</small></div>}
      {dados && !dados.lancamentos.length && <div className="finance-empty almox-vazio"><b>{situacao === "pendente" ? "Nada a conciliar" : "Nada neste filtro"}</b><small>{situacao === "pendente" ? "Todos os lançamentos importados já têm correspondência." : "Troque o filtro ou a busca."}</small></div>}

      {dados && dados.lancamentos.length > 0 && (
        <div className="banco-lista" role="table">
          <div className="cabeca" role="row">
            <span>{dados.podeOperar && selecionaveis.length > 0 && <input type="checkbox" aria-label="Marcar todos desta página" checked={selecionaveis.every((l) => marcados.has(l.id))} onChange={(e) => setMarcados(e.target.checked ? new Set(selecionaveis.map((l) => l.id)) : new Set())} />}</span>
            <span>Data</span><span>Lançamento</span><span className="r">Valor</span><span>Situação</span><span>Ações</span>
          </div>
          {dados.lancamentos.map((l) => {
            const aberto = l.situacao === "pending" || l.situacao === "partial";
            return (
              <div role="row" key={l.id} className={marcados.has(l.id) ? "marcado" : ""}>
                <span>{dados.podeOperar && aberto && <input type="checkbox" aria-label={`Marcar ${l.descricao}`} checked={marcados.has(l.id)} onChange={() => alternar(l.id)} />}</span>
                <span>{date(l.data)}</span>
                <span className="desc">
                  <b title={l.descricao}>{l.contraparte ?? l.descricao}</b>
                  <small title={l.descricao}>{l.contraparte ? l.descricao : ""}{l.categoriaRotulo ? <i className="banco-chip">{l.categoriaRotulo}</i> : null}</small>
                  {l.ligacoes.length > 0 && <small className="banco-ligado">Ligado a: {l.ligacoes.slice(0, 2).map((x) => `${x.fornecedor ?? "baixa"} ${money(x.valor)}`).join(" · ")}{l.ligacoes.length > 2 ? ` e mais ${l.ligacoes.length - 2}` : ""}</small>}
                </span>
                <span className={`r banco-valor ${l.valor < 0 ? "neg" : "pos"}`}>{money(l.valor)}</span>
                <span>
                  {l.situacao === "matched" && <Status tone="success">Conciliado</Status>}
                  {l.situacao === "partial" && <Status tone="attention">Parcial</Status>}
                  {l.situacao === "pending" && <Status tone="info">A conciliar</Status>}
                  {l.situacao === "ignored" && <Status tone="neutral">Ignorado</Status>}
                </span>
                <span className="acoes">
                  {dados.podeOperar && aberto && <Button variant="secondary" compact disabled={ocupado === l.id} onClick={() => setConciliar(l)}>Conciliar</Button>}
                  {aberto && podeCriar(l) && <Button variant="secondary" compact disabled={ocupado === l.id} onClick={() => setCriar([l])}>Criar conta</Button>}
                  {dados.podeOperar && l.situacao === "pending" && <Button variant="ghost" compact disabled={ocupado === l.id} onClick={() => void acao(l, { acao: "ignorar" }, "Lançamento ignorado.")}>Ignorar</Button>}
                  {dados.podeOperar && l.situacao === "ignored" && <Button variant="ghost" compact disabled={ocupado === l.id} onClick={() => void acao(l, { acao: "reativar" }, "Lançamento voltou para A conciliar.")}>Reativar</Button>}
                  {dados.podeOperar && (l.situacao === "matched" || l.situacao === "partial") && <Button variant="ghost" compact className="almox-perigo" disabled={ocupado === l.id} onClick={() => void acao(l, { acao: "desfazer" }, "Conciliação desfeita.")}>Desfazer</Button>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {dados && dados.total > dados.tamanho && (
        <div className="banco-paginacao">
          <Button variant="secondary" compact disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
          <span>Página {pagina} de {paginas} · {plural(dados.total, "lançamento", "lançamentos")}</span>
          <Button variant="secondary" compact disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
        </div>
      )}

      {conciliar && <ConciliarModal lancamento={conciliar} onClose={() => setConciliar(null)} onFeito={async (m) => { setConciliar(null); await depois(m); }} />}
      {criar && dados && <CriarModal lancamentos={criar} plano={dados.plano} onClose={() => setCriar(null)} onFeito={async (m) => { setCriar(null); await depois(m); }} />}
    </div>
  );
}

function ConciliarModal({ lancamento, onClose, onFeito }: { lancamento: Lancamento; onClose: () => void; onFeito: (m: string) => Promise<void> }) {
  const [cand, setCand] = useState<{ baixas: Baixa[]; parcelas: Parcela[] } | null>(null);
  const [erro, setErro] = useState("");
  const [baixas, setBaixas] = useState<Set<string>>(new Set());
  const [parcela, setParcela] = useState<string>("");
  const [salvando, setSalvando] = useState(false);
  const saida = lancamento.valor < 0;
  const valor = Math.abs(lancamento.valor);

  useEffect(() => {
    let vivo = true;
    void api<{ baixas: Baixa[]; parcelas: Parcela[] }>(`/api/finance/bancos/${lancamento.id}/sugestoes`).then((res) => {
      if (!vivo) return;
      if (res.ok) setCand(res.data); else setErro(res.error);
    });
    return () => { vivo = false; };
  }, [lancamento.id]);

  const soma = useMemo(() => (cand?.baixas ?? []).filter((b) => baixas.has(b.id)).reduce((s, b) => s + b.valor, 0), [cand, baixas]);
  const confere = baixas.size > 0 && Math.abs(soma - valor) < 0.005;
  const alternar = (id: string) => { setParcela(""); setBaixas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const confirmar = async () => {
    setErro(""); setSalvando(true);
    const corpo = parcela
      ? { acao: "baixar", entryId: lancamento.id, installmentId: parcela }
      : { acao: "conciliar", entryId: lancamento.id, settlementIds: [...baixas] };
    const res = await api<unknown>("/api/finance/bancos/acoes", { method: "POST", body: JSON.stringify(corpo) });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    await onFeito(parcela ? "Baixa feita a partir do extrato e conciliada." : "Lançamento conciliado.");
  };

  return (
    <Modal eyebrow="Bancos e conciliação" title={`Conciliar ${money(lancamento.valor)}`} subtitle={`${date(lancamento.data)} · ${lancamento.contraparte ?? lancamento.descricao}`} onClose={onClose}>
      <div className="almox-form">
        {!cand && !erro && <small>Procurando correspondências…</small>}
        {cand && (
          <>
            <section className="banco-cand">
              <h3>{saida ? "Pagamentos já registrados" : "Recebimentos já registrados"} <small>sem conta bancária, até 3 dias de diferença</small></h3>
              {!cand.baixas.length && <p className="banco-nada">Nenhuma baixa encontrada nessa janela.</p>}
              {cand.baixas.map((b) => (
                <label key={b.id} className={`banco-opcao ${baixas.has(b.id) ? "on" : ""}`}>
                  <input type="checkbox" checked={baixas.has(b.id)} onChange={() => alternar(b.id)} />
                  <span><b>{b.fornecedor ?? "—"}</b>{b.sugerida && <Status tone="success">Sugerida</Status>}<small>{date(b.data)} · {b.descricao ?? ""}{b.documento ? ` · ${b.documento}` : ""}</small></span>
                  <strong>{money(b.valor)}</strong>
                </label>
              ))}
              {baixas.size > 0 && (
                <p className={`banco-soma ${confere ? "ok" : "falta"}`}>
                  Marcadas: {money(soma)} de {money(valor)} {confere ? "— fecha" : soma > valor ? "— passa do valor do lançamento" : `— faltam ${money(valor - soma)} (ficará parcial)`}
                </p>
              )}
            </section>
            <section className="banco-cand">
              <h3>{saida ? "Ou dar baixa numa parcela em aberto" : "Ou receber uma parcela em aberto"} <small>com o valor deste lançamento</small></h3>
              {!cand.parcelas.length && <p className="banco-nada">Nenhuma parcela em aberto com valor parecido.</p>}
              {cand.parcelas.map((p) => (
                <label key={p.id} className={`banco-opcao ${parcela === p.id ? "on" : ""}`}>
                  <input type="radio" name="parcela" checked={parcela === p.id} onChange={() => { setBaixas(new Set()); setParcela(p.id); }} />
                  <span><b>{p.fornecedor ?? "—"}</b>{p.valorIgual && <Status tone="success">Valor igual</Status>}{p.previsao && <Status tone="neutral">Previsão</Status>}{p.historico && <Status tone="attention">Histórico</Status>}<small>vence {date(p.vencimento)} · parcela {p.numero} · {p.descricao ?? ""}{p.documento ? ` · ${p.documento}` : ""}</small></span>
                  <strong>{money(p.saldo)}</strong>
                </label>
              ))}
            </section>
          </>
        )}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={salvando || (!parcela && baixas.size === 0)}>{salvando ? "Gravando…" : parcela ? "Dar baixa e conciliar" : "Conciliar"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

function CriarModal({ lancamentos, plano, onClose, onFeito }: { lancamentos: Lancamento[]; plano: Dados["plano"]; onClose: () => void; onFeito: (m: string) => Promise<void> }) {
  const saida = lancamentos[0].valor < 0;
  const lancaveis = plano.filter((a) => a.allowsPosting && (saida ? a.type !== "revenue" : a.type === "revenue" || a.type === "asset"));
  const sugerida = (() => {
    const cats = new Set(lancamentos.map((l) => l.categoria ?? ""));
    if (cats.size !== 1) return "";
    const [c] = [...cats];
    if (c === "tarifa_bancaria" && lancamentos.every((l) => /^IOF/i.test(l.descricao))) return "02.01.004";
    return CONTA_SUGERIDA[c] ?? "";
  })();
  const [contaId, setContaId] = useState(() => plano.find((a) => a.code === sugerida && a.allowsPosting)?.id ?? "");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);

  const confirmar = async () => {
    if (!contaId) { setErro("Escolha a conta do plano."); return; }
    setErro(""); setSalvando(true);
    const res = await api<{ created: number; skipped: number }>("/api/finance/bancos/acoes", { method: "POST", body: JSON.stringify({ acao: "criar", entryIds: lancamentos.map((l) => l.id), chartAccountId: contaId, descricao: descricao.trim() }) });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    await onFeito(`${plural(res.data.created, "conta criada", "contas criadas")} a partir do extrato${res.data.skipped ? ` (${res.data.skipped} já estavam conciliadas)` : ""}.`);
  };

  return (
    <Modal eyebrow="Bancos e conciliação" title={lancamentos.length === 1 ? "Criar conta a partir do extrato" : `Criar ${lancamentos.length} contas a partir do extrato`} subtitle={`${plural(lancamentos.length, "lançamento", "lançamentos")} · ${money(total)}`} onClose={onClose}>
      <div className="almox-form">
        <p>{saida ? "Cada lançamento vira uma conta a pagar já paga" : "Cada lançamento vira uma conta a receber já recebida"}, na data do extrato, e fica conciliado. Use para o que ainda não tem conta no Financeiro.</p>
        <div className="almox-campos">
          <label className="almox-largo"><span>Conta do plano *</span>
            <select value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">Escolha a conta</option>
              {lancaveis.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </label>
          <label className="almox-largo"><span>Descrição (vazio usa o texto do banco)</span><input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} placeholder={lancamentos[0].descricao} /></label>
        </div>
        {lancamentos.length > 1 && (
          <div className="banco-resumo-criar">
            {lancamentos.slice(0, 6).map((l) => <span key={l.id}>{date(l.data)} · {l.contraparte ?? l.descricao} <b>{money(l.valor)}</b></span>)}
            {lancamentos.length > 6 && <span>e mais {lancamentos.length - 6}…</span>}
          </div>
        )}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={salvando}>{salvando ? "Gravando…" : "Criar e conciliar"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

type PreviaExtrato = {
  banco: string; formato: "ofx" | "planilha" | "pdf";
  conta: { agencia: string; numero: string; digito: string | null; existe: boolean };
  periodo: { inicio: string | null; fim: string | null };
  lancamentos: number; entradas: number; saidas: number;
  saldo: { confere: boolean; diasConferidos: number; divergentes: { data: string; banco: number; calculado: number }[]; final: number; informado: number | null };
  novos: number; jaImportados: number;
  conciliacao: { conciliados: number; nivel1: number; nivel2: number; nivel3: number; valor: number };
  ignorados: number; paraRevisar: number;
  categorias: { rotulo: string; quantidade: number; entradas: number; saidas: number }[];
  envioAnterior: { quando: string; nome: string; quem: string | null } | null;
};

const FORMATO: Record<PreviaExtrato["formato"], string> = { ofx: "OFX", planilha: "planilha", pdf: "PDF" };

function PreviaExtratoView({ p }: { p: PreviaExtrato }) {
  return (
    <>
      <div className="arq-cabeca">
        <b>{p.banco} · ag. {p.conta.agencia} · conta {p.conta.numero}{p.conta.digito ? `-${p.conta.digito}` : ""}</b>
        <small>{FORMATO[p.formato]} · {date(p.periodo.inicio)} a {date(p.periodo.fim)} · {plural(p.lancamentos, "lançamento", "lançamentos")}</small>
        {!p.conta.existe && <Status tone="info">Conta nova: será cadastrada</Status>}
      </div>
      {p.envioAnterior && <Callout variant="warning" title="Este arquivo já foi enviado">Em {new Date(p.envioAnterior.quando).toLocaleString("pt-BR")}{p.envioAnterior.quem ? ` por ${p.envioAnterior.quem}` : ""}. O que já está na plataforma não é gravado de novo.</Callout>}
      {p.saldo.confere ? (
        <Callout variant="success" title="Saldos conferidos">
          {p.saldo.diasConferidos} saldos do dia batem com os lançamentos. Saldo final {money(p.saldo.final)}{p.saldo.informado !== null && Math.abs(p.saldo.informado - p.saldo.final) > 0.004 ? ` (o banco informa ${money(p.saldo.informado)})` : ""}.
        </Callout>
      ) : (
        <Callout variant="warning" title="Os saldos não fecham — nada será gravado">
          {p.saldo.divergentes.map((d) => `${date(d.data)}: banco ${money(d.banco)}, calculado ${money(d.calculado)}`).join(" · ") || "O saldo corrido da planilha não confere."}
        </Callout>
      )}
      <div className="arq-numeros">
        <div><small>Novos</small><b>{p.novos.toLocaleString("pt-BR")}</b><span>{p.jaImportados ? `${p.jaImportados.toLocaleString("pt-BR")} já estavam na plataforma` : "nenhum repetido"}</span></div>
        <div><small>Conciliados na hora</small><b>{p.conciliacao.conciliados.toLocaleString("pt-BR")}</b><span>{money(p.conciliacao.valor)}</span></div>
        <div><small>Sem conta (transferências etc.)</small><b>{p.ignorados.toLocaleString("pt-BR")}</b><span>entram como ignorados</span></div>
        <div><small>Para revisar</small><b className={p.paraRevisar ? "alerta" : ""}>{p.paraRevisar.toLocaleString("pt-BR")}</b><span>vão para A conciliar</span></div>
      </div>
      {p.categorias.length > 0 && (
        <div className="arq-tabela" role="table">
          <div className="cabeca" role="row"><span>Categoria</span><span className="r">Qtde.</span><span className="r">Entradas</span><span className="r">Saídas</span></div>
          {p.categorias.map((c) => (
            <div role="row" key={c.rotulo}><span>{c.rotulo}</span><span className="r">{c.quantidade}</span><span className="r">{c.entradas ? money(c.entradas) : "—"}</span><span className="r">{c.saidas ? money(c.saidas) : "—"}</span></div>
          ))}
        </div>
      )}
      {p.novos === 0 && <p className="banco-nada">Nada novo neste arquivo: todos os lançamentos já estão na plataforma.</p>}
    </>
  );
}
