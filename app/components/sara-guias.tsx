"use client";

import { useCallback, useEffect, useState } from "react";
import { Carregando } from "../../packages/design-system";

/**
 * Guias da SARA (E3): rotinas que a própria área pede na conversa e a SARA roda sozinha (agenda,
 * acontecimento ou atalho), com a sessão de quem pediu. Aqui, dentro da janela da SARA: quem pediu vê as
 * suas (pausar, rodar agora, últimas execuções); quem responde pela área (a SARA do módulo em "aprovar")
 * vê todas, aprova ou recusa e define o que a SARA pode fazer sozinha em cada ação (o padrão é nada:
 * tudo pede Permitir).
 */

type Limite = { sozinha?: boolean; max_por_dia?: number; max_itens?: number; horario?: { de: string; ate: string } };
type Execucao = { id: string; disparo: string; situacao: string; resumo: string | null; pendentes: number; feitas: number; erro: string | null; quando: string; evento: string | null };
type Guia = {
  id: string; nome: string; descricao: string; quando: string; situacao: string; pausada: boolean; limites: Record<string, Limite>; responsavel: string | null; minha: boolean;
  passos: { ferramenta: string; para_que: string; rotulo: string }[]; acoes: { nome: string; rotulo: string }[]; formato: string | null;
  decidido_por: string | null; motivo: string | null; proxima_em: string | null; execucoes: Execucao[];
};

const SITUACAO: Record<string, string> = { proposta: "Para aprovar", ativa: "Valendo", recusada: "Recusada" };
const EXECUCAO: Record<string, string> = { na_fila: "Na fila", rodando: "Rodando", feita: "Rodou", falhou: "Falhou", sem_permissao: "Sem permissão", cancelada: "Cancelada" };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Quadro do que a SARA pode fazer sozinha nesta guia (por ação). */
function QuadroDeLimites({ acoes, limites, mudar }: { acoes: Guia["acoes"]; limites: Record<string, Limite>; mudar: (l: Record<string, Limite>) => void }) {
  if (!acoes.length) return <small className="sara-guia-nota">Esta guia só consulta: não faz nada na plataforma.</small>;
  const por = (nome: string, campo: Partial<Limite>) => mudar({ ...limites, [nome]: { ...limites[nome], ...campo } });
  const numero = (v: string) => (v.trim() === "" ? undefined : Math.max(1, Math.min(100, Math.round(Number(v)) || 1)));
  return (
    <div className="sara-guia-limites" role="group" aria-label="O que a SARA pode fazer sozinha">
      <b>O que a SARA pode fazer sozinha</b>
      <small>Sem marcar, cada ação vira um cartão para quem criou a guia permitir (vale 24 h).</small>
      {acoes.map((a) => {
        const l = limites[a.nome] ?? {};
        return (
          <div key={a.nome} className="sara-guia-limite">
            <label className="sara-guia-marca"><input type="checkbox" checked={Boolean(l.sozinha)} onChange={(e) => por(a.nome, { sozinha: e.target.checked })} /> {a.rotulo} sozinha</label>
            {l.sozinha && (
              <div className="sara-guia-campos">
                <label>Até <input type="number" min={1} max={100} inputMode="numeric" value={l.max_por_dia ?? ""} placeholder="—" onChange={(e) => por(a.nome, { max_por_dia: numero(e.target.value) })} /> por dia</label>
                <label>Até <input type="number" min={1} max={100} inputMode="numeric" value={l.max_itens ?? ""} placeholder="—" onChange={(e) => por(a.nome, { max_itens: numero(e.target.value) })} /> itens</label>
                <label>Das <input type="time" value={l.horario?.de ?? ""} onChange={(e) => por(a.nome, { horario: { de: e.target.value, ate: l.horario?.ate ?? "18:00" } })} />
                  às <input type="time" value={l.horario?.ate ?? ""} onChange={(e) => por(a.nome, { horario: { de: l.horario?.de ?? "07:00", ate: e.target.value } })} /></label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CartaoGuia({ g, podeAprovar, agir, ocupado }: { g: Guia; podeAprovar: boolean; agir: (g: Guia, corpo: Record<string, unknown>) => Promise<string | null>; ocupado: boolean }) {
  const [limites, setLimites] = useState<Record<string, Limite>>(g.limites ?? {});
  const [editando, setEditando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [aviso, setAviso] = useState("");
  const situacao = g.situacao === "ativa" && g.pausada ? "pausada" : g.situacao;
  const fazer = async (corpo: Record<string, unknown>) => { setAviso(""); const t = await agir(g, corpo); if (t) setAviso(t); };
  const sozinhas = g.acoes.filter((a) => g.limites?.[a.nome]?.sozinha);
  return (
    <article className={`sara-guia ${situacao}`}>
      <header>
        <b><span aria-hidden>⚡</span> {g.nome}</b>
        <span className={`sara-guia-situacao ${situacao}`}>{situacao === "pausada" ? "Pausada" : SITUACAO[g.situacao] ?? g.situacao}</span>
      </header>
      <p>{g.descricao}</p>
      <small className="sara-guia-quando">🕑 {g.quando}{g.situacao === "ativa" && !g.pausada && g.proxima_em ? ` · próxima: ${quando(g.proxima_em)}` : ""}</small>
      {!g.minha && g.responsavel && <small className="sara-guia-nota">Pedida por {g.responsavel} · roda com as permissões de quem pediu</small>}
      <ol className="sara-guia-passos">{g.passos.map((x, k) => <li key={k}><b>{x.rotulo}</b>{x.para_que ? ` — ${x.para_que}` : ""}</li>)}</ol>
      {g.situacao === "ativa" && !editando && (
        <small className="sara-guia-nota">{sozinhas.length ? `Faz sozinha: ${sozinhas.map((a) => a.rotulo).join(", ")} (no limite da área).` : g.acoes.length ? "Toda ação pede o seu Permitir." : "Só consulta."}</small>
      )}
      {g.situacao === "recusada" && g.motivo && <small className="sara-guia-nota">Motivo: {g.motivo}</small>}
      {podeAprovar && (g.situacao === "proposta" || editando) && <QuadroDeLimites acoes={g.acoes} limites={limites} mudar={setLimites} />}
      {recusando && <input className="sara-guia-motivo" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (vai para quem pediu)" aria-label="Motivo da recusa" />}
      <div className="sara-acao-botoes">
        {podeAprovar && g.situacao === "proposta" && (recusando
          ? <><button type="button" className="nao" disabled={ocupado} onClick={() => setRecusando(false)}>Voltar</button><button type="button" className="nao" disabled={ocupado} onClick={() => void fazer({ acao: "decidir", situacao: "recusada", motivo })}>Recusar</button></>
          : <><button type="button" className="nao" disabled={ocupado} onClick={() => setRecusando(true)}>Recusar</button><button type="button" className="sim" disabled={ocupado} onClick={() => void fazer({ acao: "decidir", situacao: "ativa", limites })}>Aprovar</button></>)}
        {podeAprovar && g.situacao === "ativa" && (editando
          ? <><button type="button" className="nao" disabled={ocupado} onClick={() => { setLimites(g.limites ?? {}); setEditando(false); }}>Cancelar</button><button type="button" className="sim" disabled={ocupado} onClick={() => void fazer({ acao: "decidir", situacao: "ativa", limites }).then(() => setEditando(false))}>Salvar limites</button></>
          : <><button type="button" className="nao" disabled={ocupado} onClick={() => void fazer({ acao: "decidir", situacao: "arquivada" })}>Arquivar</button>{g.acoes.length > 0 && <button type="button" className="neutro" disabled={ocupado} onClick={() => setEditando(true)}>Limites</button>}</>)}
        {(g.minha || podeAprovar) && g.situacao === "ativa" && !editando && <button type="button" className="neutro" disabled={ocupado} onClick={() => void fazer({ acao: "pausar", pausada: !g.pausada })}>{g.pausada ? "Retomar" : "Pausar"}</button>}
        {g.minha && g.situacao === "ativa" && !g.pausada && !editando && <button type="button" className="sim" disabled={ocupado} onClick={() => void fazer({ acao: "rodar" })}>Rodar agora</button>}
      </div>
      {aviso && <small className="sara-guia-aviso" role="status">{aviso}</small>}
      {g.execucoes.length > 0 && (
        <details className="sara-guia-execucoes">
          <summary>Últimas execuções</summary>
          <ul>{g.execucoes.map((e) => (
            <li key={e.id} className={e.situacao}>
              <b>{EXECUCAO[e.situacao] ?? e.situacao}</b> · {quando(e.quando)}{e.evento ? ` · ${e.evento}` : ""}
              {e.resumo && <span>{e.resumo}</span>}
              {(e.pendentes > 0 || e.feitas > 0) && <span>{e.pendentes > 0 ? `${e.pendentes} esperando Permitir` : ""}{e.pendentes > 0 && e.feitas > 0 ? " · " : ""}{e.feitas > 0 ? `${e.feitas} feita(s) sozinha(s)` : ""}</span>}
              {e.erro && <span className="erro">{e.erro}</span>}
            </li>
          ))}</ul>
        </details>
      )}
    </article>
  );
}

export function SaraGuias({ modulo, voltar }: { modulo: string; voltar: () => void }) {
  const [dados, setDados] = useState<{ podeAprovar: boolean; guias: Guia[] } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/sara/${modulo}/guias`, { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) { setErro(j?.error ?? "Não consegui abrir as guias."); return; }
    setErro(""); setDados(j);
  }, [modulo]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  const agir = async (g: Guia, corpo: Record<string, unknown>) => {
    setOcupado(true);
    try {
      const r = await fetch(`/api/sara/${modulo}/guias`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: g.id, ...corpo }) }).catch(() => null);
      const j = await r?.json().catch(() => null);
      if (!r?.ok) return j?.error ?? "Não deu certo. Tente de novo.";
      await carregar();
      return j?.texto ?? null;
    } finally { setOcupado(false); }
  };
  const para = dados?.guias.filter((g) => g.situacao === "proposta") ?? [];
  const outras = dados?.guias.filter((g) => g.situacao !== "proposta") ?? [];
  return (
    <div className="sara-conversa sara-guias">
      <div className="sara-guias-topo">
        <button type="button" className="sara-nova" onClick={voltar}>← Conversa</button>
        <b>Guias</b>
      </div>
      <p className="sara-guias-intro">Guias são rotinas que a SARA roda sozinha, com as suas permissões. Peça na conversa: “toda segunda às 8h, me mostre o que vence na semana” ou “quando o Compras aprovar um pedido meu, me avise”. A guia vai para aprovação de quem responde pela área.</p>
      {erro && <small className="sara-caixa-erro" role="alert">{erro}</small>}
      {!dados && !erro && <p className="sara-guias-intro"><Carregando /> Carregando…</p>}
      {dados && !dados.guias.length && <p className="sara-guias-vazio">Nenhuma guia ainda.</p>}
      {para.length > 0 && <h4 className="sara-guias-grupo">{dados?.podeAprovar ? `Para aprovar (${para.length})` : "Esperando aprovação"}</h4>}
      {para.map((g) => <CartaoGuia key={g.id} g={g} podeAprovar={Boolean(dados?.podeAprovar)} agir={agir} ocupado={ocupado} />)}
      {outras.length > 0 && para.length > 0 && <h4 className="sara-guias-grupo">Guias</h4>}
      {outras.map((g) => <CartaoGuia key={g.id} g={g} podeAprovar={Boolean(dados?.podeAprovar)} agir={agir} ocupado={ocupado} />)}
    </div>
  );
}
