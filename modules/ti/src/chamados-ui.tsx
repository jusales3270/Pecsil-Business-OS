"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Modal, Status } from "../../../packages/design-system";
import {
  type Andamento, type Ativo, type Chamado, type Prioridade, type Regras,
  EM_ABERTO, PRIORIDADE, PRIORIDADES, SITUACAO_CHAMADO, chamarTi, dataHora, duracao, prazoTexto, useAgora,
} from "./tipos";

/**
 * Chamados de TI: abrir, listar e acompanhar. Os mesmos componentes servem à fila da TI
 * (módulo TI › Chamados) e a qualquer pessoa da empresa (menu da conta › Chamados de TI).
 */

export function NovoChamado({ regras, onClose, onCriado }: { regras: Regras; onClose: () => void; onCriado: (numero: number) => void }) {
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("normal");
  const [local, setLocal] = useState("");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setErro("");
    if (titulo.trim().length < 3) return setErro("Escreva em poucas palavras o que aconteceu.");
    if (!categoria) return setErro("Escolha a categoria.");
    if (descricao.trim().length < 3) return setErro("Descreva o problema.");
    setEnviando(true);
    const r = await chamarTi<{ numero: number }>("/api/ti/chamados", { method: "POST", body: JSON.stringify({ titulo, categoria, prioridade, local, descricao }) });
    setEnviando(false);
    if (!r.ok) return setErro(r.error);
    onCriado(r.data.numero);
  };

  return (
    <Modal eyebrow="TI · novo chamado" title="Chamar a TI" subtitle="A TI é avisada na hora. Você acompanha as respostas aqui e no sino." onClose={onClose}>
      <div className="almox-form ti-form">
        <label><span>O que aconteceu</span><input value={titulo} maxLength={140} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: impressora do Compras não imprime" autoFocus /></label>
        <div className="almox-campos">
          <label className="ti-campo-2"><span>Categoria</span>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Escolha…</option>
              {regras.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="ti-campo-2"><span>Onde (setor ou máquina)</span><input value={local} maxLength={120} onChange={(e) => setLocal(e.target.value)} placeholder="Ex.: Compras, PC da Bia" /></label>
        </div>
        <fieldset className="ti-prioridades">
          <legend className="almox-rotulo">Prioridade</legend>
          {PRIORIDADES.map((p) => (
            <label key={p} className={`ti-prioridade${prioridade === p ? " on" : ""}`}>
              <input type="radio" name="prioridade" value={p} checked={prioridade === p} onChange={() => setPrioridade(p)} />
              <b>{PRIORIDADE[p].label}</b><small>até {regras.prazos_h[p]} h</small>
            </label>
          ))}
        </fieldset>
        <label><span>Descrição</span><textarea rows={5} maxLength={4000} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="O que você tentou, desde quando, alguma mensagem de erro…" /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void enviar()} disabled={enviando} aria-busy={enviando}>{enviando ? "Enviando…" : "Abrir chamado"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

export function TabelaChamados({ chamados, onAbrir, mostrarSolicitante }: { chamados: Chamado[]; onAbrir: (c: Chamado) => void; mostrarSolicitante: boolean }) {
  const agora = useAgora();
  return (
    <div className={`vnd-tabela ti-chamados${mostrarSolicitante ? "" : " ti-chamados-meus"}`} role="table" aria-label="Chamados de TI">
      <div className="cabeca" role="row">
        <span>Nº</span><span>Chamado</span>{mostrarSolicitante && <span>Quem abriu</span>}<span>Prioridade</span><span>Situação</span><span>Prazo</span><span>Com</span>
      </div>
      {chamados.map((c) => {
        const prazo = prazoTexto(c, agora);
        return (
          <button type="button" role="row" key={c.id} onClick={() => onAbrir(c)}>
            <span>#{c.numero}</span>
            <span className="nome">{c.titulo}<small>{c.categoria}{c.local ? ` · ${c.local}` : ""} · {dataHora(c.created_at)}</small></span>
            {mostrarSolicitante && <span>{c.solicitante_nome}</span>}
            <span><Status tone={PRIORIDADE[c.prioridade].tone}>{PRIORIDADE[c.prioridade].label}</Status></span>
            <span><Status tone={SITUACAO_CHAMADO[c.situacao].tone}>{SITUACAO_CHAMADO[c.situacao].label}</Status></span>
            <span className={`ti-prazo ${prazo.tone}`}>{prazo.texto}</span>
            <span>{c.responsavel_nome ?? "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

const ROTULO_ANDAMENTO: Record<string, string> = { abertura: "abriu o chamado", comentario: "escreveu", atribuicao: "", situacao: "", reclassificacao: "reclassificou" };

export function DetalheChamado({ id, eu, podeAtender, regras, ativos, onClose, onMudou }: {
  id: string; eu: string | null; podeAtender: boolean; regras: Regras | null; ativos?: Ativo[];
  onClose: () => void; onMudou: (mensagem: string) => void;
}) {
  const [dados, setDados] = useState<{ chamado: Chamado; andamentos: Andamento[] } | null>(null);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [classe, setClasse] = useState<{ prioridade: Prioridade; categoria: string; ativoId: string } | null>(null);
  const agora = useAgora();

  const carregar = useCallback(async () => {
    const r = await chamarTi<{ chamado: Chamado; andamentos: Andamento[] }>(`/api/ti/chamados/${id}`);
    if (!r.ok) { setErro(r.error); return; }
    setDados(r.data);
    setClasse({ prioridade: r.data.chamado.prioridade, categoria: r.data.chamado.categoria, ativoId: r.data.chamado.ativo_id ?? "" });
  }, [id]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const agir = async (acao: string, mensagem: string, extra?: Record<string, unknown>) => {
    setErro("");
    setEnviando(true);
    const r = await chamarTi(`/api/ti/chamados/${id}`, { method: "POST", body: JSON.stringify({ acao, texto, extra }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    setTexto("");
    onMudou(mensagem);
    await carregar();
  };

  const c = dados?.chamado;
  const aberto = c ? EM_ABERTO.includes(c.situacao) : false;
  const dono = Boolean(c && eu && c.solicitante_id === eu);
  const atende = podeAtender;
  const podeReabrir = c?.situacao === "resolvido" && (atende || (dono && c.resolvido_em && agora - Date.parse(c.resolvido_em) < 7 * 86_400_000));
  const prazo = c ? prazoTexto(c, agora) : null;

  return (
    <Modal eyebrow={c ? `Chamado #${c.numero} · ${c.categoria}` : "Chamado"} title={c?.titulo ?? "Carregando…"}
      subtitle={c ? `Aberto por ${c.solicitante_nome} em ${dataHora(c.created_at)}${c.local ? ` · ${c.local}` : ""}` : undefined} onClose={onClose}>
      {!c ? (erro ? <p className="almox-erro">{erro}</p> : <p className="ds-detail-empty">Carregando…</p>) : (
        <div className="almox-detalhe ti-chamado">
          <div className="ti-chamado-selos">
            <Status tone={SITUACAO_CHAMADO[c.situacao].tone}>{SITUACAO_CHAMADO[c.situacao].label}</Status>
            <Status tone={PRIORIDADE[c.prioridade].tone}>Prioridade {PRIORIDADE[c.prioridade].label.toLowerCase()}</Status>
            {prazo && <span className={`ti-prazo ${prazo.tone}`}>{c.situacao === "resolvido" ? `Resolvido ${prazo.texto}` : prazo.texto}</span>}
            {c.responsavel_nome && <span className="ti-quem">Com {c.responsavel_nome}</span>}
            {c.ti_ativos && <span className="ti-quem">Equipamento #{c.ti_ativos.numero} · {c.ti_ativos.nome}</span>}
          </div>

          <ol className="ti-linha-tempo">
            {(dados?.andamentos ?? []).map((a) => (
              <li key={a.id} className={`ti-andamento ${a.tipo}${a.autor_id && a.autor_id === c.solicitante_id ? " dono" : ""}`}>
                <header><b>{a.autor_nome}</b>{ROTULO_ANDAMENTO[a.tipo] ? <span> {ROTULO_ANDAMENTO[a.tipo]}</span> : null}<time>{dataHora(a.created_at)}</time></header>
                <p>{a.texto}</p>
              </li>
            ))}
          </ol>
          {c.primeira_resposta_em && <p className="ti-nota">Primeira resposta da TI em {duracao((Date.parse(c.primeira_resposta_em) - Date.parse(c.created_at)) / 1000)}.</p>}

          {(aberto || podeReabrir) && (
            <div className="almox-form ti-form">
              <label><span>{aberto ? (atende ? "Mensagem, solução ou o que falta" : "Mensagem para a TI") : "Por que o problema continua"}</span>
                <textarea rows={3} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </label>
              {erro && <p className="almox-erro" role="alert">{erro}</p>}
              <div className="ti-acoes">
                {aberto && <Button onClick={() => void agir("comentar", `Mensagem enviada no chamado #${c.numero}.`)} disabled={enviando || !texto.trim()}>Enviar mensagem</Button>}
                {aberto && atende && c.responsavel_id !== eu && <Button variant="secondary" onClick={() => void agir("assumir", `Você assumiu o chamado #${c.numero}.`)} disabled={enviando}>Assumir</Button>}
                {aberto && atende && <Button variant="secondary" onClick={() => void agir("aguardar", `Chamado #${c.numero} aguardando.`)} disabled={enviando || !texto.trim()} title="Use o texto para dizer o que falta">Aguardando…</Button>}
                {aberto && atende && <Button variant="secondary" onClick={() => void agir("resolver", `Chamado #${c.numero} resolvido.`)} disabled={enviando || !texto.trim()} title="Use o texto para descrever a solução">Resolver</Button>}
                {podeReabrir && <Button onClick={() => void agir("reabrir", `Chamado #${c.numero} reaberto.`)} disabled={enviando || !texto.trim()}>Reabrir</Button>}
                {aberto && (atende || (dono && c.situacao === "aberto")) && (
                  <Button variant="ghost" className="almox-perigo" onClick={() => void agir("cancelar", `Chamado #${c.numero} cancelado.`)} disabled={enviando || !texto.trim()} title="Use o texto para dizer o motivo">Cancelar chamado</Button>
                )}
              </div>
            </div>
          )}

          {aberto && atende && classe && regras && (
            <div className="almox-bloco-interno ti-reclassificar">
              <p className="almox-rotulo">Classificação (a TI ajusta; o prazo é recalculado desde a abertura)</p>
              <div className="almox-campos">
                <label><span>Prioridade</span>
                  <select value={classe.prioridade} onChange={(e) => setClasse({ ...classe, prioridade: e.target.value as Prioridade })}>
                    {PRIORIDADES.map((p) => <option key={p} value={p}>{PRIORIDADE[p].label} (até {regras.prazos_h[p]} h)</option>)}
                  </select>
                </label>
                <label><span>Categoria</span>
                  <select value={classe.categoria} onChange={(e) => setClasse({ ...classe, categoria: e.target.value })}>
                    {[...new Set([c.categoria, ...regras.categorias])].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label className="ti-campo-2"><span>Equipamento</span>
                  <select value={classe.ativoId} onChange={(e) => setClasse({ ...classe, ativoId: e.target.value })}>
                    <option value="">Nenhum</option>
                    {(ativos ?? []).filter((a) => a.situacao !== "baixado" || a.id === classe.ativoId).map((a) => <option key={a.id} value={a.id}>#{a.numero} · {a.nome}</option>)}
                  </select>
                </label>
              </div>
              <div className="ti-acoes">
                <Button variant="secondary" compact disabled={enviando || (classe.prioridade === c.prioridade && classe.categoria === c.categoria && classe.ativoId === (c.ativo_id ?? ""))}
                  onClick={() => void agir("reclassificar", `Chamado #${c.numero} reclassificado.`, { prioridade: classe.prioridade, categoria: classe.categoria, ativo_id: classe.ativoId || null })}>
                  Salvar classificação
                </Button>
              </div>
            </div>
          )}
          <footer><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
        </div>
      )}
    </Modal>
  );
}
