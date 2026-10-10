"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Segmented, Status, SugestaoModelo } from "../../packages/design-system";

/**
 * Fundação › Sugestões da IA (PLANO-JEV, Etapa 0, com o Clef).
 *
 * - Fila de conferência: o que o modelo sugeriu, em azul e com a confiança; a pessoa
 *   aceita, recusa ou corrige. É assim que se mede a taxa de acerto de cada uso.
 * - Painel de uso (só o proprietário): liga/desliga cada uso, modelo, limites, consumo.
 * - Testar o modelo (só o proprietário): uma pergunta livre pelo mesmo caminho dos usos.
 */

type Resposta =
  | { type: "noul"; valor: number; confianca: number }
  | { type: "choice"; escolha: string; confianca: number; probabilidades: Record<string, number> }
  | { type: "score"; nota: number; nivel: string | null; confianca: number };

type Item = {
  id: string; use_code: string; entity_type: string | null; entity_id: string | null; state_summary: string;
  questions: Record<string, { instructions?: string }>; answers: Record<string, Resposta>;
  confidence: number | null; band: "alta" | "media" | "baixa" | null; model: string | null; latency_ms: number | null;
  outcome: string; error_detail: string | null; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
};
type Acerto = Record<string, { aceitas: number; recusadas: number; corrigidas: number; pendentes: number; taxa: number | null }>;
type Uso = {
  code: string; label: string; moduleCode: string; enabled: boolean; model: "clef-flash" | "clef"; limitHigh: number; limitLow: number;
  consultas: number; bloqueadas: number; erros: number; pendentes: number; aceitas: number; recusadas: number; corrigidas: number;
  latenciaMedia: number | null; porDia: Record<string, number>;
};

type Filtro = "pendente" | "decididas" | "problemas" | "todas";
const FILTROS: { value: Filtro; label: string }[] = [
  { value: "pendente", label: "A conferir" },
  { value: "decididas", label: "Decididas" },
  { value: "problemas", label: "Bloqueios e erros" },
  { value: "todas", label: "Todas" },
];
const SITUACAO: Record<string, [string, "info" | "success" | "danger" | "attention" | "neutral"]> = {
  pendente: ["A conferir", "attention"], aceita: ["Aceita", "success"], recusada: ["Recusada", "danger"],
  corrigida: ["Corrigida", "neutral"], ignorada: ["Ignorada", "neutral"], bloqueada: ["Bloqueada pelo filtro", "neutral"], erro: ["Serviço indisponível", "danger"],
};
const FAIXA: Record<string, string> = { alta: "confiança alta", media: "confiança média", baixa: "confiança baixa" };
const pct = (v: number | null | undefined) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "—");
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const modeloNome = (m: string | null) => (m === "clef" ? "Clef" : m === "clef-flash" ? "Clef" : m ?? "modelo");

function textoResposta(r: Resposta): string {
  if (r.type === "noul") return `${r.valor >= 0.8 ? "Sim" : r.valor <= 0.2 ? "Não" : "Incerto"} · ${pct(r.valor)}`;
  if (r.type === "choice") return r.escolha;
  return `${r.nota.toFixed(2)}${r.nivel ? ` · ${r.nivel}` : ""}`;
}

async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

export function SugestoesIaView({ notify }: { notify: (msg: string) => void }) {
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [uso, setUso] = useState("");
  const [dados, setDados] = useState<{ items: Item[]; acerto: Acerto; canDecide: boolean; isOwner: boolean } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState<{ id: string; nota: string } | null>(null);

  const carregar = useCallback(async () => {
    const situacao = filtro === "pendente" ? "pendente" : "todas";
    const res = await chamar<{ items: Item[]; acerto: Acerto; canDecide: boolean; isOwner: boolean }>(`/api/sugestoes?situacao=${situacao}${uso ? `&uso=${encodeURIComponent(uso)}` : ""}`);
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setDados(res.data);
  }, [filtro, uso]);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const visiveis = useMemo(() => (dados?.items ?? []).filter((i) =>
    filtro === "decididas" ? ["aceita", "recusada", "corrigida", "ignorada"].includes(i.outcome)
      : filtro === "problemas" ? ["bloqueada", "erro"].includes(i.outcome) : true), [dados, filtro]);
  const usosNaFila = useMemo(() => [...new Set(Object.keys(dados?.acerto ?? {}).concat((dados?.items ?? []).map((i) => i.use_code)))].sort(), [dados]);

  const decidir = async (id: string, decisao: "aceita" | "recusada" | "corrigida", nota?: string) => {
    setOcupado(id);
    const res = await chamar(`/api/sugestoes/${id}/decidir`, { method: "POST", body: JSON.stringify({ decisao, nota }) });
    setOcupado(null);
    if (!res.ok) { notify(res.error); return; }
    setCorrigindo(null);
    notify(decisao === "aceita" ? "Sugestão aceita." : decisao === "recusada" ? "Sugestão recusada." : "Correção registrada.");
    await carregar();
  };

  return (
    <div className="sug-ia">
      <div className="page-head">
        <div>
          <p className="eyebrow">FUNDAÇÃO · SUGESTÕES DA IA</p>
          <h1>Sugestões da IA</h1>
          <p>O que o modelo de decisão (Clef) sugeriu. Ele só sugere: cada sugestão aparece em azul, com a confiança, e vale depois que alguém confere. As decisões medem o acerto de cada uso.</p>
        </div>
      </div>

      {dados?.isOwner && <PainelProprietario notify={notify} aoMudar={carregar} />}

      <Card className="md-card">
        <div className="md-toolbar sug-filtros">
          <Segmented<Filtro> options={FILTROS} value={filtro} onChange={setFiltro} ariaLabel="Situação das sugestões" />
          <label className="sug-uso"><span>Uso</span>
            <select value={uso} onChange={(e) => setUso(e.target.value)} aria-label="Uso">
              <option value="">Todos os usos</option>
              {usosNaFila.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>
        {dados && Object.keys(dados.acerto).length > 0 && (
          <div className="sug-acerto">
            {Object.entries(dados.acerto).map(([codigo, a]) => (
              <span key={codigo}><b>{codigo}</b> acerto {a.taxa === null ? "—" : pct(a.taxa)} <small>({a.aceitas} aceitas · {a.recusadas} recusadas · {a.corrigidas} corrigidas · {a.pendentes} a conferir, 90 dias)</small></span>
            ))}
          </div>
        )}
        {erro && <p className="user-admin-error">{erro}</p>}
        {!dados && !erro && <p className="sug-vazio">Carregando…</p>}
        {dados && !visiveis.length && (
          <div className="user-admin-empty"><b>{filtro === "pendente" ? "Nada a conferir" : "Nenhuma sugestão neste filtro"}</b><small>Quando um uso da IA estiver ligado, as sugestões aparecem aqui para conferência.</small></div>
        )}
        <div className="sug-lista">
          {visiveis.map((i) => {
            const pergunta = Object.values(i.questions ?? {}).map((q) => q.instructions).filter(Boolean).join(" · ");
            const respostas = Object.values(i.answers ?? {});
            const [rotulo, tom] = SITUACAO[i.outcome] ?? [i.outcome, "neutral"];
            const podeDecidir = dados?.canDecide && i.outcome === "pendente";
            return (
              <article key={i.id} className="sug-item">
                <header>
                  <span><b>{i.use_code}</b><small>{quando(i.created_at)}{i.entity_type ? ` · ${i.entity_type} ${i.entity_id ?? ""}` : ""}{i.latency_ms ? ` · ${i.latency_ms} ms` : ""}</small></span>
                  <Status tone={tom}>{rotulo}</Status>
                </header>
                <p className="sug-estado">{i.state_summary}</p>
                {respostas.length > 0 && (
                  <SugestaoModelo
                    modelo={modeloNome(i.model)}
                    confianca={i.confidence}
                    resposta={respostas.map(textoResposta).join(" · ")}
                    pergunta={pergunta}
                    detalhe={i.band ? <small className="sug-faixa">{FAIXA[i.band]}</small> : null}
                    onAceitar={podeDecidir ? () => void decidir(i.id, "aceita") : undefined}
                    onRecusar={podeDecidir ? () => void decidir(i.id, "recusada") : undefined}
                    ocupado={ocupado === i.id}
                  />
                )}
                {i.outcome === "bloqueada" && <p className="sug-nota">Nada foi enviado ao modelo: o filtro encontrou {i.error_detail}.</p>}
                {i.outcome === "erro" && <p className="sug-nota">{i.error_detail}</p>}
                {i.decided_at && <p className="sug-nota">{rotulo} por {i.decided_by_name ?? "—"} em {quando(i.decided_at)}{i.decision_note ? ` · ${i.decision_note}` : ""}</p>}
                {podeDecidir && (corrigindo?.id === i.id ? (
                  <form className="sug-corrigir" onSubmit={(e) => { e.preventDefault(); void decidir(i.id, "corrigida", corrigindo.nota); }}>
                    <input value={corrigindo.nota} onChange={(e) => setCorrigindo({ id: i.id, nota: e.target.value })} placeholder="Qual é a resposta certa?" aria-label="Resposta certa" autoFocus />
                    <Button type="submit" compact disabled={ocupado === i.id}>Registrar correção</Button>
                    <Button type="button" variant="ghost" compact onClick={() => setCorrigindo(null)}>Cancelar</Button>
                  </form>
                ) : (
                  <button type="button" className="sug-link" onClick={() => setCorrigindo({ id: i.id, nota: "" })}>Corrigir</button>
                ))}
              </article>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function PainelProprietario({ notify, aoMudar }: { notify: (msg: string) => void; aoMudar: () => Promise<void> }) {
  const [painel, setPainel] = useState<{ configurado: boolean; usos: Uso[] } | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const res = await chamar<{ configurado: boolean; usos: Uso[] }>("/api/sugestoes/usos");
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setPainel(res.data);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const alterar = async (code: string, mudanca: Partial<Pick<Uso, "enabled" | "model" | "limitHigh" | "limitLow">>) => {
    const res = await chamar("/api/sugestoes/usos", { method: "PATCH", body: JSON.stringify({ code, ...mudanca }) });
    if (!res.ok) { notify(res.error); return; }
    notify("Uso atualizado.");
    await carregar();
  };

  return (
    <>
      {painel && !painel.configurado && (
        <Callout variant="warning" title="Clef não configurado neste servidor">Faltam as variáveis CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN. Cadastre no Coolify e faça o deploy; até lá nenhuma consulta é feita.</Callout>
      )}
      <Card className="md-card">
        <div className="sug-painel-topo"><div><p className="eyebrow">SÓ O PROPRIETÁRIO</p><h2>Painel de uso</h2><p>Cada uso nasce desligado. Ligue só depois da simulação conferida (PLANO-JEV). Números dos últimos 30 dias.</p></div></div>
        {erro && <p className="user-admin-error">{erro}</p>}
        {!painel && !erro && <p className="sug-vazio">Carregando…</p>}
        {painel && (
          <div className="sug-tabela" role="table" aria-label="Usos da IA">
            <div className="cabeca" role="row"><span>Uso</span><span>Ligado</span><span>Modelo</span><span>Limites (baixo · alto)</span><span>Consultas</span><span>Acerto</span><span>Tempo médio</span><span>Bloqueios · erros</span></div>
            {painel.usos.map((u) => {
              const decididas = u.aceitas + u.recusadas + u.corrigidas;
              return (
                <div role="row" key={u.code}>
                  <span><b>{u.label}</b><small>{u.code}</small></span>
                  <span><label className="sug-toggle"><input type="checkbox" checked={u.enabled} onChange={(e) => void alterar(u.code, { enabled: e.target.checked })} aria-label={`Ligar ${u.label}`} /> {u.enabled ? "Ligado" : "Desligado"}</label></span>
                  <span><select value={u.model} onChange={(e) => void alterar(u.code, { model: e.target.value as Uso["model"] })} aria-label={`Modelo de ${u.label}`}><option value="clef-flash">Clef Flash</option><option value="clef">Clef</option></select></span>
                  <span className="sug-limites">
                    <input type="number" step="0.05" min="0" max="1" defaultValue={u.limitLow} aria-label={`Limite baixo de ${u.label}`} onBlur={(e) => Number(e.target.value) !== Number(u.limitLow) && void alterar(u.code, { limitLow: Number(e.target.value) })} />
                    <input type="number" step="0.05" min="0" max="1" defaultValue={u.limitHigh} aria-label={`Limite alto de ${u.label}`} onBlur={(e) => Number(e.target.value) !== Number(u.limitHigh) && void alterar(u.code, { limitHigh: Number(e.target.value) })} />
                  </span>
                  <span>{u.consultas}<small>{Object.keys(u.porDia ?? {}).length} dia(s) com uso</small></span>
                  <span>{decididas ? pct(u.aceitas / decididas) : "—"}<small>{decididas} decididas · {u.pendentes} a conferir</small></span>
                  <span>{u.latenciaMedia ? `${u.latenciaMedia} ms` : "—"}</span>
                  <span>{u.bloqueadas} · {u.erros}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <TestarModelo notify={notify} aoTestar={async () => { await Promise.all([carregar(), aoMudar()]); }} />
    </>
  );
}

function TestarModelo({ notify, aoTestar }: { notify: (msg: string) => void; aoTestar: () => Promise<void> }) {
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState<"noul" | "choice" | "score">("noul");
  const [pergunta, setPergunta] = useState("");
  const [opcoes, setOpcoes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ status: string; respostas?: Record<string, Resposta>; confianca?: number; faixa?: string; modelo?: string; ms?: number; motivos?: string[]; motivo?: string } | null>(null);

  const testar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const res = await chamar<NonNullable<typeof resultado>>("/api/sugestoes/testar", {
      method: "POST",
      body: JSON.stringify({ estado, tipo, pergunta, opcoes: opcoes.split(",").map((o) => o.trim()).filter(Boolean) }),
    });
    setEnviando(false);
    if (!res.ok) { notify(res.error); return; }
    setResultado(res.data);
    await aoTestar();
  };

  return (
    <Card className="md-card">
      <div className="sug-painel-topo"><div><p className="eyebrow">SÓ O PROPRIETÁRIO</p><h2>Testar o modelo</h2><p>Um texto curto e uma pergunta. Passa pelo filtro de dado pessoal e fica registrado na fila como uso &ldquo;fundacao.teste&rdquo;. Não use CPF, salário ou dado de saúde.</p></div></div>
      <form className="sug-teste" onSubmit={testar}>
        <label className="sug-largo"><span>Texto (o &ldquo;estado&rdquo;)</span><textarea rows={2} value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Ex.: MIRAI METALS & MINERALS LTDA | MIRAI METAIS" /></label>
        <label className="sug-largo"><span>Tipo de pergunta</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="noul">Sim ou não</option><option value="choice">Escolher uma opção</option><option value="score">Nota numa escala</option>
          </select>
        </label>
        <label className="sug-largo"><span>Pergunta</span><input value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Ex.: Os dois nomes são a mesma empresa?" /></label>
        {tipo !== "noul" && <label className="sug-largo"><span>{tipo === "choice" ? "Opções (separadas por vírgula)" : "Níveis, do menor para o maior (separados por vírgula)"}</span><input value={opcoes} onChange={(e) => setOpcoes(e.target.value)} placeholder={tipo === "choice" ? "financeiro, rh, compras" : "baixa, média, alta"} /></label>}
        <footer><Button type="submit" disabled={enviando || !estado.trim() || !pergunta.trim()}>{enviando ? "Perguntando…" : "Perguntar ao Clef"}</Button></footer>
      </form>
      {resultado?.status === "ok" && resultado.respostas && (
        <SugestaoModelo
          modelo={modeloNome(resultado.modelo ?? null)}
          confianca={resultado.confianca ?? null}
          resposta={Object.values(resultado.respostas).map(textoResposta).join(" · ")}
          pergunta={pergunta}
          detalhe={<small className="sug-faixa">{resultado.faixa ? FAIXA[resultado.faixa] : ""}{resultado.ms ? ` · ${resultado.ms} ms` : ""}</small>}
        />
      )}
      {resultado?.status === "bloqueado" && <Callout variant="warning" title="Bloqueado pelo filtro">Nada foi enviado ao modelo: o texto tem {resultado.motivos?.join(", ")}.</Callout>}
      {resultado?.status === "indisponivel" && <Callout variant="danger" title="Modelo indisponível">{resultado.motivo}</Callout>}
    </Card>
  );
}
