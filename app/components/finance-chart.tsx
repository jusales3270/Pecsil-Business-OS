"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal, Status } from "../../packages/design-system";
import {
  MANAGEMENT_TYPES,
  MAX_DEPTH,
  buildTree,
  checkMove,
  codeDepth,
  filterTree,
  nextCode,
  validateCode,
  type ChartAccount,
  type ChartNode,
  type ManagementType,
} from "../../lib/finance/plano-contas-core";

/**
 * Plano de contas do Financeiro.
 *
 * Os códigos são os que a equipe usa (carga de 30/09/2026) e mandam na ordem
 * da tela. Arrastar uma conta para outro grupo dá a ela o próximo código
 * livre daquela classe; nenhuma outra conta muda de código.
 */

type Janela =
  | { tipo: "nova"; pai: ChartNode | null }
  | { tipo: "editar"; conta: ChartNode }
  | { tipo: "excluir"; conta: ChartNode }
  | { tipo: "mover"; conta: ChartNode; destino: ChartNode | null; novoCodigo: string }
  | { tipo: "escolher-destino"; conta: ChartNode };

const TONE: Record<ManagementType, "success" | "attention" | "danger" | "info" | "neutral"> = {
  receita: "success",
  despesa_variavel: "attention",
  despesa_fixa: "attention",
  custo_variavel: "info",
  custo_fixo: "info",
  investimento: "neutral",
  repasse: "neutral",
};

const buscar = () =>
  fetch("/api/finance/plano-de-contas", { cache: "no-store" })
    .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
    .catch(() => ({ ok: false, body: { error: "Falha ao carregar o plano de contas." } }));

async function enviar(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, error: res.ok ? undefined : data.error === "FORBIDDEN" ? "Sem permissão para alterar o plano de contas." : data.error || "Não foi possível concluir.", data };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor.", data: {} };
  }
}

function Icone({ nome }: { nome: "seta" | "mais" | "editar" | "mover" | "excluir" | "arrastar" | "busca" }) {
  const paths: Record<string, React.ReactNode> = {
    seta: <path d="m9 18 6-6-6-6" />,
    mais: <path d="M12 5v14M5 12h14" />,
    editar: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    mover: <><path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></>,
    excluir: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    arrastar: <><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>,
    busca: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[nome]}</svg>;
}

export function FinanceChart({ notify }: { notify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [inativas, setInativas] = useState(false);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [janela, setJanela] = useState<Janela | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<{ id: string | "raiz"; texto: string; ok: boolean } | null>(null);

  const aplicar = useCallback((ok: boolean, body: { error?: string; accounts?: ChartAccount[]; canEdit?: boolean }, primeira = false) => {
    if (ok) {
      const lista = body.accounts ?? [];
      // Na primeira carga, grupos principais abertos e subgrupos fechados.
      if (primeira) setFechados(new Set(lista.filter((a) => a.parentId && lista.some((c) => c.parentId === a.id)).map((a) => a.id)));
      setAccounts(lista);
      setCanEdit(Boolean(body.canEdit));
      setErro("");
    } else {
      setErro(body.error === "FORBIDDEN" ? "Sem permissão para ver o plano de contas." : body.error || "Falha ao carregar o plano de contas.");
    }
    setLoading(false);
  }, []);

  const recarregar = useCallback(async () => {
    const { ok, body } = await buscar();
    aplicar(ok, body);
  }, [aplicar]);

  useEffect(() => {
    let ativo = true;
    buscar().then(({ ok, body }) => {
      if (ativo) aplicar(ok, body, true);
    });
    return () => {
      ativo = false;
    };
  }, [aplicar]);

  const arvore = useMemo(() => buildTree(accounts), [accounts]);
  const porId = useMemo(() => {
    const mapa = new Map<string, ChartNode>();
    const andar = (lista: ChartNode[]) => lista.forEach((n) => { mapa.set(n.id, n); andar(n.children); });
    andar(arvore);
    return mapa;
  }, [arvore]);
  const visivel = useMemo(() => filterTree(arvore, busca, inativas), [arvore, busca, inativas]);
  const buscando = busca.trim().length > 0;

  // Buscando, tudo que casa fica aberto.
  const aberto = (node: ChartNode) => buscando || !fechados.has(node.id);
  const alternar = (id: string) => setFechados((atual) => {
    const novo = new Set(atual);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });
  const recolherTudo = () => setFechados(new Set(accounts.filter((a) => accounts.some((c) => c.parentId === a.id)).map((a) => a.id)));
  const expandirTudo = () => setFechados(new Set());

  /** Onde a conta cai ao ser solta sobre `alvo`: dentro do grupo; sobre conta sem subcontas, no grupo dela. */
  const destinoDe = (alvo: ChartNode): ChartNode | null =>
    alvo.children.length || alvo.depth === 1 ? alvo : alvo.parentId ? porId.get(alvo.parentId) ?? null : null;

  const avaliar = (alvo: ChartNode | null) => {
    const conta = arrastando ? porId.get(arrastando) : undefined;
    if (!conta) return null;
    const destino = alvo ? destinoDe(alvo) : null;
    return { conta, destino, resultado: checkMove(conta, destino, accounts) };
  };

  const aoPassar = (event: React.DragEvent, alvo: ChartNode | null) => {
    const avaliacao = avaliar(alvo);
    if (!avaliacao) return;
    const { destino, resultado } = avaliacao;
    if (resultado.ok) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
    const id = alvo ? alvo.id : "raiz";
    const texto = resultado.ok
      ? `Solte para mover: vira ${resultado.newCode}${destino ? ` em ${destino.name}` : " (raiz)"}`
      : resultado.reason;
    if (sobre?.id !== id || sobre.texto !== texto) setSobre({ id, texto, ok: resultado.ok });
  };

  const aoSoltar = (event: React.DragEvent, alvo: ChartNode | null) => {
    event.preventDefault();
    const avaliacao = avaliar(alvo);
    setArrastando(null);
    setSobre(null);
    if (!avaliacao || !avaliacao.resultado.ok) return;
    setJanela({ tipo: "mover", conta: avaliacao.conta, destino: avaliacao.destino, novoCodigo: avaliacao.resultado.newCode });
  };

  const linha = (node: ChartNode): React.ReactNode => {
    const grupo = node.children.length > 0;
    const classe = [
      "plano-row",
      `nivel-${node.depth}`,
      grupo ? "grupo" : "",
      node.active ? "" : "inativa",
      arrastando === node.id ? "arrastando" : "",
      sobre?.id === node.id ? (sobre.ok ? "alvo" : "alvo-invalido") : "",
    ].filter(Boolean).join(" ");
    return (
      <li key={node.id}>
        <div
          className={classe}
          draggable={canEdit}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.id);
            // Depois do dragstart: mexer na tela durante o evento faz o Chrome cancelar o arrasto.
            setTimeout(() => setArrastando(node.id), 0);
          }}
          onDragEnd={() => { setArrastando(null); setSobre(null); }}
          onDragOver={(event) => aoPassar(event, node)}
          onDrop={(event) => aoSoltar(event, node)}
        >
          {canEdit && <span className="plano-grip" title="Segure e arraste para mover a conta"><Icone nome="arrastar" /></span>}
          {grupo ? (
            <button type="button" className={`plano-toggle ${aberto(node) ? "aberto" : ""}`} onClick={() => alternar(node.id)} aria-label={aberto(node) ? `Recolher ${node.name}` : `Expandir ${node.name}`} aria-expanded={aberto(node)}>
              <Icone nome="seta" />
            </button>
          ) : <span className="plano-toggle vazio" />}
          <span className="plano-code">{node.code ?? "sem código"}</span>
          <span className="plano-name">
            {node.name}
            {grupo && <small>{node.children.length} {node.children.length === 1 ? "subconta" : "subcontas"}</small>}
          </span>
          <Status tone={TONE[node.managementType]}>{MANAGEMENT_TYPES[node.managementType]}</Status>
          {!node.active && <Status tone="neutral">Inativa</Status>}
          {sobre?.id === node.id && <span className={`plano-preview ${sobre.ok ? "" : "invalido"}`}>{sobre.texto}</span>}
          {canEdit && (
            <span className="plano-actions">
              {node.code && codeDepth(node.code) < MAX_DEPTH && (
                <button type="button" title="Nova subconta" aria-label={`Nova subconta em ${node.name}`} onClick={() => setJanela({ tipo: "nova", pai: node })}><Icone nome="mais" /></button>
              )}
              <button type="button" title="Editar" aria-label={`Editar ${node.name}`} onClick={() => setJanela({ tipo: "editar", conta: node })}><Icone nome="editar" /></button>
              <button type="button" title="Mover para…" aria-label={`Mover ${node.name}`} onClick={() => setJanela({ tipo: "escolher-destino", conta: node })}><Icone nome="mover" /></button>
              <button type="button" className="perigo" title="Excluir" aria-label={`Excluir ${node.name}`} onClick={() => setJanela({ tipo: "excluir", conta: node })}><Icone nome="excluir" /></button>
            </span>
          )}
        </div>
        {grupo && aberto(node) && <ul>{node.children.map(linha)}</ul>}
      </li>
    );
  };

  const total = accounts.length;
  const lancaveis = accounts.filter((a) => a.allowsPosting && a.active).length;

  return (
    <>
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">FINANCEIRO · CLASSIFICAÇÃO</p>
          <h1>Plano de contas</h1>
          <p>{loading ? "Carregando…" : `${total} contas · ${lancaveis} recebem lançamento. Os códigos são os que a equipe já usa.`}</p>
        </div>
        {canEdit && <Button onClick={() => setJanela({ tipo: "nova", pai: null })}><Icone nome="mais" /> Nova conta</Button>}
      </div>

      <div className="plano-toolbar">
        <label className="plano-search"><Icone nome="busca" /><input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por código ou nome…" aria-label="Buscar conta" /></label>
        <label className="plano-check"><input type="checkbox" checked={inativas} onChange={(event) => setInativas(event.target.checked)} /> Mostrar inativas</label>
        <span className="plano-toolbar-fim">
          <Button variant="secondary" compact onClick={expandirTudo}>Expandir tudo</Button>
          <Button variant="secondary" compact onClick={recolherTudo}>Recolher tudo</Button>
        </span>
      </div>

      {canEdit && <p className="plano-dica">Para realocar, segure uma conta e arraste até o grupo onde ela cabe: ela assume o próximo código daquele grupo. As outras contas não mudam de código.</p>}

      <div className="plano-card">
        {erro ? <div className="finance-empty"><b>{erro}</b></div>
          : loading ? <div className="finance-empty"><small>Carregando o plano de contas…</small></div>
          : !visivel.length ? <div className="finance-empty"><b>Nenhuma conta encontrada</b><small>Ajuste a busca ou mostre as inativas.</small></div>
          : <>
            {arrastando && (
              <div
                className={`plano-raiz ${sobre?.id === "raiz" ? (sobre.ok ? "alvo" : "alvo-invalido") : ""}`}
                onDragOver={(event) => aoPassar(event, null)}
                onDrop={(event) => aoSoltar(event, null)}
              >
                {sobre?.id === "raiz" ? sobre.texto : "Solte aqui para levar a conta à raiz (grupo principal)"}
              </div>
            )}
            <ul className="plano-tree" onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSobre(null); }}>
              {visivel.map(linha)}
            </ul>
          </>}
      </div>

      {janela?.tipo === "nova" && <ContaForm contas={accounts} pai={janela.pai} onClose={() => setJanela(null)} onSalvo={async (msg) => { setJanela(null); notify(msg); await recarregar(); }} />}
      {janela?.tipo === "editar" && <ContaForm contas={accounts} conta={janela.conta} pai={janela.conta.parentId ? porId.get(janela.conta.parentId) ?? null : null} onClose={() => setJanela(null)} onSalvo={async (msg) => { setJanela(null); notify(msg); await recarregar(); }} />}
      {janela?.tipo === "excluir" && <ExcluirConta conta={janela.conta} onClose={() => setJanela(null)} onFeito={async (msg) => { setJanela(null); notify(msg); await recarregar(); }} />}
      {janela?.tipo === "mover" && <ConfirmarMover conta={janela.conta} destino={janela.destino} novoCodigo={janela.novoCodigo} onClose={() => setJanela(null)} onFeito={async (msg) => { setJanela(null); notify(msg); await recarregar(); }} />}
      {janela?.tipo === "escolher-destino" && (
        <EscolherDestino
          conta={janela.conta}
          arvore={arvore}
          contas={accounts}
          onClose={() => setJanela(null)}
          onEscolher={(destino, novoCodigo) => setJanela({ tipo: "mover", conta: janela.conta, destino, novoCodigo })}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
   Nova conta / editar
   ------------------------------------------------------------------------- */

function ContaForm({ contas, conta, pai, onClose, onSalvo }: {
  contas: ChartAccount[];
  conta?: ChartNode;
  pai: ChartNode | null;
  onClose: () => void;
  onSalvo: (mensagem: string) => Promise<void>;
}) {
  const sugestao = useMemo(() => {
    if (conta) return conta.code ?? "";
    const irmaos = contas.filter((a) => a.parentId === (pai?.id ?? null)).map((a) => a.code);
    return nextCode(pai?.code ?? null, irmaos, new Set(contas.map((a) => a.code).filter((c): c is string => !!c)));
  }, [conta, contas, pai]);
  const [nome, setNome] = useState(conta?.name ?? "");
  const [codigo, setCodigo] = useState(sugestao);
  const [tipo, setTipo] = useState<ManagementType>(conta?.managementType ?? pai?.managementType ?? "despesa_variavel");
  const [ativa, setAtiva] = useState(conta?.active ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const temFilhos = (conta?.children.length ?? 0) > 0;
  // Conta sem código (veio assim do sistema antigo) pode continuar sem: o código entra quando for movida.
  const semCodigo = Boolean(conta && !conta.code && !codigo.trim());

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nome.trim()) { setErro("Informe o nome da conta."); return; }
    if (!semCodigo) {
      const invalido = validateCode(codigo, pai?.code ?? null);
      if (invalido) { setErro(invalido); return; }
    }
    setSalvando(true);
    const resposta = conta
      ? await enviar(`/api/finance/plano-de-contas/${conta.id}`, "PATCH", { name: nome, managementType: tipo, active: ativa, ...(semCodigo || temFilhos ? {} : { code: codigo }) })
      : await enviar("/api/finance/plano-de-contas", "POST", { name: nome, parentId: pai?.id ?? null, code: codigo, managementType: tipo });
    setSalvando(false);
    if (!resposta.ok) { setErro(resposta.error ?? "Não foi possível salvar."); return; }
    await onSalvo(conta ? `Conta ${codigo || ""} ${nome.trim()} atualizada.` : `Conta ${codigo} ${nome.trim()} criada.`);
  };

  return (
    <Modal eyebrow="Plano de contas" title={conta ? "Editar conta" : "Nova conta"} subtitle={pai ? `Em ${pai.code} · ${pai.name}` : "Na raiz (grupo principal)"} onClose={onClose}>
      <form className="plano-form" onSubmit={salvar}>
        <label><span>Código</span>
          <input value={codigo} onChange={(event) => setCodigo(event.target.value)} disabled={temFilhos} placeholder={conta && !conta.code ? "sem código" : ""} inputMode="decimal" />
          <small>{temFilhos ? "Conta com subcontas: para trocar de classe, arraste-a para o grupo de destino." : pai ? `Precisa começar com ${pai.code}. (classe do grupo). Sugerido: o próximo livre.` : "Grupo principal: um trecho só (ex.: 10)."}</small>
        </label>
        <label><span>Nome *</span><input value={nome} onChange={(event) => setNome(event.target.value)} autoFocus /></label>
        <label><span>Tipo</span>
          <select value={tipo} onChange={(event) => setTipo(event.target.value as ManagementType)}>
            {Object.entries(MANAGEMENT_TYPES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </select>
          <small>Usado na análise de custo e margem.</small>
        </label>
        {conta && <label className="plano-check"><input type="checkbox" checked={ativa} onChange={(event) => setAtiva(event.target.checked)} /> Conta ativa (inativa não aparece para novos lançamentos)</label>}
        {erro && <p className="plano-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : conta ? "Salvar alterações" : "Criar conta"}</Button>
        </footer>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
   Excluir
   ------------------------------------------------------------------------- */

function ExcluirConta({ conta, onClose, onFeito }: { conta: ChartNode; onClose: () => void; onFeito: (mensagem: string) => Promise<void> }) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const rotulo = `${conta.code ?? "(sem código)"} ${conta.name}`;
  const excluir = async () => {
    setOcupado(true);
    const resposta = await enviar(`/api/finance/plano-de-contas/${conta.id}`, "DELETE");
    setOcupado(false);
    if (!resposta.ok) { setErro(resposta.error ?? "Não foi possível excluir."); return; }
    await onFeito(`Conta ${rotulo} excluída.`);
  };
  const inativar = async () => {
    setOcupado(true);
    const resposta = await enviar(`/api/finance/plano-de-contas/${conta.id}`, "PATCH", { active: false });
    setOcupado(false);
    if (!resposta.ok) { setErro(resposta.error ?? "Não foi possível inativar."); return; }
    await onFeito(`Conta ${rotulo} inativada.`);
  };
  return (
    <Modal eyebrow="Plano de contas" title="Excluir conta" subtitle={rotulo} onClose={onClose}>
      <div className="plano-form">
        <p>Esta conta sai do plano de contas. Conta com subcontas ou já usada em algum título não pode ser excluída — nesse caso, inative.</p>
        {erro && <p className="plano-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          {erro && conta.active && <Button type="button" variant="secondary" onClick={inativar} disabled={ocupado}>Inativar</Button>}
          <Button type="button" className="perigo" onClick={excluir} disabled={ocupado}>{ocupado ? "Excluindo…" : "Excluir conta"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
   Mover: confirmação (depois de arrastar ou de escolher o destino)
   ------------------------------------------------------------------------- */

function ConfirmarMover({ conta, destino, novoCodigo, onClose, onFeito }: {
  conta: ChartNode;
  destino: ChartNode | null;
  novoCodigo: string;
  onClose: () => void;
  onFeito: (mensagem: string) => Promise<void>;
}) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const mover = async () => {
    setOcupado(true);
    const resposta = await enviar(`/api/finance/plano-de-contas/${conta.id}/mover`, "POST", { parentId: destino?.id ?? null });
    setOcupado(false);
    if (!resposta.ok) { setErro(resposta.error ?? "Não foi possível mover."); return; }
    await onFeito(`${conta.name} movida: agora é ${String(resposta.data.code ?? novoCodigo)}.`);
  };
  const mudaTipo = destino && destino.managementType !== conta.managementType;
  return (
    <Modal eyebrow="Plano de contas" title="Mover conta" subtitle={conta.name} onClose={onClose}>
      <div className="plano-form">
        <dl className="plano-mover">
          <div><dt>De</dt><dd><b>{conta.code ?? "sem código"}</b></dd></div>
          <div><dt>Para</dt><dd><b>{novoCodigo}</b> · {destino ? `${destino.code} ${destino.name}` : "raiz (grupo principal)"}</dd></div>
        </dl>
        {conta.children.length > 0 && <p>{conta.children.length === 1 ? "A subconta acompanha e recebe" : `As ${conta.children.length} subcontas acompanham e recebem`} o novo código.</p>}
        {mudaTipo && <p>O tipo passa de {MANAGEMENT_TYPES[conta.managementType]} para <b>{MANAGEMENT_TYPES[destino.managementType]}</b>, o do grupo de destino.</p>}
        <p>Nenhuma outra conta muda de código. Os títulos já lançados nesta conta continuam nela.</p>
        {erro && <p className="plano-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={mover} disabled={ocupado}>{ocupado ? "Movendo…" : "Mover conta"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

/** Sem mouse (celular, teclado): escolher o grupo de destino numa lista. */
function EscolherDestino({ conta, arvore, contas, onClose, onEscolher }: {
  conta: ChartNode;
  arvore: ChartNode[];
  contas: ChartAccount[];
  onClose: () => void;
  onEscolher: (destino: ChartNode | null, novoCodigo: string) => void;
}) {
  const opcoes = useMemo(() => {
    const lista: { destino: ChartNode | null; rotulo: string; codigo: string }[] = [];
    const raiz = checkMove(conta, null, contas);
    if (raiz.ok) lista.push({ destino: null, rotulo: "Raiz (grupo principal)", codigo: raiz.newCode });
    const andar = (nodes: ChartNode[]) => nodes.forEach((node) => {
      const resultado = checkMove(conta, node, contas);
      if (resultado.ok) lista.push({ destino: node, rotulo: `${"— ".repeat(node.depth - 1)}${node.code} ${node.name}`, codigo: resultado.newCode });
      andar(node.children);
    });
    andar(arvore);
    return lista;
  }, [conta, arvore, contas]);
  const [indice, setIndice] = useState(0);
  const escolhida = opcoes[indice];
  return (
    <Modal eyebrow="Plano de contas" title="Mover para…" subtitle={`${conta.code ?? "sem código"} ${conta.name}`} onClose={onClose}>
      <div className="plano-form">
        {opcoes.length ? <>
          <label><span>Grupo de destino</span>
            <select value={indice} onChange={(event) => setIndice(Number(event.target.value))}>
              {opcoes.map((opcao, i) => <option key={opcao.destino?.id ?? "raiz"} value={i}>{opcao.rotulo}</option>)}
            </select>
            <small>A conta vira <b>{escolhida.codigo}</b>, o próximo código livre desse grupo.</small>
          </label>
          <footer>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={() => onEscolher(escolhida.destino, escolhida.codigo)}>Continuar</Button>
          </footer>
        </> : <p>Não há grupo para onde esta conta possa ir (o plano tem no máximo {MAX_DEPTH} níveis).</p>}
      </div>
    </Modal>
  );
}
